"use strict";

/**
 * src/routes/onboarding.test.js
 *
 * Route-level test suite for /api/onboarding endpoints (Issue #1148).
 * Covers:
 *   - Happy paths with valid payloads (PATCH /, GET /:publicKey)
 *   - Validation failures (400) for malformed bodies
 *   - Not-found path handling (GET returns success with null data, not 404)
 *
 * Note: CSRF protection ("mutating requests need a CSRF token") is enforced
 * by doubleCsrfProtection in src/server.js, not inside this router, so it is
 * out of scope for this route-only suite — see src/routes/auth.test.js for
 * CSRF coverage against the full app. This router also has no auth
 * middleware of its own, so there are no 401/403 cases to cover here.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const { defaultOnboardingRow } = require("../testUtils/pgMock");

const express = require("express");
const request = require("supertest");
const onboardingRoutes = require("./onboarding");

// Setup minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/onboarding", onboardingRoutes);

// Structured error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

// Test Stellar Public Key (valid 56-char G... address generated synthetically)
const VALID_PUBLIC_KEY = "G" + "A".repeat(55);

describe("Onboarding Route Suite (/api/onboarding)", () => {
  beforeEach(() => {
    pool.reset();
  });

  // =========================================================================
  // 1. PATCH /api/onboarding
  // =========================================================================
  describe("PATCH /api/onboarding", () => {
    it("200 — creates onboarding progress with a valid payload", async () => {
      const res = await request(app)
        .patch("/api/onboarding")
        .send({
          publicKey: VALID_PUBLIC_KEY,
          currentStep: 2,
          completedSteps: ["connect_wallet", "fund_account"],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        public_key: VALID_PUBLIC_KEY,
        current_step: 2,
        completed_steps: ["connect_wallet", "fund_account"],
        dismissed: false,
        completed: false,
      });
    });

    it("200 — upserts and overwrites progress for an existing public key", async () => {
      pool.onboardingProgress.set(
        VALID_PUBLIC_KEY,
        defaultOnboardingRow({ public_key: VALID_PUBLIC_KEY, current_step: 1 }),
      );

      const res = await request(app)
        .patch("/api/onboarding")
        .send({
          publicKey: VALID_PUBLIC_KEY,
          currentStep: 3,
          completed: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.current_step).toBe(3);
      expect(res.body.data.completed).toBe(true);
      expect(pool.onboardingProgress.size).toBe(1);
    });

    it("200 — applies default values when optional fields are omitted", async () => {
      const res = await request(app)
        .patch("/api/onboarding")
        .send({ publicKey: VALID_PUBLIC_KEY });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        current_step: 0,
        completed_steps: [],
        dismissed: false,
        completed: false,
      });
    });

    it("400 — rejects when publicKey is missing", async () => {
      const res = await request(app)
        .patch("/api/onboarding")
        .send({ currentStep: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("publicKey is required");
    });

    it("400 — rejects when publicKey is not a string", async () => {
      const res = await request(app)
        .patch("/api/onboarding")
        .send({ publicKey: 12345 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("publicKey is required");
    });

    it("400 — rejects an empty request body", async () => {
      const res = await request(app).patch("/api/onboarding").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("publicKey is required");
    });
  });

  // =========================================================================
  // 2. GET /api/onboarding/:publicKey
  // =========================================================================
  describe("GET /api/onboarding/:publicKey", () => {
    it("200 — returns onboarding progress for an existing public key", async () => {
      const row = defaultOnboardingRow({
        public_key: VALID_PUBLIC_KEY,
        current_step: 4,
        completed_steps: ["connect_wallet"],
      });
      pool.onboardingProgress.set(VALID_PUBLIC_KEY, row);

      const res = await request(app).get(`/api/onboarding/${VALID_PUBLIC_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        public_key: VALID_PUBLIC_KEY,
        current_step: 4,
        completed_steps: ["connect_wallet"],
      });
    });

    it("200 — returns null data when no progress exists for the public key (not-found path)", async () => {
      const res = await request(app).get(`/api/onboarding/${VALID_PUBLIC_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });
  });
});
