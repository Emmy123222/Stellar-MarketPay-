"use strict";

/**
 * src/routes/certificates.test.js
 *
 * Route-level test suite for /api/certificates endpoints (Issue #1139).
 * Covers:
 *   - Happy path with a valid database row (200)
 *   - Not-found path (404) for an unknown certificate id
 *   - Empty-list path for a user with no certificates (200)
 *   - SQL parameter / column verification for both endpoints
 *   - Error propagation to the structured error handler (500)
 *
 * Both endpoints are public read-only GETs, so there is no auth guard to
 * exercise and no request body to validate — the authentication / validation
 * cases from the issue scope do not apply to this router. CSRF is not
 * required either, since the router performs no state-mutating requests.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const certificateRoutes = require("./certificates");

// Setup minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/certificates", certificateRoutes);

// Structured error handler
app.use((err, req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

const CERT_ID = "c7a9f2e1-4b3a-4d5c-9e8f-1a2b3c4d5e6f";
const PUBLIC_KEY = "G" + "A".repeat(55);
const DISPLAY_NAME = "Ada Lovelace";
const CERT_HASH = "a".repeat(64);

function certificateRow(overrides = {}) {
  return {
    id: CERT_ID,
    public_key: PUBLIC_KEY,
    display_name: DISPLAY_NAME,
    skill: "Rust Smart Contracts",
    score: 92,
    certificate_hash: CERT_HASH,
    ipfs_cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    tx_hash: "b".repeat(64),
    issued_at: "2026-08-01T12:00:00.000Z",
    created_at: "2026-08-01T12:05:00.000Z",
    ...overrides,
  };
}

describe("Certificates Route Suite (/api/certificates)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. GET /api/certificates/:id
  // =========================================================================
  describe("GET /api/certificates/:id", () => {
    it("200 — happy path: returns the certificate with a valid row", async () => {
      pool.query.mockResolvedValueOnce({ rows: [certificateRow()] });

      const res = await request(app).get(`/api/certificates/${CERT_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        id: CERT_ID,
        publicKey: PUBLIC_KEY,
        displayName: DISPLAY_NAME,
        skill: "Rust Smart Contracts",
        score: 92,
        certificateHash: CERT_HASH,
        ipfsCid: certificateRow().ipfs_cid,
        txHash: "b".repeat(64),
        issuedAt: "2026-08-01T12:00:00.000Z",
        createdAt: "2026-08-01T12:05:00.000Z",
        verifyUrl: `https://stellar.expert/explorer/testnet/search?q=${CERT_HASH}`,
      });

      // Verify the query selects from skill_certificates by id with a LEFT JOIN
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("FROM skill_certificates sc");
      expect(sql).toContain("LEFT JOIN profiles p ON p.public_key = sc.public_key");
      expect(sql).toContain("WHERE sc.id = $1");
      expect(params).toEqual([CERT_ID]);
    });

    it("404 — not-found path: returns 404 when no certificate matches the id", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get("/api/certificates/non-existent-cert");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Certificate not found");
    });

    it("500 — error handling: propagates database query exceptions", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database connection lost"));

      const res = await request(app).get(`/api/certificates/${CERT_ID}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Database connection lost");
    });
  });

  // =========================================================================
  // 2. GET /api/certificates/user/:publicKey
  // =========================================================================
  describe("GET /api/certificates/user/:publicKey", () => {
    it("200 — happy path: returns all certificates for a user", async () => {
      const second = certificateRow({
        id: "d8b0a3f2-5c4b-4e6d-9f0a-2b3c4d5e6f70",
        skill: "Zero-Knowledge Proofs",
        score: 88,
      });
      pool.query.mockResolvedValueOnce({
        rows: [certificateRow(), second],
      });

      const res = await request(app).get(`/api/certificates/user/${PUBLIC_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toMatchObject({
        id: CERT_ID,
        publicKey: PUBLIC_KEY,
        displayName: DISPLAY_NAME,
        skill: "Rust Smart Contracts",
      });
      expect(res.body.data[1]).toMatchObject({
        skill: "Zero-Knowledge Proofs",
      });

      // Newest-first ordering and public-key filter must be present
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("FROM skill_certificates sc");
      expect(sql).toContain("WHERE sc.public_key = $1");
      expect(sql).toContain("ORDER BY sc.issued_at DESC");
      expect(params).toEqual([PUBLIC_KEY]);
    });

    it("200 — returns an empty list when the user has no certificates", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get(`/api/certificates/user/${PUBLIC_KEY}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("500 — error handling: propagates database query exceptions", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database connection lost"));

      const res = await request(app).get(`/api/certificates/user/${PUBLIC_KEY}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Database connection lost");
    });
  });
});
