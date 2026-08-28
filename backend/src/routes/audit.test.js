"use strict";

/**
 * src/routes/audit.test.js
 *
 * Route-level test suite for /api/audit endpoints (Issue #1138).
 *
 * Scope, per endpoint:
 *   - GET /          admin-only list with cursor pagination + filters
 *   - GET /:jobId    participant-or-admin gated per-job logs
 *
 * GET / requires the real verifyJWT + requireAdminRole middlewares to exercise
 * the authorisation gate (a non-admin caller must be rejected with 403). The
 * cursor pagination query hits the pool directly, so pool is swapped for the
 * shared pgMock. GET /:jobId delegates to jobService.getJob() and
 * contractAuditService.getAuditLogsForJob(), which are mocked.
 */

// adminList is computed at module load, so set the env var BEFORE requiring the
// router — this lets us exercise both the participant and the admin grant on
// GET /:jobId in the same suite.
process.env.ADMIN_PUBLIC_KEYS = (process.env.ADMIN_PUBLIC_KEYS || "")
  .split(",")
  .filter(Boolean)
  .concat("G" + "A".repeat(55))
  .join(",");

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/jobService", () => ({
  getJob: jest.fn(),
}));

jest.mock("../services/contractAuditService", () => ({
  getAuditLogsForJob: jest.fn(),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const auditRoutes = require("./audit");
const { getJob } = require("../services/jobService");
const { getAuditLogsForJob } = require("../services/contractAuditService");

const app = express();
app.use(express.json());
app.use("/api/audit", auditRoutes);
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message });
});

const ADMIN = "G" + "A".repeat(55);
const CLIENT = "G" + "C".repeat(55);
const FREELANCER = "G" + "B".repeat(55);
const OTHER = "G" + "D".repeat(55);
const JOB_ID = "job-101";

function token(payload) {
  return jwt.sign({ publicKey: payload.publicKey, role: payload.role || "freelancer" }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

function authHeader(pk, role) {
  return `Bearer ${token({ publicKey: pk, role })}`;
}

function auditRow(overrides = {}) {
  return {
    id: overrides.id || "audit-1",
    adminAddress: ADMIN,
    action: overrides.action || "PATCH",
    resource: overrides.resource || `job:${JOB_ID}`,
    timestamp: overrides.timestamp || new Date().toISOString(),
    changesDiff: overrides.changesDiff || { before: 1, after: 2 },
    ...overrides,
  };
}

describe("Audit Routes Suite (/api/audit)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // GET /  — admin only, cursor pagination
  // =========================================================================
  describe("GET /", () => {
    it("200 — happy path: admin lists audit logs", async () => {
      pool.query.mockResolvedValueOnce({ rows: [auditRow(), auditRow({ id: "audit-2" })] });

      const res = await request(app)
        .get("/api/audit")
        .set("Authorization", authHeader(ADMIN, "admin"));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      // rows(2) < maxLimit(50) => no more pages, nextCursor is null
      expect(res.body.nextCursor).toBeNull();
    });

    it("200 — applies action / resource_type / date filters as WHERE conditions", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get("/api/audit?action=DELETE&resource_type=job&from=2026-01-01T00:00:00Z")
        .set("Authorization", authHeader(ADMIN, "admin"));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("action = $1");
      expect(sql).toContain("metadata->>'targetType' = $2");
      expect(sql).toContain("created_at >= $3");
      expect(params).toContain("DELETE");
      expect(params).toContain("job");
    });

    it("200 — limits a requested limit to 100 (clamped)", async () => {
      pool.query.mockResolvedValueOnce({ rows: Array.from({ length: 100 }, (_, i) => auditRow({ id: `a-${i}` })) });

      const res = await request(app)
        .get("/api/audit?limit=1000")
        .set("Authorization", authHeader(ADMIN, "admin"));

      expect(res.status).toBe(200);
      // maxLimit is clamped to 100, so nextCursor is emitted for the 100th row.
      expect(res.body.nextCursor).toBe(Buffer.from("a-99").toString("base64"));
    });

    it("403 — rejects a non-admin caller", async () => {
      const res = await request(app)
        .get("/api/audit")
        .set("Authorization", authHeader(FREELANCER, "freelancer"));

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Admin access required/);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("401 — rejects when no token is supplied", async () => {
      const res = await request(app).get("/api/audit");
      expect(res.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // GET /:jobId  — participant-or-admin
  // =========================================================================
  describe("GET /:jobId", () => {
    it("200 — happy path: job participant lists logs", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT,
        freelancerAddress: FREELANCER,
      });
      getAuditLogsForJob.mockResolvedValue([auditRow()]);

      const res = await request(app)
        .get(`/api/audit/${JOB_ID}`)
        .set("Authorization", authHeader(FREELANCER));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(getAuditLogsForJob).toHaveBeenCalledWith(JOB_ID);
    });

    it("200 — happy path: admin lists logs for any job", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT,
        freelancerAddress: FREELANCER,
      });
      getAuditLogsForJob.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/audit/${JOB_ID}`)
        .set("Authorization", authHeader(ADMIN, "admin"));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("403 — rejects a caller who is neither participant nor admin", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT,
        freelancerAddress: FREELANCER,
      });

      const res = await request(app)
        .get(`/api/audit/${JOB_ID}`)
        .set("Authorization", authHeader(OTHER));

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden");
      expect(getAuditLogsForJob).not.toHaveBeenCalled();
    });

    it("404 — surfaces job-not-found from the service", async () => {
      const err = new Error("Job not found");
      err.status = 404;
      getJob.mockRejectedValue(err);

      const res = await request(app)
        .get(`/api/audit/${JOB_ID}`)
        .set("Authorization", authHeader(CLIENT));

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
    });

    it("401 — rejects when no token is supplied", async () => {
      const res = await request(app).get(`/api/audit/${JOB_ID}`);
      expect(res.status).toBe(401);
      expect(getJob).not.toHaveBeenCalled();
    });
  });
});