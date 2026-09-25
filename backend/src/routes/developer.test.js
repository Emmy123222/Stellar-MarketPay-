"use strict";

/**
 * src/routes/developer.test.js
 *
 * Route-level test suite for /api/developer endpoints (Issue #1141).
 * Covers:
 *   - Happy paths with valid payloads (GET /keys, POST /keys, DELETE /keys/:id, POST /keys/:id/rotate)
 *   - Authentication rejection (401) on guarded routes
 *   - Authorization rejection (401) when wallet public key is missing
 *   - Not-found paths (404) for revoke and rotate on unknown or already revoked/rotating keys
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../middleware/apiKeyRateLimiter", () => ({
  apiKeyRateLimiter: () => (req, res, next) => next(),
}));

const pool = require("../db/pool");
const { defaultApiKeyRow } = require("../testUtils/pgMock");

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const developerRoutes = require("./developer");

// Setup minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/developer", developerRoutes);

// Structured error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

// Test Stellar Public Keys (valid 56-char G... addresses generated synthetically)
const DEVELOPER_KEY = "G" + "A".repeat(55);
const OTHER_DEVELOPER_KEY = "G" + "B".repeat(55);

function makeToken(payload = { publicKey: DEVELOPER_KEY, role: "developer" }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

describe("Developer Route Suite (/api/developer)", () => {
  beforeEach(() => {
    pool.reset();
  });

  // =========================================================================
  // 1. GET /api/developer/keys
  // =========================================================================
  describe("GET /api/developer/keys", () => {
    it("200 — returns list of API keys for the authenticated developer", async () => {
      const key1 = defaultApiKeyRow({
        id: "key-1",
        owner_public_key: DEVELOPER_KEY,
        label: "Production Backend",
        key_prefix: "sk_live_prod",
      });
      const key2 = defaultApiKeyRow({
        id: "key-2",
        owner_public_key: DEVELOPER_KEY,
        label: "Staging Service",
        key_prefix: "sk_live_stag",
      });
      const otherKey = defaultApiKeyRow({
        id: "key-other",
        owner_public_key: OTHER_DEVELOPER_KEY,
        label: "Other Key",
      });
      pool.apiKeys.set(key1.id, key1);
      pool.apiKeys.set(key2.id, key2);
      pool.apiKeys.set(otherKey.id, otherKey);

      const token = makeToken();
      const res = await request(app)
        .get("/api/developer/keys")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((k) => k.id)).toEqual(["key-1", "key-2"]);
    });

    it("200 — returns empty list when developer has no API keys", async () => {
      const token = makeToken();
      const res = await request(app)
        .get("/api/developer/keys")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("401 — rejects unauthenticated request when token is missing", async () => {
      const res = await request(app).get("/api/developer/keys");

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("401 — rejects request when token contains no wallet public key", async () => {
      const token = makeToken({ role: "developer" }); // Missing publicKey
      const res = await request(app)
        .get("/api/developer/keys")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });
  });

  // =========================================================================
  // 2. POST /api/developer/keys
  // =========================================================================
  describe("POST /api/developer/keys", () => {
    it("201 — creates a new API key with custom label", async () => {
      const token = makeToken();
      const res = await request(app)
        .post("/api/developer/keys")
        .set("Authorization", `Bearer ${token}`)
        .send({ label: "Mobile App Gateway" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        label: "Mobile App Gateway",
      });
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.keyPrefix).toBeDefined();
      expect(res.body.data.apiKey).toMatch(/^sk_live_/);
      expect(res.body.data.createdAt).toBeDefined();
    });

    it("201 — creates a new API key with default label when body is omitted", async () => {
      const token = makeToken();
      const res = await request(app)
        .post("/api/developer/keys")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.label).toBe("Developer key");
      expect(res.body.data.apiKey).toMatch(/^sk_live_/);
    });

    it("401 — rejects unauthenticated key creation", async () => {
      const res = await request(app)
        .post("/api/developer/keys")
        .send({ label: "Unauthorized Key" });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });

    it("401 — rejects key creation with invalid JWT token", async () => {
      const res = await request(app)
        .post("/api/developer/keys")
        .set("Authorization", "Bearer invalid.jwt.token")
        .send({ label: "Test" });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });
  });

  // =========================================================================
  // 3. DELETE /api/developer/keys/:id
  // =========================================================================
  describe("DELETE /api/developer/keys/:id", () => {
    it("200 — revokes an active API key", async () => {
      const key = defaultApiKeyRow({
        id: "key-to-revoke",
        owner_public_key: DEVELOPER_KEY,
        label: "Old Key",
      });
      pool.apiKeys.set(key.id, key);

      const token = makeToken();
      const res = await request(app)
        .delete("/api/developer/keys/key-to-revoke")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("API key revoked");

      const updated = pool.apiKeys.get("key-to-revoke");
      expect(updated.revoked_at).not.toBeNull();
    });

    it("404 — returns not-found when key does not exist", async () => {
      const token = makeToken();
      const res = await request(app)
        .delete("/api/developer/keys/non-existent-key")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("API key not found");
    });

    it("404 — returns not-found when attempting to revoke another user's key", async () => {
      const otherKey = defaultApiKeyRow({
        id: "other-user-key",
        owner_public_key: OTHER_DEVELOPER_KEY,
      });
      pool.apiKeys.set(otherKey.id, otherKey);

      const token = makeToken();
      const res = await request(app)
        .delete("/api/developer/keys/other-user-key")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("API key not found");
    });

    it("404 — returns not-found when key is already revoked", async () => {
      const revokedKey = defaultApiKeyRow({
        id: "already-revoked-key",
        owner_public_key: DEVELOPER_KEY,
        revoked_at: new Date().toISOString(),
      });
      pool.apiKeys.set(revokedKey.id, revokedKey);

      const token = makeToken();
      const res = await request(app)
        .delete("/api/developer/keys/already-revoked-key")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("API key not found");
    });

    it("401 — rejects unauthenticated revocation", async () => {
      const res = await request(app).delete("/api/developer/keys/key-123");

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });
  });

  // =========================================================================
  // 4. POST /api/developer/keys/:id/rotate
  // =========================================================================
  describe("POST /api/developer/keys/:id/rotate", () => {
    it("200 — rotates an active API key and returns new key value", async () => {
      const key = defaultApiKeyRow({
        id: "key-to-rotate",
        owner_public_key: DEVELOPER_KEY,
        label: "Production Key",
      });
      pool.apiKeys.set(key.id, key);

      const token = makeToken();
      const res = await request(app)
        .post("/api/developer/keys/key-to-rotate/rotate")
        .set("Authorization", `Bearer ${token}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("key-to-rotate");
      expect(res.body.data.label).toBe("Production Key");
      expect(res.body.data.rotatingAt).toBeDefined();
      expect(res.body.data.apiKey).toMatch(/^sk_live_/);

      const updated = pool.apiKeys.get("key-to-rotate");
      expect(updated.rotating_at).not.toBeNull();
      expect(updated.rotating_key_hash).not.toBeNull();
    });

    it("404 — returns not-found when key to rotate does not exist", async () => {
      const token = makeToken();
      const res = await request(app)
        .post("/api/developer/keys/non-existent-key/rotate")
        .set("Authorization", `Bearer ${token}`)
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("API key not found or already rotating");
    });

    it("404 — returns not-found when rotating another user's key", async () => {
      const otherKey = defaultApiKeyRow({
        id: "other-user-key-rotate",
        owner_public_key: OTHER_DEVELOPER_KEY,
      });
      pool.apiKeys.set(otherKey.id, otherKey);

      const token = makeToken();
      const res = await request(app)
        .post("/api/developer/keys/other-user-key-rotate/rotate")
        .set("Authorization", `Bearer ${token}`)
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("API key not found or already rotating");
    });

    it("404 — returns not-found when key is already rotating", async () => {
      const rotatingKey = defaultApiKeyRow({
        id: "already-rotating-key",
        owner_public_key: DEVELOPER_KEY,
        rotating_at: new Date().toISOString(),
        rotating_key_hash: "hash_rotate",
      });
      pool.apiKeys.set(rotatingKey.id, rotatingKey);

      const token = makeToken();
      const res = await request(app)
        .post("/api/developer/keys/already-rotating-key/rotate")
        .set("Authorization", `Bearer ${token}`)
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("API key not found or already rotating");
    });

    it("404 — returns not-found when key is revoked", async () => {
      const revokedKey = defaultApiKeyRow({
        id: "revoked-key-rotate",
        owner_public_key: DEVELOPER_KEY,
        revoked_at: new Date().toISOString(),
      });
      pool.apiKeys.set(revokedKey.id, revokedKey);

      const token = makeToken();
      const res = await request(app)
        .post("/api/developer/keys/revoked-key-rotate/rotate")
        .set("Authorization", `Bearer ${token}`)
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("API key not found or already rotating");
    });

    it("401 — rejects unauthenticated key rotation", async () => {
      const res = await request(app)
        .post("/api/developer/keys/key-123/rotate")
        .send();

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
    });
  });
});
