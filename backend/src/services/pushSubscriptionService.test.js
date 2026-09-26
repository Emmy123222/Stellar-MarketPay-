/**
 * src/services/pushSubscriptionService.test.js
 *
 * Tests for push delivery retry, subscription invalidation and the daily
 * purge of invalid subscriptions (issue #1438).
 *
 * Fake timers drive the 1s / 2s / 4s backoff so no test ever waits in real
 * time, and an in-memory stand-in for the push_subscriptions table lets the
 * SQL-level behaviour (is_active filtering, deactivation, purge) be asserted.
 */
"use strict";

// VAPID keys must be present before the service module loads, otherwise
// sendPushNotification short-circuits with "Push not configured".
process.env.VAPID_PUBLIC_KEY = "test-vapid-public-key";
process.env.VAPID_PRIVATE_KEY = "test-vapid-private-key";

jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../utils/logger", () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  })),
}));

const webpush = require("web-push");
const pool = require("../db/pool");
const {
  sendPushNotification,
  purgeInvalidSubscriptions,
} = require("./pushSubscriptionService");

const USER_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const notification = { title: "Hello", body: "World" };

/** Build an in-memory push_subscriptions row. */
function makeRow(endpoint, overrides = {}) {
  return {
    id: `sub-${endpoint}`,
    user_address: USER_ADDRESS,
    endpoint,
    auth_key: "auth-key",
    p256dh_key: "p256dh-key",
    is_active: true,
    ...overrides,
  };
}

/** Transient (retryable) delivery failure — network style, no HTTP status. */
function networkError(message = "socket hang up") {
  const error = new Error(message);
  error.code = "ECONNRESET";
  return error;
}

/** Permanent failure reported by the push service for a dead endpoint. */
function goneError(statusCode) {
  const error = new Error(`Push service returned ${statusCode}`);
  error.statusCode = statusCode;
  return error;
}

let subscriptions = [];

/**
 * Minimal in-memory stand-in for the push_subscriptions table that honours
 * the SQL statements used by the service: the active-only select, the
 * deactivation update and the invalid-subscription purge delete.
 */
function installFakeDb() {
  pool.query.mockImplementation(async (sql, params) => {
    const text = sql.replace(/\s+/g, " ").trim();

    if (
      text.startsWith(
        "SELECT id, endpoint, auth_key, p256dh_key FROM push_subscriptions",
      )
    ) {
      const rows = subscriptions
        .filter(
          (row) => row.user_address === params[0] && row.is_active === true,
        )
        .map(({ id, endpoint, auth_key, p256dh_key }) => ({
          id,
          endpoint,
          auth_key,
          p256dh_key,
        }));
      return { rows, rowCount: rows.length };
    }

    if (text.startsWith("UPDATE push_subscriptions SET is_active = false")) {
      let rowCount = 0;
      for (const row of subscriptions) {
        if (
          row.user_address === params[0] &&
          row.endpoint === params[1] &&
          row.is_active
        ) {
          row.is_active = false;
          rowCount += 1;
        }
      }
      return { rows: [], rowCount };
    }

    if (
      text.startsWith("DELETE FROM push_subscriptions WHERE is_active = false")
    ) {
      const before = subscriptions.length;
      subscriptions = subscriptions.filter((row) => row.is_active !== false);
      return { rows: [], rowCount: before - subscriptions.length };
    }

    throw new Error(`Unexpected SQL in pushSubscriptionService test: ${text}`);
  });
}

/** Normalised SQL of every query executed so far. */
function executedSql() {
  return pool.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim());
}

beforeEach(() => {
  jest.clearAllMocks();
  webpush.sendNotification.mockReset();
  jest.useFakeTimers();
  subscriptions = [makeRow("https://push.example.com/subscription-one")];
  installFakeDb();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("sendPushNotification retries (issue #1438)", () => {
  test("successful notification is delivered once with no retry", async () => {
    webpush.sendNotification.mockResolvedValue({ statusCode: 201 });

    const result = await sendPushNotification(USER_ADDRESS, notification);

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(result).toMatchObject({ success: true, sent: 1, failed: 0 });
    expect(subscriptions[0].is_active).toBe(true);
  });

  test("failed delivery is retried at 1s, 2s and 4s", async () => {
    webpush.sendNotification.mockRejectedValue(networkError());

    const promise = sendPushNotification(USER_ADDRESS, notification);

    // Initial attempt runs immediately, without backoff.
    await jest.advanceTimersByTimeAsync(0);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);

    // 1st retry after 1s — not before.
    await jest.advanceTimersByTimeAsync(999);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);

    // 2nd retry after a further 2s — not before.
    await jest.advanceTimersByTimeAsync(1999);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);

    // 3rd retry after a further 4s — not before.
    await jest.advanceTimersByTimeAsync(3999);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(4);

    const result = await promise;

    // No further attempts after the final retry.
    expect(webpush.sendNotification).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ success: false, sent: 0, failed: 1 });
  });

  test("delivery that succeeds during a retry keeps the subscription valid", async () => {
    webpush.sendNotification
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ statusCode: 201 });

    const promise = sendPushNotification(USER_ADDRESS, notification);

    await jest.advanceTimersByTimeAsync(0);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);

    // 1st retry after 1s succeeds.
    await jest.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ success: true, sent: 1, failed: 0 });
    expect(subscriptions[0].is_active).toBe(true);
    expect(
      executedSql().some((sql) => sql.includes("SET is_active = false")),
    ).toBe(false);
  });

  test("subscription becomes invalid after all attempts fail", async () => {
    webpush.sendNotification.mockRejectedValue(networkError());

    const promise = sendPushNotification(USER_ADDRESS, notification);

    // Drive the initial attempt plus all three backoff windows (1+2+4s).
    await jest.advanceTimersByTimeAsync(7000);
    const result = await promise;

    expect(webpush.sendNotification).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ success: false, sent: 0, failed: 1 });
    expect(subscriptions[0].is_active).toBe(false);
    expect(
      executedSql().some((sql) =>
        sql.includes("UPDATE push_subscriptions SET is_active = false"),
      ),
    ).toBe(true);
  });

  test.each([404, 410])(
    "expired subscription (status %i) is deactivated immediately without retry",
    async (statusCode) => {
      webpush.sendNotification.mockRejectedValue(goneError(statusCode));

      const promise = sendPushNotification(USER_ADDRESS, notification);

      await jest.advanceTimersByTimeAsync(0);
      const result = await promise;

      expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      expect(result).toMatchObject({ success: false, failed: 1 });
      expect(subscriptions[0].is_active).toBe(false);
    },
  );

  test("invalid subscription is no longer sent notifications", async () => {
    subscriptions = [
      makeRow("https://push.example.com/invalid", { is_active: false }),
    ];

    const result = await sendPushNotification(USER_ADDRESS, notification);

    expect(webpush.sendNotification).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      reason: "No subscriptions",
    });

    const selectSql = executedSql().find((sql) => sql.startsWith("SELECT"));
    expect(selectSql).toContain("is_active = true");
  });
});

describe("purgeInvalidSubscriptions (daily job, issue #1438)", () => {
  test("daily purge removes subscriptions marked invalid and keeps active ones", async () => {
    subscriptions = [
      makeRow("https://push.example.com/active"),
      makeRow("https://push.example.com/invalid-1", { is_active: false }),
      makeRow("https://push.example.com/invalid-2", { is_active: false }),
    ];

    const purged = await purgeInvalidSubscriptions();

    expect(purged).toBe(2);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].endpoint).toBe("https://push.example.com/active");
    expect(subscriptions[0].is_active).toBe(true);

    const deleteSql = executedSql().find((sql) => sql.startsWith("DELETE"));
    expect(deleteSql).toContain("is_active = false");
  });

  test("purge reports zero when every subscription is valid", async () => {
    subscriptions = [makeRow("https://push.example.com/active")];

    const purged = await purgeInvalidSubscriptions();

    expect(purged).toBe(0);
    expect(subscriptions).toHaveLength(1);
  });
});
