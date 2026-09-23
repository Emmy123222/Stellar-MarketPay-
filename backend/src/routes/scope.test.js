"use strict";

/**
 * src/routes/scope.test.js
 *
 * Route-level test suite for /api/scope endpoints.
 * Covers:
 *   - Happy path with a valid session ID (200)
 *   - Not-found / already expired path (404)
 *   - CSRF token compatibility for mutating POST requests
 *   - Path parameter handling and query verification
 *   - Error propagation to structured error handler (500)
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const scopeRoutes = require("./scope");

// Setup minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/scope", scopeRoutes);

// Structured error handler
app.use((err, req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

const TEST_SESSION_ID = "scope-session-1234-abcd";

describe("Scope Routes Suite (/api/scope)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. POST /api/scope/:sessionId/renew
  // =========================================================================
  describe("POST /api/scope/:sessionId/renew", () => {
    it("200 — happy path: extends an active scope session by 24 hours", async () => {
      const mockUpdatedRow = {
        session_id: TEST_SESSION_ID,
        expires_at: "2026-08-26T12:00:00.000Z",
      };

      pool.query.mockResolvedValueOnce({ rows: [mockUpdatedRow] });

      const res = await request(app)
        .post(`/api/scope/${TEST_SESSION_ID}/renew`)
        .set("X-CSRF-Token", "dummy-csrf-token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        sessionId: TEST_SESSION_ID,
        expiresAt: "2026-08-26T12:00:00.000Z",
      });

      // Verify that pool.query was called with the correct parameters
      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("UPDATE scope_sessions");
      expect(sql).toContain("WHERE session_id = $1 AND expires_at > NOW()");
      expect(params).toEqual([TEST_SESSION_ID]);
    });

    it("404 — not-found path: returns 404 when session is missing or already expired", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post(`/api/scope/non-existent-or-expired-session/renew`)
        .set("X-CSRF-Token", "dummy-csrf-token");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Session not found or already expired");
    });

    it("200 — handles different session ID formats (UUID and URL-encoded strings)", async () => {
      const uuidSessionId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
      const mockUpdatedRow = {
        session_id: uuidSessionId,
        expires_at: "2026-08-26T15:30:00.000Z",
      };

      pool.query.mockResolvedValueOnce({ rows: [mockUpdatedRow] });

      const res = await request(app)
        .post(`/api/scope/${encodeURIComponent(uuidSessionId)}/renew`)
        .set("X-CSRF-Token", "dummy-csrf-token");

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBe(uuidSessionId);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE scope_sessions"),
        [uuidSessionId],
      );
    });

    it("500 — error handling: propagates database query exceptions to the error handler", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database connection lost"));

      const res = await request(app)
        .post(`/api/scope/${TEST_SESSION_ID}/renew`)
        .set("X-CSRF-Token", "dummy-csrf-token");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Database connection lost");
    });
  });

  // =========================================================================
  // 2. POST /api/scope — create a collaborative proposal session (#1552)
  // =========================================================================
  describe("POST /api/scope", () => {
    it("201 — creates a session with a server-generated id and a share path", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            session_id: "server-generated-id",
            content: "draft",
            finalized: false,
            finalized_payload: { jobId: "job-42", createdBy: "GABC" },
            expires_at: "2026-08-26T12:00:00.000Z",
          },
        ],
      });

      const res = await request(app)
        .post("/api/scope")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ jobId: "job-42", createdBy: "GABC", content: "draft" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.sessionId).toBe("server-generated-id");
      expect(res.body.sharePath).toBe("/scope/server-generated-id");
      expect(res.body.expiresAt).toBe("2026-08-26T12:00:00.000Z");

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("INSERT INTO scope_sessions");
      // Session id is generated server-side (not supplied by the client).
      expect(typeof params[0]).toBe("string");
      expect(params[0].length).toBeGreaterThan(0);
      expect(params[1]).toBe("draft");
      expect(params[2]).toContain("job-42");
    });

    it("201 — tolerates an empty body", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            session_id: "empty-body-id",
            content: "",
            finalized: false,
            finalized_payload: { jobId: null, createdBy: null },
            expires_at: "2026-08-26T12:00:00.000Z",
          },
        ],
      });

      const res = await request(app)
        .post("/api/scope")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({});

      expect(res.status).toBe(201);
      const [, params] = pool.query.mock.calls[0];
      expect(params[1]).toBe("");
    });
  });

  // =========================================================================
  // 3. POST /api/scope/:sessionId/finalize — lock to proposal submission
  // =========================================================================
  describe("POST /api/scope/:sessionId/finalize", () => {
    it("200 — locks the session and returns a deterministic content hash", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            session_id: TEST_SESSION_ID,
            content: "final proposal text",
            finalized: true,
            finalized_hash: null,
            finalized_payload: { jobId: "job-42" },
            expires_at: "2026-08-26T12:00:00.000Z",
          },
        ],
      });

      const res = await request(app)
        .post(`/api/scope/${TEST_SESSION_ID}/finalize`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ content: "final proposal text", payload: { jobId: "job-42" } });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.finalized).toBe(true);
      expect(res.body.sessionId).toBe(TEST_SESSION_ID);
      // sha256 hex digest of the supplied content
      expect(res.body.finalizedHash).toMatch(/^[0-9a-f]{64}$/);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("UPDATE scope_sessions");
      expect(sql).toContain("finalized = true");
      expect(sql).toContain("WHERE session_id = $1 AND expires_at > NOW()");
      expect(params[0]).toBe(TEST_SESSION_ID);
      expect(params[1]).toBe("final proposal text");
    });

    it("200 — honours a caller-supplied finalizedHash", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            session_id: TEST_SESSION_ID,
            content: "text",
            finalized: true,
            finalized_hash: "a".repeat(64),
            finalized_payload: null,
            expires_at: "2026-08-26T12:00:00.000Z",
          },
        ],
      });

      const res = await request(app)
        .post(`/api/scope/${TEST_SESSION_ID}/finalize`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ content: "text", finalizedHash: "a".repeat(64) });

      expect(res.status).toBe(200);
      expect(res.body.finalizedHash).toBe("a".repeat(64));
    });

    it("404 — not-found path when the session is missing or expired", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post("/api/scope/missing/finalize")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ content: "x" });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Session not found or already expired");
    });

    it("propagates a lock to connected collaborators via app.locals", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            session_id: TEST_SESSION_ID,
            content: "locked",
            finalized: true,
            finalized_hash: null,
            finalized_payload: null,
            expires_at: "2026-08-26T12:00:00.000Z",
          },
        ],
      });

      const sendJson = jest.fn();
      const socket = { readyState: 1 };
      const sockets = new Set([socket]);
      app.locals.scopeSessionClients = new Map([[TEST_SESSION_ID, sockets]]);
      app.locals.sendJson = sendJson;

      const res = await request(app)
        .post(`/api/scope/${TEST_SESSION_ID}/finalize`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ content: "locked" });

      expect(res.status).toBe(200);
      expect(sendJson).toHaveBeenCalledTimes(1);
      expect(sendJson.mock.calls[0][0]).toBe(socket);
      expect(sendJson.mock.calls[0][1]).toBe("scope:finalized");
      expect(sendJson.mock.calls[0][2].finalized).toBe(true);

      delete app.locals.scopeSessionClients;
      delete app.locals.sendJson;
    });
  });
});
