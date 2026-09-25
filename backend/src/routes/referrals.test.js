"use strict";

/**
 * src/routes/referrals.test.js
 *
 * Route-level test suite for /api/referrals endpoints.
 * Covers, per endpoint:
 *   - Happy paths with valid payloads
 *   - Authentication rejection (401) on guarded routes
 *   - Authorisation rejection (403) for cross-account access
 *   - Validation failure (400) for malformed bodies / parameters
 *   - Not-found / empty-state paths
 *   - Error propagation (500)
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const referralRoutes = require("./referrals");
const { REFERRAL_BONUS_BPS } = require("../services/referralService");

// Setup minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/referrals", referralRoutes);

// Structured error handler
app.use((err, req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

// Test Stellar Public Keys (56-character standard G... addresses)
const USER_KEY = "G" + "A".repeat(55);
const REFEREE_KEY = "G" + "B".repeat(55);
const OTHER_USER_KEY = "G" + "C".repeat(55);

function makeToken(publicKey = USER_KEY, role = "user") {
  return jwt.sign({ publicKey, role }, JWT_SECRET, { expiresIn: "1h" });
}

describe("Referrals Route Suite (/api/referrals)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. GET /api/referrals/info
  // =========================================================================
  describe("GET /api/referrals/info", () => {
    it("200 — returns referral bonus program info without requiring authentication", async () => {
      const res = await request(app).get("/api/referrals/info");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        bonusBps: REFERRAL_BONUS_BPS,
        bonusPercent: (REFERRAL_BONUS_BPS / 100).toFixed(0),
        description: `Earn ${REFERRAL_BONUS_BPS / 100}% of your referee's first job earnings`,
      });
    });
  });

  // =========================================================================
  // 2. GET /api/referrals/:publicKey
  // =========================================================================
  describe("GET /api/referrals/:publicKey", () => {
    it("200 — happy path: returns referral stats and history for the authenticated user", async () => {
      const summaryRow = {
        total_referrals: "2",
        paid_referrals: "1",
        pending_referrals: "1",
        total_earned_xlm: "15.5000000",
      };

      const refereeRows = [
        {
          id: "ref-1",
          referee_address: REFEREE_KEY,
          status: "paid",
          payout_amount: "15.5000000",
          paid_at: "2026-01-15T12:00:00.000Z",
          created_at: "2026-01-10T09:00:00.000Z",
          referee_display_name: "Alice Developer",
          job_title: "Build Stellar Smart Contract",
        },
        {
          id: "ref-2",
          referee_address: OTHER_USER_KEY,
          status: "pending",
          payout_amount: null,
          paid_at: null,
          created_at: "2026-02-01T10:00:00.000Z",
          referee_display_name: null,
          job_title: null,
        },
      ];

      const payoutRows = [
        {
          id: "payout-1",
          referee_address: REFEREE_KEY,
          job_id: "job-101",
          amount_xlm: "15.5000000",
          contract_tx_hash: "txhash123456789",
          created_at: "2026-01-15T12:00:00.000Z",
          job_title: "Build Stellar Smart Contract",
        },
      ];

      pool.query
        .mockResolvedValueOnce({ rows: [summaryRow] })
        .mockResolvedValueOnce({ rows: refereeRows })
        .mockResolvedValueOnce({ rows: payoutRows });

      const res = await request(app)
        .get(`/api/referrals/${USER_KEY}`)
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        totalReferrals: 2,
        paidReferrals: 1,
        pendingReferrals: 1,
        totalEarnedXlm: "15.5000000",
        bonusBps: REFERRAL_BONUS_BPS,
        referees: [
          {
            id: "ref-1",
            refereeAddress: REFEREE_KEY,
            refereeDisplayName: "Alice Developer",
            status: "paid",
            payoutAmount: "15.5000000",
            paidAt: "2026-01-15T12:00:00.000Z",
            jobTitle: "Build Stellar Smart Contract",
            createdAt: "2026-01-10T09:00:00.000Z",
          },
          {
            id: "ref-2",
            refereeAddress: OTHER_USER_KEY,
            refereeDisplayName: null,
            status: "pending",
            payoutAmount: null,
            paidAt: null,
            jobTitle: null,
            createdAt: "2026-02-01T10:00:00.000Z",
          },
        ],
        payouts: [
          {
            id: "payout-1",
            refereeAddress: REFEREE_KEY,
            jobId: "job-101",
            jobTitle: "Build Stellar Smart Contract",
            amountXlm: "15.5000000",
            contractTxHash: "txhash123456789",
            createdAt: "2026-01-15T12:00:00.000Z",
          },
        ],
      });
    });

    it("200 — not-found / empty path: returns zeroed counts and empty arrays when user has no referrals", async () => {
      const emptySummary = {
        total_referrals: "0",
        paid_referrals: "0",
        pending_referrals: "0",
        total_earned_xlm: "0",
      };

      pool.query
        .mockResolvedValueOnce({ rows: [emptySummary] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/referrals/${USER_KEY}`)
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        totalReferrals: 0,
        paidReferrals: 0,
        pendingReferrals: 0,
        totalEarnedXlm: "0.0000000",
        bonusBps: REFERRAL_BONUS_BPS,
        referees: [],
        payouts: [],
      });
    });

    it("401 — authentication rejection when token is missing", async () => {
      const res = await request(app).get(`/api/referrals/${USER_KEY}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized: Missing or invalid token/);
    });

    it("401 — authentication rejection when token is invalid or malformed", async () => {
      const res = await request(app)
        .get(`/api/referrals/${USER_KEY}`)
        .set("Authorization", "Bearer invalid.jwt.token");

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized: Invalid or expired token/);
    });

    it("403 — authorisation rejection when authenticated user requests another user's referral stats", async () => {
      const res = await request(app)
        .get(`/api/referrals/${OTHER_USER_KEY}`)
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden");
    });

    it("400 — validation failure when publicKey path parameter is malformed", async () => {
      const invalidKeys = [
        "not-a-valid-key",
        "G123", // too short
        "g" + "A".repeat(55), // lowercase prefix
        "S" + "A".repeat(55), // invalid prefix
        USER_KEY + "extra", // too long
      ];

      for (const invalidKey of invalidKeys) {
        const res = await request(app)
          .get(`/api/referrals/${invalidKey}`)
          .set("Authorization", `Bearer ${makeToken(invalidKey)}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid public key");
      }
    });

    it("500 — propagates unexpected database error from service to error handler", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database connection lost"));

      const res = await request(app)
        .get(`/api/referrals/${USER_KEY}`)
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Database connection lost");
    });
  });

  // =========================================================================
  // 3. POST /api/referrals/register
  // =========================================================================
  describe("POST /api/referrals/register", () => {
    it("200 — happy path: registers a new referral with a valid payload", async () => {
      const createdRow = {
        id: "referral-1",
        referrer_address: USER_KEY,
        referee_address: REFEREE_KEY,
        status: "pending",
        created_at: new Date().toISOString(),
      };

      // Mock INSERT returning new row, then UPDATE profiles
      pool.query
        .mockResolvedValueOnce({ rows: [createdRow] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post("/api/referrals/register")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          referrerAddress: USER_KEY,
          refereeAddress: REFEREE_KEY,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(createdRow);
      expect(res.body.message).toBe("Referral registered");
    });

    it("200 — happy path: handles duplicate referral gracefully (idempotent ON CONFLICT)", async () => {
      // Mock INSERT returning empty rows (already existed)
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post("/api/referrals/register")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          referrerAddress: USER_KEY,
          refereeAddress: REFEREE_KEY,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
      expect(res.body.message).toBe("Referral already exists");
    });

    it("400 — validation failure when required body fields are missing", async () => {
      // 1. Completely empty body
      const res1 = await request(app)
        .post("/api/referrals/register")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({});
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe(
        "referrerAddress and refereeAddress are required",
      );

      // 2. Missing refereeAddress
      const res2 = await request(app)
        .post("/api/referrals/register")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ referrerAddress: USER_KEY });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe(
        "referrerAddress and refereeAddress are required",
      );

      // 3. Missing referrerAddress
      const res3 = await request(app)
        .post("/api/referrals/register")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ refereeAddress: REFEREE_KEY });
      expect(res3.status).toBe(400);
      expect(res3.body.error).toBe(
        "referrerAddress and refereeAddress are required",
      );
    });

    it("400 — validation failure when referrerAddress has an invalid public key format", async () => {
      const res = await request(app)
        .post("/api/referrals/register")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          referrerAddress: "invalid-referrer-address",
          refereeAddress: REFEREE_KEY,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid Stellar public key");
    });

    it("400 — validation failure when refereeAddress has an invalid public key format", async () => {
      const res = await request(app)
        .post("/api/referrals/register")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          referrerAddress: USER_KEY,
          refereeAddress: "invalid-referee-address",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid Stellar public key");
    });

    it("400 — validation failure when referrer and referee addresses are the same (self-referral)", async () => {
      const res = await request(app)
        .post("/api/referrals/register")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          referrerAddress: USER_KEY,
          refereeAddress: USER_KEY,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "Referrer and referee cannot be the same address",
      );
    });

    it("500 — propagates unexpected database error from service to error handler", async () => {
      pool.query.mockRejectedValueOnce(
        new Error("Database transaction failed"),
      );

      const res = await request(app)
        .post("/api/referrals/register")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          referrerAddress: USER_KEY,
          refereeAddress: REFEREE_KEY,
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Database transaction failed");
    });
  });
});
