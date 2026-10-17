"use strict";

jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("./notificationService", () => ({ createInAppNotification: jest.fn().mockResolvedValue({}) }));

const pool = require("../db/pool");
const { PriceAlertService, crossedThreshold } = require("./priceAlertService");

const VALID_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ123456789ABCDEFGHIJKLMNOPQRSTU";

describe("PriceAlertService.runOnce", () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ stellar: { usd: 0.15 } }),
    });
    service = new PriceAlertService({ broadcast: jest.fn(), sendEmail: jest.fn() });
  });

  test("cleans up stale triggered one-time alerts after each poll", async () => {
    // No legacy prefs, no active alerts — we just want the cleanup query to fire
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT price_alert_preferences
      .mockResolvedValueOnce({ rows: [] }) // SELECT price_alerts WHERE triggered = FALSE
      .mockResolvedValueOnce({ rowCount: 0 }); // DELETE cleanup

    await service.runOnce();

    const calls = pool.query.mock.calls.map((c) => c[0]);
    const cleanupCall = calls.find(
      (sql) =>
        /DELETE FROM price_alerts/i.test(sql) &&
        /triggered = TRUE/i.test(sql) &&
        /one_time = TRUE/i.test(sql) &&
        /triggered_at/i.test(sql)
    );
    expect(cleanupCall).toBeDefined();
  });

  test("marks a triggered alert and notifies the user", async () => {
    const alert = {
      id: "alert-1",
      user_address: VALID_ADDRESS,
      condition: "above",
      threshold: "0.10",
      one_time: true,
      triggered: false,
    };

    pool.query
      .mockResolvedValueOnce({ rows: [] })         // legacy prefs
      .mockResolvedValueOnce({ rows: [alert] })    // active alerts
      .mockResolvedValueOnce({ rowCount: 1 })      // UPDATE triggered = TRUE
      .mockResolvedValueOnce({ rowCount: 1 })      // DELETE one-time alert
      .mockResolvedValueOnce({ rowCount: 0 });     // bulk cleanup

    await service.runOnce();

    const updateCall = pool.query.mock.calls.find(
      (c) => /UPDATE price_alerts SET triggered = TRUE/i.test(c[0]) && c[1][0] === alert.id
    );
    expect(updateCall).toBeDefined();
  });
});

describe("crossedThreshold", () => {
  test("detects below-to-above crossings", () => {
    expect(crossedThreshold(0.09, 0.11, "above", 0.1)).toBe(true);
    expect(crossedThreshold(0.11, 0.12, "above", 0.1)).toBe(false);
  });

  test("detects above-to-below crossings", () => {
    expect(crossedThreshold(0.11, 0.09, "below", 0.1)).toBe(true);
    expect(crossedThreshold(0.09, 0.08, "below", 0.1)).toBe(false);
  });

  test("does not notify for ordinary fluctuations and supports a first observation", () => {
    expect(crossedThreshold(0.1, 0.1001, "above", 0.1)).toBe(true);
    expect(crossedThreshold(0.1001, 0.1002, "above", 0.1)).toBe(false);
    expect(crossedThreshold(null, 0.11, "above", 0.1)).toBe(true);
  });
});
