"use strict";

/**
 * src/routes/timeEntries.test.js
 *
 * Route-level test suite for /api/time-entries endpoints (Issue #1157).
 * Covers:
 *   - Happy paths with valid payloads
 *   - Authentication rejection (401) on guarded routes
 *   - Validation failures (400) for malformed bodies
 *   - Not-found paths (404) for endpoints taking an id
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { authedAgent } = require("../testUtils/authedRequest");
const { JWT_SECRET } = require("../middleware/auth");
const timeEntriesRoutes = require("./timeEntries");

// Setup minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/time-entries", timeEntriesRoutes);

// Structured error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

// Test Stellar Public Keys
const FREELANCER_KEY = "G" + "F".repeat(55);
const CLIENT_KEY = "G" + "C".repeat(55);
const JOB_ID = "11111111-1111-1111-1111-111111111111";

function makeToken(publicKey = FREELANCER_KEY, role = "user") {
  return jwt.sign({ publicKey, role }, JWT_SECRET, { expiresIn: "1h" });
}

describe("Time Entries Route Suite (/api/time-entries)", () => {
  beforeEach(() => {
    pool.reset();
  });

  // =========================================================================
  // 1. POST /api/time-entries
  // =========================================================================
  describe("POST /api/time-entries", () => {
    const validBody = {
      jobId: JOB_ID,
      durationMinutes: 120,
      description: "Implemented feature X",
    };

    it("201 — happy path with a valid payload", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: JOB_ID, freelancer_address: FREELANCER_KEY, status: "in_progress" }]
      }).mockResolvedValueOnce({
        rows: [{ total_minutes: 0 }]
      }).mockResolvedValueOnce({
        rows: [{
          id: "entry-1",
          job_id: JOB_ID,
          freelancer_address: FREELANCER_KEY,
          duration_minutes: 120,
          description: "Implemented feature X",
          started_at: null,
          milestone_index: null,
          created_at: new Date().toISOString(),
        }]
      });

      const agent = await authedAgent(app, { publicKey: FREELANCER_KEY });
      const res = await agent
        .post("/api/time-entries")
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("entry-1");
    });

    it("401 — authentication rejection where the route is guarded", async () => {
      const res = await request(app)
        .post("/api/time-entries")
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("400 — validation failure for a malformed body", async () => {
      const res = await request(app)
        .post("/api/time-entries")
        .set("Authorization", `Bearer ${makeToken(FREELANCER_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ ...validBody, durationMinutes: -10 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/durationMinutes must be a positive integer/);
    });

    it("404 — not-found path where the route takes an id (job not found)", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post("/api/time-entries")
        .set("Authorization", `Bearer ${makeToken(FREELANCER_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
    });

    // -----------------------------------------------------------------------
    // Hour caps (Issue #1390)
    // -----------------------------------------------------------------------
    describe("hour caps (Issue #1390)", () => {
      const JOB_ROW = { id: JOB_ID, freelancer_address: FREELANCER_KEY, status: "in_progress" };

      function entryRow(minutes) {
        return {
          id: "entry-cap",
          job_id: JOB_ID,
          freelancer_address: FREELANCER_KEY,
          duration_minutes: minutes,
          description: null,
          started_at: null,
          milestone_index: null,
          created_at: new Date().toISOString(),
        };
      }

      function post(body) {
        return request(app)
          .post("/api/time-entries")
          .set("Authorization", `Bearer ${makeToken(FREELANCER_KEY)}`)
          .set("X-CSRF-Token", "dummy-token")
          .send({ jobId: JOB_ID, ...body });
      }

      it("201 — accepts a single entry of exactly 24 h (1440 minutes)", async () => {
        pool.query
          .mockResolvedValueOnce({ rows: [JOB_ROW] })
          .mockResolvedValueOnce({ rows: [{ total_minutes: 0 }] })
          .mockResolvedValueOnce({ rows: [entryRow(1440)] });

        const res = await post({ durationMinutes: 1440 });

        expect(res.status).toBe(201);
        expect(res.body.data.durationMinutes).toBe(1440);
      });

      it("422 — rejects a single entry of 1441 minutes (just over 24 h) without touching the DB", async () => {
        const res = await post({ durationMinutes: 1441 });

        expect(res.status).toBe(422);
        expect(res.body.error).toMatch(/must not exceed 1440 \(24 h\) for a single time entry/);
        expect(pool.query).not.toHaveBeenCalled();
      });

      it("422 — rejects an absurd single entry (200 h)", async () => {
        const res = await post({ durationMinutes: 200 * 60 });

        expect(res.status).toBe(422);
        expect(pool.query).not.toHaveBeenCalled();
      });

      it("201 — accepts an entry that brings the 7-day total to exactly 168 h", async () => {
        pool.query
          .mockResolvedValueOnce({ rows: [JOB_ROW] })
          .mockResolvedValueOnce({ rows: [{ total_minutes: 168 * 60 - 120 }] })
          .mockResolvedValueOnce({ rows: [entryRow(120)] });

        const res = await post({ durationMinutes: 120 });

        expect(res.status).toBe(201);
      });

      it("422 — rejects an entry that pushes the 7-day total to 168 h + 1 minute", async () => {
        pool.query
          .mockResolvedValueOnce({ rows: [JOB_ROW] })
          .mockResolvedValueOnce({ rows: [{ total_minutes: 168 * 60 - 119 }] });

        const res = await post({ durationMinutes: 120 });

        expect(res.status).toBe(422);
        expect(res.body.error).toMatch(/exceed the 10080-minute \(168 h\) limit per job in a 7-day window/);
        expect(res.body.error).toMatch(/9961 minutes already logged, 119 remaining/);
        // job lookup + window sum only — no INSERT
        expect(pool.query).toHaveBeenCalledTimes(2);
      });

      it("422 — rejects any further entry once 168 h are already logged", async () => {
        pool.query
          .mockResolvedValueOnce({ rows: [JOB_ROW] })
          .mockResolvedValueOnce({ rows: [{ total_minutes: 168 * 60 }] });

        const res = await post({ durationMinutes: 1 });

        expect(res.status).toBe(422);
        expect(res.body.error).toMatch(/0 remaining/);
      });

      it("scopes the 7-day sum to this job + freelancer, anchored at startedAt", async () => {
        const startedAt = "2026-09-20T09:00:00.000Z";
        pool.query
          .mockResolvedValueOnce({ rows: [JOB_ROW] })
          .mockResolvedValueOnce({ rows: [{ total_minutes: 0 }] })
          .mockResolvedValueOnce({ rows: [entryRow(60)] });

        const res = await post({ durationMinutes: 60, startedAt });

        expect(res.status).toBe(201);
        const [sql, params] = pool.query.mock.calls[1];
        expect(sql).toMatch(/SUM\(duration_minutes\)/);
        expect(sql).toMatch(/INTERVAL '7 days'/);
        expect(params).toEqual([JOB_ID, FREELANCER_KEY, startedAt]);
      });

      it("400 — rejects an unparseable startedAt", async () => {
        const res = await post({ durationMinutes: 60, startedAt: "not-a-date" });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/startedAt must be a valid ISO 8601 timestamp/);
      });
    });
  });

  // =========================================================================
  // 2. GET /api/time-entries/job/:jobId
  // =========================================================================
  describe("GET /api/time-entries/job/:jobId", () => {
    it("200 — happy path with valid payload", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: "entry-1",
          job_id: JOB_ID,
          freelancer_address: FREELANCER_KEY,
          duration_minutes: 60,
          created_at: new Date().toISOString(),
        }]
      });

      const res = await request(app)
        .get(`/api/time-entries/job/${JOB_ID}`)
        .set("Authorization", `Bearer ${makeToken(FREELANCER_KEY)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it("401 — authentication rejection", async () => {
      const res = await request(app).get(`/api/time-entries/job/${JOB_ID}`);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 3. GET /api/time-entries/job/:jobId/invoices
  // =========================================================================
  describe("GET /api/time-entries/job/:jobId/invoices", () => {
    it("200 — happy path", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: "inv-1",
          job_id: JOB_ID,
          freelancer_address: FREELANCER_KEY,
          client_address: CLIENT_KEY,
          total_minutes: 60,
          hourly_rate_xlm: "10.0000000",
          total_amount_xlm: "10.0000000",
          status: "pending",
          entry_ids: ["entry-1"],
        }]
      });

      const res = await request(app)
        .get(`/api/time-entries/job/${JOB_ID}/invoices`)
        .set("Authorization", `Bearer ${makeToken(FREELANCER_KEY)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it("401 — authentication rejection", async () => {
      const res = await request(app).get(`/api/time-entries/job/${JOB_ID}/invoices`);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 4. POST /api/time-entries/invoice
  // =========================================================================
  describe("POST /api/time-entries/invoice", () => {
    const validBody = {
      jobId: JOB_ID,
      hourlyRateXlm: 25.5,
    };

    it("201 — happy path with valid payload", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: JOB_ID, freelancer_address: FREELANCER_KEY, client_address: CLIENT_KEY, status: "in_progress" }]
      }).mockResolvedValueOnce({
        rows: [{ id: "entry-1", duration_minutes: 60 }]
      }).mockResolvedValueOnce({
        rows: [{
          id: "inv-1",
          job_id: JOB_ID,
          freelancer_address: FREELANCER_KEY,
          client_address: CLIENT_KEY,
          total_minutes: 60,
          hourly_rate_xlm: "25.5000000",
          total_amount_xlm: "25.5000000",
          status: "pending",
          entry_ids: ["entry-1"],
        }]
      });

      const res = await request(app)
        .post("/api/time-entries/invoice")
        .set("Authorization", `Bearer ${makeToken(FREELANCER_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("inv-1");
    });

    it("401 — authentication rejection", async () => {
      const res = await request(app)
        .post("/api/time-entries/invoice")
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(401);
    });

    it("400 — validation failure for a malformed body", async () => {
      const res = await request(app)
        .post("/api/time-entries/invoice")
        .set("Authorization", `Bearer ${makeToken(FREELANCER_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ ...validBody, hourlyRateXlm: -10 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/hourlyRateXlm must be a positive number/);
    });

    it("404 — not-found path where the route takes an id (job not found)", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post("/api/time-entries/invoice")
        .set("Authorization", `Bearer ${makeToken(FREELANCER_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
    });
  });

  // =========================================================================
  // 5. PATCH /api/time-entries/invoice/:invoiceId/review
  // =========================================================================
  describe("PATCH /api/time-entries/invoice/:invoiceId/review", () => {
    const INVOICE_ID = "inv-123";
    const validBody = {
      decision: "approved",
      contractTxHash: "0x123",
    };

    it("200 — happy path with valid payload", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: INVOICE_ID,
          client_address: CLIENT_KEY,
          status: "pending"
        }]
      }).mockResolvedValueOnce({
        rows: [{
          id: INVOICE_ID,
          client_address: CLIENT_KEY,
          status: "approved",
          contract_tx_hash: "0x123"
        }]
      });

      const res = await request(app)
        .patch(`/api/time-entries/invoice/${INVOICE_ID}/review`)
        .set("Authorization", `Bearer ${makeToken(CLIENT_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("approved");
    });

    it("401 — authentication rejection", async () => {
      const res = await request(app)
        .patch(`/api/time-entries/invoice/${INVOICE_ID}/review`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(401);
    });

    it("400 — validation failure for a malformed body", async () => {
      const res = await request(app)
        .patch(`/api/time-entries/invoice/${INVOICE_ID}/review`)
        .set("Authorization", `Bearer ${makeToken(CLIENT_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({ decision: "invalid_decision" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/decision must be 'approved' or 'rejected'/);
    });

    it("404 — not-found path where the route takes an id", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .patch(`/api/time-entries/invoice/${INVOICE_ID}/review`)
        .set("Authorization", `Bearer ${makeToken(CLIENT_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Invoice not found");
    });
  });
});
