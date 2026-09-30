"use strict";

/**
 * src/services/webhookService.test.js
 *
 * Unit tests for the outbound webhook service:
 *   - buildSignature               — deterministic HMAC-SHA256 signatures
 *   - registerWebhook              — inserts the webhook row
 *   - deliverSingleWebhook         — success on first attempt, records delivery
 *     attempts (INSERT INTO webhook_deliveries), retries then succeeds/fails
 *   - deliverEscrowWebhooks        — fan-out across registered webhooks,
 *     short-circuits empty recipient lists
 *
 * The internal helpers listWebhooksForEvent and recordWebhookDeliveryAttempt
 * are exercised through these exported entry points. axios is mocked so no
 * network I/O happens; the DB pool is a shared jest.fn().
 */

const mockQuery = jest.fn();
const mockPost = jest.fn();

jest.mock("../db/pool", () => ({
  query: (...args) => mockQuery(...args),
}));

jest.mock("axios", () => ({
  post: (...args) => mockPost(...args),
}));

const crypto = require("crypto");
const {
  buildSignature,
  registerWebhook,
  deliverSingleWebhook,
  deliverEscrowWebhooks,
  MAX_RETRIES,
} = require("./webhookService");

const USER_ADDRESS = "G" + "A".repeat(55);
const WEBHOOK_URL = "https://example.com/webhook";
const SECRET = "super-secret-123";

const WEBHOOK_ROW = {
  id: "webhook-1",
  user_address: USER_ADDRESS,
  url: WEBHOOK_URL,
  events: ["escrow_created", "escrow_released"],
  secret: SECRET,
  created_at: "2026-08-01T00:00:00.000Z",
};

describe("webhookService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    mockPost.mockReset();
  });

  // =========================================================================
  // buildSignature
  // =========================================================================
  describe("buildSignature", () => {
    it("builds a deterministic HMAC-SHA256 signature", () => {
      const payload = JSON.stringify({ hello: "world" });
      const signature = buildSignature("secret", payload);

      expect(signature).toHaveLength(64);
      expect(signature).toMatch(/^[a-f0-9]+$/);
      // Deterministic: the same inputs always produce the same signature.
      expect(buildSignature("secret", payload)).toBe(signature);
      // And it matches a reference HMAC computed with the same secret.
      const expected = crypto
        .createHmac("sha256", "secret")
        .update(payload)
        .digest("hex");
      expect(signature).toBe(expected);
    });

    it("changes when the secret or the payload changes", () => {
      const payload = JSON.stringify({ event: "escrow_released" });
      const signature = buildSignature(SECRET, payload);

      expect(buildSignature("another-secret-123", payload)).not.toBe(signature);
      expect(buildSignature(SECRET, JSON.stringify({ event: "refund_issued" }))).not.toBe(
        signature,
      );
    });
  });

  // =========================================================================
  // registerWebhook
  // =========================================================================
  describe("registerWebhook", () => {
    it("registers a webhook", async () => {
      const row = {
        id: "webhook-1",
        user_address: "GTEST",
        url: "https://example.com/webhook",
        events: ["escrow_released"],
        created_at: new Date().toISOString(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const result = await registerWebhook({
        userAddress: "GTEST",
        url: row.url,
        events: row.events,
        secret: "supersecret",
      });

      expect(result).toEqual(row);
    });

    it("inserts the webhook with the expected columns and parameters", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [WEBHOOK_ROW] });

      const result = await registerWebhook({
        userAddress: USER_ADDRESS,
        url: WEBHOOK_URL,
        events: ["escrow_created"],
        secret: SECRET,
      });

      expect(result).toEqual(WEBHOOK_ROW);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO webhooks/);
      expect(params).toEqual([USER_ADDRESS, WEBHOOK_URL, ["escrow_created"], SECRET]);
    });
  });

  // =========================================================================
  // deliverSingleWebhook
  // =========================================================================
  describe("deliverSingleWebhook", () => {
    it("delivers on the first attempt with an HMAC signature header", async () => {
      mockPost.mockResolvedValue({ status: 200 });
      mockQuery.mockResolvedValue({ rows: [{ id: "delivery-1" }] });
      const payload = { event: "escrow_released", jobId: "job-1" };

      const result = await deliverSingleWebhook(WEBHOOK_ROW, "escrow_released", payload);

      expect(result.success).toBe(true);
      expect(result.attempts).toHaveLength(1);
      expect(mockPost).toHaveBeenCalledTimes(1);
      const [url, body, config] = mockPost.mock.calls[0];
      expect(url).toBe(WEBHOOK_URL);
      expect(body).toEqual(payload);
      expect(config.headers["Content-Type"]).toBe("application/json");
      expect(config.headers["X-Webhook-Signature"]).toBe(
        buildSignature(SECRET, JSON.stringify(payload)),
      );
      // The delivery attempt is persisted with a JSON-stringified payload.
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO webhook_deliveries/);
      expect(params).toContain("webhook-1");
      expect(params).toContain("escrow_released");
      expect(params).toContain(JSON.stringify(payload));
      expect(params).toContain(200);
    });

    it("retries failed deliveries and records each attempt", async () => {
      mockPost
        .mockRejectedValueOnce(new Error("network 1"))
        .mockRejectedValueOnce(new Error("network 2"))
        .mockResolvedValueOnce({ status: 202 });
      mockQuery.mockResolvedValue({ rows: [{}] });

      const result = await deliverSingleWebhook(
        {
          id: "webhook-1",
          url: "https://example.com/webhook",
          secret: "supersecret",
        },
        "escrow_released",
        { event: "escrow_released", jobId: "job-1" },
      );

      expect(result.success).toBe(true);
      expect(mockPost).toHaveBeenCalledTimes(3);
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it("reports failure after exhausting all attempts", async () => {
      mockPost.mockRejectedValue(new Error("connection refused"));
      // Echo the status param back so each recorded attempt reflects it.
      mockQuery.mockImplementation(async (sql, params) => ({
        rows: [{ id: `delivery-${params[3]}`, status: params[4] }],
      }));

      const result = await deliverSingleWebhook(
        WEBHOOK_ROW,
        "escrow_released",
        { event: "escrow_released", jobId: "job-1" },
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toHaveLength(MAX_RETRIES);
      expect(mockPost).toHaveBeenCalledTimes(MAX_RETRIES);
      expect(result.attempts[result.attempts.length - 1].status).toBe("failed");
    });
  });

  // =========================================================================
  // deliverEscrowWebhooks
  // =========================================================================
  describe("deliverEscrowWebhooks", () => {
    it("returns no deliveries without querying when no user addresses are given", async () => {
      const result = await deliverEscrowWebhooks({
        eventType: "escrow_released",
        userAddresses: [],
        payload: { jobId: "job-1" },
      });

      expect(result.deliveries).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockPost).not.toHaveBeenCalled();
    });

    it("returns no deliveries when the user has no matching webhooks", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await deliverEscrowWebhooks({
        eventType: "escrow_released",
        userAddresses: [USER_ADDRESS],
        payload: { jobId: "job-1" },
      });

      expect(result.deliveries).toEqual([]);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it("delivers escrow events to subscribed webhooks", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "webhook-1",
              user_address: "GTEST",
              url: "https://example.com/webhook",
              events: ["escrow_released"],
              secret: "supersecret",
            },
          ],
        })
        .mockResolvedValue({ rows: [{}] });
      mockPost.mockResolvedValue({ status: 200 });

      const result = await deliverEscrowWebhooks({
        eventType: "escrow_released",
        userAddresses: ["GTEST"],
        payload: { event: "escrow_released", jobId: "job-1" },
      });

      expect(result.deliveries).toHaveLength(1);
      expect(result.deliveries[0].success).toBe(true);
    });
  });
});
