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
app.use(express.json({ limit: "2mb" }));
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
    pool.query.mockReset();
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
  // 2. Scope Content Size Limit Validation (Issue #1457)
  // =========================================================================
  describe("Scope Content Size Limit Validation (Issue #1457)", () => {
    it("413 — returns 413 Payload Too Large when content exceeds 500,000 characters on POST", async () => {
      const oversizedContent = "a".repeat(500_001);

      const res = await request(app)
        .post(`/api/scope/${TEST_SESSION_ID}`)
        .send({ content: oversizedContent });

      expect(res.status).toBe(413);
      expect(res.body.error).toContain("Payload Too Large");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("413 — returns 413 on PUT /api/scope/:sessionId when content exceeds 500,000 characters", async () => {
      const oversizedContent = "x".repeat(500_005);

      const res = await request(app)
        .put(`/api/scope/${TEST_SESSION_ID}`)
        .send({ content: oversizedContent });

      expect(res.status).toBe(413);
      expect(res.body.error).toContain("Payload Too Large");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("413 — returns 413 on POST /api/scope when content exceeds 500,000 characters", async () => {
      const oversizedContent = "z".repeat(500_100);

      const res = await request(app)
        .post("/api/scope")
        .send({ sessionId: TEST_SESSION_ID, content: oversizedContent });

      expect(res.status).toBe(413);
      expect(res.body.error).toContain("Payload Too Large");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("413 — returns 413 on POST /api/scope/:sessionId/renew when request body content exceeds 500,000 characters", async () => {
      const oversizedContent = "r".repeat(500_001);

      const res = await request(app)
        .post(`/api/scope/${TEST_SESSION_ID}/renew`)
        .send({ content: oversizedContent });

      expect(res.status).toBe(413);
      expect(res.body.error).toContain("Payload Too Large");
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("200 — happy path: accepts content of exactly 500,000 characters (boundary test)", async () => {
      const boundaryContent = "b".repeat(500_000);
      const mockSessionRow = {
        session_id: TEST_SESSION_ID,
        content: boundaryContent,
        cursors: {},
        finalized: false,
        finalized_hash: null,
        finalized_payload: null,
        expires_at: "2026-08-27T12:00:00.000Z",
        updated_at: "2026-08-26T12:00:00.000Z",
      };

      pool.query.mockResolvedValueOnce({ rows: [mockSessionRow] });

      const res = await request(app)
        .post(`/api/scope/${TEST_SESSION_ID}`)
        .send({ content: boundaryContent });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.session.content.length).toBe(500_000);
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it("200 — happy path: accepts standard scope content under 500,000 characters", async () => {
      const validContent = "# Scope Title\n\nDeliverable details here.";
      const mockSessionRow = {
        session_id: TEST_SESSION_ID,
        content: validContent,
        cursors: { user1: { start: 0, end: 5 } },
        finalized: false,
        finalized_hash: null,
        finalized_payload: null,
        expires_at: "2026-08-27T12:00:00.000Z",
        updated_at: "2026-08-26T12:00:00.000Z",
      };

      pool.query.mockResolvedValueOnce({ rows: [mockSessionRow] });

      const res = await request(app)
        .put(`/api/scope/${TEST_SESSION_ID}`)
        .send({
          content: validContent,
          cursors: { user1: { start: 0, end: 5 } },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.session.content).toBe(validContent);
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it("400 — rejects when content is not a string", async () => {
      const res = await request(app)
        .post(`/api/scope/${TEST_SESSION_ID}`)
        .send({ content: 12345 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("content must be a string");
    });
  });

  // =========================================================================
  // 3. upsertScopeSession helper function
  // =========================================================================
  describe("upsertScopeSession helper function", () => {
    it("throws 413 error when content exceeds 500,000 characters", async () => {
      const { upsertScopeSession } = scopeRoutes;
      const oversizedContent = "e".repeat(500_001);

      await expect(
        upsertScopeSession(TEST_SESSION_ID, { content: oversizedContent }),
      ).rejects.toMatchObject({
        status: 413,
        statusCode: 413,
        code: "PAYLOAD_TOO_LARGE",
      });
    });

    it("succeeds when content is within 500,000 characters", async () => {
      const { upsertScopeSession } = scopeRoutes;
      const validContent = "Valid content";
      pool.query.mockResolvedValueOnce({
        rows: [{ session_id: TEST_SESSION_ID, content: validContent }],
      });

      const result = await upsertScopeSession(TEST_SESSION_ID, {
        content: validContent,
      });
      expect(result.content).toBe(validContent);
    });
  });

  // =========================================================================
  // 4. GET /api/scope/:sessionId
  // =========================================================================
  describe("GET /api/scope/:sessionId", () => {
    it("200 — returns active scope session details", async () => {
      const mockSessionRow = {
        session_id: TEST_SESSION_ID,
        content: "# Scope document",
        cursors: {},
        finalized: false,
        expires_at: "2026-08-27T12:00:00.000Z",
      };

      pool.query.mockResolvedValueOnce({ rows: [mockSessionRow] });

      const res = await request(app).get(`/api/scope/${TEST_SESSION_ID}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.session.session_id).toBe(TEST_SESSION_ID);
    });

    it("404 — returns 404 when session not found or expired", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get(`/api/scope/expired-or-missing`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Session not found or already expired");
    });
  });
});
