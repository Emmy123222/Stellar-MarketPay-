"use strict";

/**
 * src/routes/savedSearches.test.js
 *
 * Route-level test suite for /api/saved-searches endpoints.
 * Covers, per endpoint:
 *   - Happy paths with a valid payload
 *   - Authentication rejection (401) on guarded routes
 *   - Validation failure (400) for malformed request bodies
 *   - Not-found (404) for endpoints accepting an ID
 *   - Error propagation (500)
 *
 * DB pool is mocked with src/testUtils/pgMock.js.
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
const savedSearchesRoutes = require("./savedSearches");

// Setup minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/saved-searches", savedSearchesRoutes);

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

function makeToken(publicKey = USER_KEY, role = "user") {
  return jwt.sign({ publicKey, role }, JWT_SECRET, { expiresIn: "1h" });
}

describe("Saved Searches Route Suite (/api/saved-searches)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. GET /api/saved-searches
  // =========================================================================
  describe("GET /api/saved-searches", () => {
    it("200 — happy path: returns the list of saved searches for the authenticated user", async () => {
      const savedRows = [
        {
          id: "search-1",
          user_address: USER_KEY,
          query_params: { q: "smart contract" },
          notify_in_app: true,
          notify_email: false,
          last_notified_at: null,
          created_at: "2026-01-10T09:00:00.000Z",
          updated_at: "2026-01-10T09:00:00.000Z",
        },
        {
          id: "search-2",
          user_address: USER_KEY,
          query_params: { q: "remote" },
          notify_in_app: true,
          notify_email: true,
          last_notified_at: "2026-01-12T11:00:00.000Z",
          created_at: "2026-01-12T11:00:00.000Z",
          updated_at: "2026-01-12T11:00:00.000Z",
        },
      ];

      pool.query.mockResolvedValueOnce({ rows: savedRows });

      const res = await request(app)
        .get("/api/saved-searches")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(savedRows);

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("FROM saved_searches");
      expect(sql).toContain("WHERE user_address = $1");
      expect(params).toEqual([USER_KEY]);
    });

    it("200 — empty state: returns an empty array when the user has no saved searches", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get("/api/saved-searches")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("401 — authentication rejection when token is missing", async () => {
      const res = await request(app).get("/api/saved-searches");

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized: Missing or invalid token/);
    });

    it("401 — authentication rejection when token is invalid or malformed", async () => {
      const res = await request(app)
        .get("/api/saved-searches")
        .set("Authorization", "Bearer invalid.jwt.token");

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized: Invalid or expired token/);
    });

    it("500 — propagates unexpected database error to the error handler", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database connection lost"));

      const res = await request(app)
        .get("/api/saved-searches")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Database connection lost");
    });
  });

  // =========================================================================
  // 2. POST /api/saved-searches
  // =========================================================================
  describe("POST /api/saved-searches", () => {
    it("201 — happy path: saves a new search with a valid payload", async () => {
      const createdRow = {
        id: "search-new",
        user_address: USER_KEY,
        query_params: { q: "Rust developer" },
        notify_in_app: true,
        notify_email: true,
        last_notified_at: null,
        created_at: "2026-01-15T12:00:00.000Z",
        updated_at: "2026-01-15T12:00:00.000Z",
      };

      // First query: count check, second query: INSERT ... RETURNING
      pool.query
        .mockResolvedValueOnce({ rows: [{ cnt: "0" }] })
        .mockResolvedValueOnce({ rows: [createdRow] });

      const res = await request(app)
        .post("/api/saved-searches")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          query_params: { q: "Rust developer" },
          notify_in_app: true,
          notify_email: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(createdRow);

      expect(pool.query).toHaveBeenCalledTimes(2);
      const [countSql, countParams] = pool.query.mock.calls[0];
      expect(countSql).toContain("COUNT(*)");
      expect(countSql).toContain("FROM saved_searches");
      expect(countParams).toEqual([USER_KEY]);

      const [insertSql, insertParams] = pool.query.mock.calls[1];
      expect(insertSql).toContain("INSERT INTO saved_searches");
      expect(insertParams[0]).toBe(USER_KEY);
      expect(insertParams[1]).toBe(JSON.stringify({ q: "Rust developer" }));
      expect(insertParams[2]).toBe(true);
      expect(insertParams[3]).toBe(true);
    });

    it("201 — happy path: defaults notify flags when not provided", async () => {
      const createdRow = {
        id: "search-default",
        user_address: USER_KEY,
        query_params: { q: "design" },
        notify_in_app: true,
        notify_email: false,
        last_notified_at: null,
        created_at: "2026-01-15T13:00:00.000Z",
        updated_at: "2026-01-15T13:00:00.000Z",
      };

      pool.query
        .mockResolvedValueOnce({ rows: [{ cnt: "0" }] })
        .mockResolvedValueOnce({ rows: [createdRow] });

      const res = await request(app)
        .post("/api/saved-searches")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ query_params: { q: "design" } });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const insertParams = pool.query.mock.calls[1][1];
      // notify_in_app defaults to true (false-checks), notify_email to false
      expect(insertParams[2]).toBe(true);
      expect(insertParams[3]).toBe(false);
    });

    it("400 — validation failure when query_params is missing", async () => {
      const res = await request(app)
        .post("/api/saved-searches")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "query_params is required and must be an object",
      );
    });

    it("400 — validation failure when query_params is not an object", async () => {
      const res = await request(app)
        .post("/api/saved-searches")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ query_params: "not-an-object" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "query_params is required and must be an object",
      );
    });

    it("400 — limit reached: rejects saving when the user already has 10 searches", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ cnt: "10" }] });

      const res = await request(app)
        .post("/api/saved-searches")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ query_params: { q: "solidity" } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "You can save up to 10 searches. Please delete one first.",
      );
      // Insert query must not have run
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it("401 — authentication rejection when token is missing", async () => {
      const res = await request(app)
        .post("/api/saved-searches")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ query_params: { q: "rust" } });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized: Missing or invalid token/);
    });

    it("500 — propagates unexpected database error to the error handler", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ cnt: "0" }] })
        .mockRejectedValueOnce(new Error("Database connection lost"));

      const res = await request(app)
        .post("/api/saved-searches")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ query_params: { q: "rust" } });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Database connection lost");
    });
  });

  // =========================================================================
  // 3. PATCH /api/saved-searches/:id
  // =========================================================================
  describe("PATCH /api/saved-searches/:id", () => {
    it("200 — happy path: updates notification prefs for an owned saved search", async () => {
      const updatedRow = {
        id: "search-1",
        user_address: USER_KEY,
        query_params: { q: "smart contract" },
        notify_in_app: false,
        notify_email: true,
        last_notified_at: null,
        created_at: "2026-01-10T09:00:00.000Z",
        updated_at: "2026-01-16T08:00:00.000Z",
      };

      pool.query.mockResolvedValueOnce({ rows: [updatedRow] });

      const res = await request(app)
        .patch("/api/saved-searches/search-1")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ notify_in_app: false, notify_email: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(updatedRow);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("UPDATE saved_searches");
      expect(sql).toContain("WHERE id = $3 AND user_address = $4");
      expect(params).toEqual([false, true, "search-1", USER_KEY]);
    });

    it("404 — not-found: returns 404 when the saved search does not exist or is not owned by the user", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .patch("/api/saved-searches/non-existent")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ notify_email: true });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Saved search not found");
    });

    it("401 — authentication rejection when token is missing", async () => {
      const res = await request(app)
        .patch("/api/saved-searches/search-1")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ notify_email: true });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized: Missing or invalid token/);
    });

    it("500 — propagates unexpected database error to the error handler", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database connection lost"));

      const res = await request(app)
        .patch("/api/saved-searches/search-1")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ notify_email: true });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Database connection lost");
    });
  });

  // =========================================================================
  // 4. DELETE /api/saved-searches/:id
  // =========================================================================
  describe("DELETE /api/saved-searches/:id", () => {
    it("200 — happy path: deletes an owned saved search", async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const res = await request(app)
        .delete("/api/saved-searches/search-1")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("DELETE FROM saved_searches");
      expect(sql).toContain("WHERE id = $1 AND user_address = $2");
      expect(params).toEqual(["search-1", USER_KEY]);
    });

    it("404 — not-found: returns 404 when the saved search does not exist or is not owned by the user", async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await request(app)
        .delete("/api/saved-searches/non-existent")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Saved search not found");
    });

    it("401 — authentication rejection when token is missing", async () => {
      const res = await request(app)
        .delete("/api/saved-searches/search-1")
        .set("X-CSRF-Token", "dummy-csrf-token");

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized: Missing or invalid token/);
    });

    it("500 — propagates unexpected database error to the error handler", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database connection lost"));

      const res = await request(app)
        .delete("/api/saved-searches/search-1")
        .set("Authorization", `Bearer ${makeToken(USER_KEY)}`)
        .set("X-CSRF-Token", "dummy-csrf-token");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Database connection lost");
    });
  });
});
