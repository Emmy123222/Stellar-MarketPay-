"use strict";

/**
 * src/routes/progress.test.js
 *
 * Route-level test suite for /api/progress endpoints (Issue #1151).
 * Covers, per endpoint:
 *   - Happy path with a valid payload
 *   - Validation failure (400) for a malformed body (service throws a 400 error)
 *   - Not-found path where the route takes a jobId
 *
 * Note: both endpoints in progress.js have NO auth middleware — they are
 * open routes — so there is no authentication guard to test here. Mutation
 * is also not protected by CSRF (no cookies in play), so no CSRF token
 * is required.
 *
 * The DB pool is replaced with the shared pgMock; the progressService is
 * mocked at the module level to keep tests decoupled from DB internals.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/progressService", () => ({
  addProgressUpdate: jest.fn(),
  getProgressUpdates: jest.fn(),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const progressRoutes = require("./progress");
const { addProgressUpdate, getProgressUpdates } = require("../services/progressService");

// ── Minimal Express test app ─────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use("/api/progress", progressRoutes);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message, code: err.code || "INTERNAL_ERROR" });
});

// ── Test fixtures ─────────────────────────────────────────────────────────────

const JOB_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const AUTHOR_ADDRESS = "G" + "A".repeat(55);

function fakeUpdate(overrides = {}) {
  return {
    id: overrides.id || "update-1",
    job_id: overrides.job_id || JOB_ID,
    author_address: overrides.author_address || AUTHOR_ADDRESS,
    author_name: overrides.author_name || "Alice",
    update_text: overrides.update_text || "Completed milestone 1",
    percentage: overrides.percentage ?? 50,
    created_at: overrides.created_at || new Date().toISOString(),
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Progress Routes Suite (/api/progress)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // 1. GET /api/progress/:jobId  — list progress updates for a job
  // ===========================================================================
  describe("GET /api/progress/:jobId", () => {
    it("200 — happy path: returns a list of progress updates", async () => {
      const updates = [fakeUpdate(), fakeUpdate({ id: "update-2", update_text: "Completed milestone 2" })];
      getProgressUpdates.mockResolvedValue(updates);

      const res = await request(app).get(`/api/progress/${JOB_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].update_text).toBe("Completed milestone 1");
      expect(getProgressUpdates).toHaveBeenCalledWith(JOB_ID);
    });

    it("200 — returns empty array when job has no progress updates", async () => {
      getProgressUpdates.mockResolvedValue([]);

      const res = await request(app).get(`/api/progress/${JOB_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("200 — passes the jobId path param through to the service", async () => {
      getProgressUpdates.mockResolvedValue([]);
      const otherId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

      await request(app).get(`/api/progress/${otherId}`);

      expect(getProgressUpdates).toHaveBeenCalledWith(otherId);
    });

    it("404 — surfaces 404 from service when job does not exist", async () => {
      const err = Object.assign(new Error("Job not found"), { status: 404 });
      getProgressUpdates.mockRejectedValue(err);

      const res = await request(app).get(`/api/progress/non-existent-job`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
    });

    it("500 — propagates unexpected errors via the error handler", async () => {
      getProgressUpdates.mockRejectedValue(new Error("Database connection lost"));

      const res = await request(app).get(`/api/progress/${JOB_ID}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Database connection lost");
    });
  });

  // ===========================================================================
  // 2. POST /api/progress  — add a progress update
  // ===========================================================================
  describe("POST /api/progress", () => {
    const validBody = {
      jobId: JOB_ID,
      authorAddress: AUTHOR_ADDRESS,
      updateText: "Feature X is now complete",
      percentage: 75,
    };

    it("200 — happy path: creates a progress update and returns it", async () => {
      const update = fakeUpdate({
        update_text: validBody.updateText,
        percentage: validBody.percentage,
      });
      addProgressUpdate.mockResolvedValue(update);

      const res = await request(app)
        .post("/api/progress")
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.update_text).toBe(validBody.updateText);
      expect(addProgressUpdate).toHaveBeenCalledWith(validBody);
    });

    it("200 — works without an optional percentage field", async () => {
      const bodyWithoutPct = { jobId: JOB_ID, authorAddress: AUTHOR_ADDRESS, updateText: "Work in progress" };
      addProgressUpdate.mockResolvedValue(fakeUpdate({ percentage: null }));

      const res = await request(app)
        .post("/api/progress")
        .set("X-CSRF-Token", "dummy-token")
        .send(bodyWithoutPct);

      expect(res.status).toBe(200);
      expect(addProgressUpdate).toHaveBeenCalledWith(bodyWithoutPct);
    });

    it("400 — validation failure: service throws 400 when required fields are missing", async () => {
      const err = Object.assign(
        new Error("Missing required fields for progress update"),
        { status: 400 },
      );
      addProgressUpdate.mockRejectedValue(err);

      const res = await request(app)
        .post("/api/progress")
        .set("X-CSRF-Token", "dummy-token")
        .send({});   // empty body — missing jobId, authorAddress, updateText

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required fields/i);
    });

    it("400 — validation failure: service throws 400 when jobId is missing", async () => {
      const err = Object.assign(
        new Error("Missing required fields for progress update"),
        { status: 400 },
      );
      addProgressUpdate.mockRejectedValue(err);

      const res = await request(app)
        .post("/api/progress")
        .set("X-CSRF-Token", "dummy-token")
        .send({ authorAddress: AUTHOR_ADDRESS, updateText: "Something" });

      expect(res.status).toBe(400);
    });

    it("400 — validation failure: service throws 400 when updateText is missing", async () => {
      const err = Object.assign(
        new Error("Missing required fields for progress update"),
        { status: 400 },
      );
      addProgressUpdate.mockRejectedValue(err);

      const res = await request(app)
        .post("/api/progress")
        .set("X-CSRF-Token", "dummy-token")
        .send({ jobId: JOB_ID, authorAddress: AUTHOR_ADDRESS });

      expect(res.status).toBe(400);
    });

    it("404 — surfaces 404 from service when job does not exist", async () => {
      const err = Object.assign(new Error("Job not found"), { status: 404 });
      addProgressUpdate.mockRejectedValue(err);

      const res = await request(app)
        .post("/api/progress")
        .set("X-CSRF-Token", "dummy-token")
        .send({ ...validBody, jobId: "non-existent-job" });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
    });

    it("500 — propagates unexpected errors via the error handler", async () => {
      addProgressUpdate.mockRejectedValue(new Error("Unexpected DB error"));

      const res = await request(app)
        .post("/api/progress")
        .set("X-CSRF-Token", "dummy-token")
        .send(validBody);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Unexpected DB error");
    });
  });
});
