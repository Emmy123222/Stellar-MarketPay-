"use strict";

/**
 * src/routes/verification.test.js
 *
 * Route-level test suite for /api/verification endpoints.
 *
 * Focuses on the Email Verification representative flow end-to-end:
 *   - POST /api/verification/email (initiate email verification)
 *   - POST /api/verification/email/confirm (confirm verification token)
 *   - GET /api/verification/:publicKey (query user verification status)
 *
 * Findings on auth & guards (Step 1):
 *   - None of the verification endpoints (/email, /email/confirm, /:publicKey)
 *     are protected with authentication middleware (such as authenticateToken).
 *   - They are public bootstrap routes, allowing users to request and confirm
 *     verification links without requiring pre-existing authentication credentials.
 *   - As a result, 401/403 auth rejection test cases are omitted for these routes.
 *
 * Finding on GET /:publicKey response shape (Step 1):
 *   - When no verification record exists for a publicKey, the endpoint returns
 *     HTTP 200 with default status:
 *     { success: true, data: { emailVerified: false, phoneVerified: false, idVerified: false } }
 *     (not a 404 status).
 */

// Scale rate limiting before requiring route modules
process.env.RATE_LIMIT_SCALE = "1000";

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const crypto = require("crypto");
const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const verificationRoutes = require("./verification");

// Setup minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/verification", verificationRoutes);

// Structured error handler
app.use((err, req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

const VALID_PUBLIC_KEY = "G" + "A".repeat(55);
const UNVERIFIED_PUBLIC_KEY = "G" + "B".repeat(55);
const VALID_EMAIL = "developer@example.com";

describe("Verification Route Suite (/api/verification)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. POST /api/verification/email
  // =========================================================================
  describe("POST /api/verification/email", () => {
    it("200 — happy path: sends verification email with valid email and publicKey", async () => {
      const res = await request(app)
        .post("/api/verification/email")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          email: VALID_EMAIL,
          publicKey: VALID_PUBLIC_KEY,
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message: "Verification email sent",
      });
    });

    it("400 — validation failure: rejects when email is missing", async () => {
      const res = await request(app)
        .post("/api/verification/email")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          publicKey: VALID_PUBLIC_KEY,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Email and publicKey required");
    });

    it("400 — validation failure: rejects when publicKey is missing", async () => {
      const res = await request(app)
        .post("/api/verification/email")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          email: VALID_EMAIL,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Email and publicKey required");
    });

    it("400 — validation failure: rejects empty request body", async () => {
      const res = await request(app)
        .post("/api/verification/email")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Email and publicKey required");
    });
  });

  // =========================================================================
  // 2. POST /api/verification/email/confirm
  // =========================================================================
  describe("POST /api/verification/email/confirm", () => {
    it("200 — happy path: confirms verification with a valid token and updates status", async () => {
      const TEST_TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
      jest
        .spyOn(crypto, "randomBytes")
        .mockReturnValueOnce(Buffer.from(TEST_TOKEN, "hex"));

      // 1. Initiate email verification to register the token in memory
      const initRes = await request(app)
        .post("/api/verification/email")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          email: "confirmed-user@example.com",
          publicKey: VALID_PUBLIC_KEY,
        });
      expect(initRes.status).toBe(200);

      // 2. Confirm verification with the minted token
      const confirmRes = await request(app)
        .post("/api/verification/email/confirm")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          token: TEST_TOKEN,
        });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body).toEqual({
        success: true,
        message: "Email verified successfully",
      });

      // 3. Verify that GET /api/verification/:publicKey reflects updated status
      const statusRes = await request(app).get(`/api/verification/${VALID_PUBLIC_KEY}`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.success).toBe(true);
      expect(statusRes.body.data).toMatchObject({
        emailVerified: true,
        phoneVerified: false,
        idVerified: false,
        email: "confirmed-user@example.com",
      });
      expect(statusRes.body.data.verifiedAt).toBeDefined();
    });

    it("400 — confirmation failure: rejects non-existent or invalid token (not-found token path)", async () => {
      const res = await request(app)
        .post("/api/verification/email/confirm")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          token: "non-existent-token-value-12345",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid or expired token");
    });

    it("400 — confirmation failure: rejects when token is missing from body", async () => {
      const res = await request(app)
        .post("/api/verification/email/confirm")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid or expired token");
    });

    it("400 — confirmation failure: rejects already consumed token (single-use enforcement)", async () => {
      const SINGLE_USE_TOKEN = "f1e2d3c4b5a60718293a4b5c6d7e8f90f1e2d3c4b5a60718293a4b5c6d7e8f90";
      jest
        .spyOn(crypto, "randomBytes")
        .mockReturnValueOnce(Buffer.from(SINGLE_USE_TOKEN, "hex"));

      // Initiate
      await request(app)
        .post("/api/verification/email")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          email: "single-use@example.com",
          publicKey: VALID_PUBLIC_KEY,
        });

      // First confirmation succeeds
      const firstConfirm = await request(app)
        .post("/api/verification/email/confirm")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ token: SINGLE_USE_TOKEN });
      expect(firstConfirm.status).toBe(200);

      // Second confirmation fails because token was deleted upon first use
      const secondConfirm = await request(app)
        .post("/api/verification/email/confirm")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ token: SINGLE_USE_TOKEN });
      expect(secondConfirm.status).toBe(400);
      expect(secondConfirm.body.error).toBe("Invalid or expired token");
    });
  });

  // =========================================================================
  // 3. GET /api/verification/:publicKey
  // =========================================================================
  describe("GET /api/verification/:publicKey", () => {
    it("200 — not-found path: returns default unverified status when publicKey has no record", async () => {
      const res = await request(app).get(`/api/verification/${UNVERIFIED_PUBLIC_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          emailVerified: false,
          phoneVerified: false,
          idVerified: false,
        },
      });
    });
  });
});
