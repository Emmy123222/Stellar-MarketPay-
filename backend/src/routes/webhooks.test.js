"use strict";

/**
 * src/routes/webhooks.test.js
 *
 * Route-level test suite for POST /api/webhooks (Issue #1160).
 * Covers:
 *   - Happy path with a valid payload (201, webhook registered)
 *   - Authentication rejection (401) — the route is guarded by verifyJWT
 *   - Validation failures (400) for malformed bodies
 *   - Guard behaviour: the rate limiter actually blocks a burst (429)
 *   - Not-found path: the route takes no id, so unknown sub-routes 404
 *
 * The DB pool is replaced with the shared pgMock (required transitively by
 * the auth / rate-limiter middleware); webhookService.registerWebhook is
 * mocked at module level so the route's validation and response wiring is
 * asserted deterministically. Mutating requests carry a CSRF token header,
 * per the shared route-testing scope.
 */

process.env.RATE_LIMIT_SCALE = process.env.RATE_LIMIT_SCALE || "1000";

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/webhookService", () => ({
  registerWebhook: jest.fn(),
}));

jest.mock("../services/notificationService", () => ({
  EVENT_TYPES: {
    ESCROW_CREATED: "escrow_created",
    ESCROW_RELEASED: "escrow_released",
    REFUND_ISSUED: "refund_issued",
    DISPUTE_OPENED: "dispute_opened",
  },
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const { registerWebhook } = require("../services/webhookService");
const webhookRoutes = require("./webhooks");

// Minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/webhooks", webhookRoutes);

// Structured error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

// Test Stellar Public Keys (valid 56-char G... addresses generated synthetically)
const USER_ADDRESS = "G" + "A".repeat(55);

function makeToken(publicKey = USER_ADDRESS) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
}

const VALID_BODY = {
  url: "https://example.com/webhook",
  events: ["escrow_created"],
  secret: "super-secret-123",
};

describe("Webhooks Route Suite (/api/webhooks)", () => {
  const originalRateLimitScale = process.env.RATE_LIMIT_SCALE;

  afterAll(() => {
    // Restore any env override so it never leaks into suites sharing this worker.
    if (originalRateLimitScale === undefined) {
      delete process.env.RATE_LIMIT_SCALE;
    } else {
      process.env.RATE_LIMIT_SCALE = originalRateLimitScale;
    }
  });

  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // POST /api/webhooks — happy paths
  // =========================================================================
  describe("POST /api/webhooks — happy paths", () => {
    it("201 — registers a webhook with a valid payload", async () => {
      registerWebhook.mockResolvedValue({
        id: "webhook-1",
        user_address: USER_ADDRESS,
        url: "https://example.com/webhook",
        events: ["escrow_created"],
        created_at: "2026-08-01T00:00:00.000Z",
      });

      const res = await request(app)
        .post("/api/webhooks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(VALID_BODY);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        id: "webhook-1",
        userAddress: USER_ADDRESS,
        url: "https://example.com/webhook",
        events: ["escrow_created"],
        createdAt: "2026-08-01T00:00:00.000Z",
      });
      expect(registerWebhook).toHaveBeenCalledWith({
        userAddress: USER_ADDRESS,
        url: "https://example.com/webhook",
        events: ["escrow_created"],
        secret: "super-secret-123",
      });
      // The route is also guarded by the webhook rate limiter.
      expect(Number(res.headers["ratelimit-limit"])).toBeGreaterThanOrEqual(10);
    });

    it("201 — normalizes duplicate and whitespace-padded events and trims the secret", async () => {
      registerWebhook.mockResolvedValue({
        id: "webhook-2",
        user_address: USER_ADDRESS,
        url: "https://example.com/webhook",
        events: ["escrow_created", "escrow_released"],
        created_at: "2026-08-01T00:00:00.000Z",
      });

      const res = await request(app)
        .post("/api/webhooks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({
          url: "https://example.com/webhook",
          events: ["escrow_created", " escrow_created ", "escrow_released"],
          secret: "  super-secret-123  ",
        });

      expect(res.status).toBe(201);
      expect(registerWebhook).toHaveBeenCalledWith({
        userAddress: USER_ADDRESS,
        url: "https://example.com/webhook",
        events: ["escrow_created", "escrow_released"],
        secret: "super-secret-123",
      });
    });

    it("400 — rejects a webhook URL padded with whitespace (validated before trimming)", async () => {
      const res = await request(app)
        .post("/api/webhooks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ ...VALID_BODY, url: "  https://example.com/webhook  " });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("A valid webhook URL is required");
      expect(registerWebhook).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // POST /api/webhooks — authentication / authorisation
  // =========================================================================
  describe("POST /api/webhooks — authentication / authorisation", () => {
    it("401 — rejects the request when no JWT is presented", async () => {
      const res = await request(app)
        .post("/api/webhooks")
        .set("X-CSRF-Token", "dummy-token")
        .send(VALID_BODY);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized: Missing or invalid token");
      expect(registerWebhook).not.toHaveBeenCalled();
    });

    it("401 — rejects the request when the JWT is invalid", async () => {
      const res = await request(app)
        .post("/api/webhooks")
        .set("Authorization", "Bearer not-a-real-jwt")
        .set("X-CSRF-Token", "dummy-token")
        .send(VALID_BODY);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized: Invalid or expired token");
      expect(registerWebhook).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // POST /api/webhooks — validation failures
  // =========================================================================
  describe("POST /api/webhooks — validation failures", () => {
    function authedPost(body) {
      return request(app)
        .post("/api/webhooks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(body);
    }

    it("400 — rejects a missing webhook URL", async () => {
      const res = await authedPost({ events: ["escrow_created"], secret: "super-secret-123" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("A valid webhook URL is required");
      expect(registerWebhook).not.toHaveBeenCalled();
    });

    it("400 — rejects a non-HTTP(S) webhook URL", async () => {
      const res = await authedPost({ ...VALID_BODY, url: "ftp://example.com/hook" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("A valid webhook URL is required");
      expect(registerWebhook).not.toHaveBeenCalled();
    });

    it("400 — rejects events that are not an array", async () => {
      const res = await authedPost({ ...VALID_BODY, events: "escrow_created" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("At least one webhook event is required");
      expect(registerWebhook).not.toHaveBeenCalled();
    });

    it("400 — rejects an empty events array", async () => {
      const res = await authedPost({ ...VALID_BODY, events: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("At least one webhook event is required");
      expect(registerWebhook).not.toHaveBeenCalled();
    });

    it("400 — rejects unsupported webhook events", async () => {
      const res = await authedPost({ ...VALID_BODY, events: ["not_a_real_event"] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Unsupported webhook event");
      expect(registerWebhook).not.toHaveBeenCalled();
    });

    it("400 — rejects a secret shorter than 8 characters", async () => {
      const res = await authedPost({ ...VALID_BODY, secret: "short" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Webhook secret must be at least 8 characters");
      expect(registerWebhook).not.toHaveBeenCalled();
    });

    it("400 — rejects a non-string secret", async () => {
      const res = await authedPost({ ...VALID_BODY, secret: 123456789 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Webhook secret must be at least 8 characters");
      expect(registerWebhook).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Guard: the webhook rate limiter (10 req/min per IP)
  // =========================================================================
  describe("Rate-limit guard", () => {
    it("429 — blocks a burst of requests via the webhook rate limiter", async () => {
      const originalScale = process.env.RATE_LIMIT_SCALE;
      process.env.RATE_LIMIT_SCALE = "1";

      // Re-require the route module so a fresh limiter instance is created
      // with the unscaled 10 req/min ceiling, scoped to this test only.
      jest.resetModules();
      const freshWebhookRoutes = require("./webhooks");
      const freshWebhookService = require("../services/webhookService");
      freshWebhookService.registerWebhook.mockResolvedValue({
        id: "webhook-1",
        user_address: USER_ADDRESS,
        url: "https://example.com/webhook",
        events: ["escrow_created"],
        created_at: "2026-08-01T00:00:00.000Z",
      });

      const limitedApp = express();
      limitedApp.use(express.json());
      limitedApp.use("/api/webhooks", freshWebhookRoutes);
      // eslint-disable-next-line no-unused-vars
      limitedApp.use((err, req, res, next) => {
        const status = err.statusCode || err.status || 500;
        res.status(status).json({ error: err.message });
      });

      let last;
      for (let i = 0; i < 11; i += 1) {
        last = await request(limitedApp)
          .post("/api/webhooks")
          .set("Authorization", `Bearer ${makeToken()}`)
          .set("X-CSRF-Token", "dummy-token")
          .send(VALID_BODY);
      }

      expect(last.status).toBe(429);
      expect(last.body.message).toMatch(/Too many requests/i);

      process.env.RATE_LIMIT_SCALE = originalScale;
    });
  });

  // =========================================================================
  // Error passthrough + not-found paths
  // =========================================================================
  describe("Error handling", () => {
    it("500 — passes service errors to the error handler", async () => {
      registerWebhook.mockRejectedValue(new Error("db connection lost"));

      const res = await request(app)
        .post("/api/webhooks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(VALID_BODY);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("db connection lost");
    });

    it("404 — unknown sub-route under /api/webhooks", async () => {
      const res = await request(app)
        .post("/api/webhooks/does-not-exist")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(VALID_BODY);

      expect(res.status).toBe(404);
      expect(registerWebhook).not.toHaveBeenCalled();
    });
  });
});
