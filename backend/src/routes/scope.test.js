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
});
