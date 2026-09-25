"use strict";

/**
 * src/routes/transactions.test.js
 *
 * Route-level test suite for /api/transactions endpoints.
 * Covers, per the shared route-testing scope:
 *   - Happy path with a valid payload (CSV export streamed end-to-end)
 *   - Authentication / authorisation rejection (verifyJWT guard plus the
 *     own-account-only rule on GET /export)
 *   - Validation failure (400) for malformed query payloads
 *   - Not-found paths (unknown sub-route; Horizon account with no history)
 *
 * All GETs are non-mutating, so no CSRF token is required. The Horizon HTTP
 * dependency is stubbed via global.fetch; the Postgres pool is replaced with
 * the shared pgMock (required transitively by auth/rate-limiter middleware).
 */

// The export rate limiter is configured when the router module is first
// required — scale it up so the suite never trips the 10 req/min ceiling.
process.env.RATE_LIMIT_SCALE = process.env.RATE_LIMIT_SCALE || "1000";
process.env.HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");
const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");
const transactionsRoutes = require("./transactions");

// Setup minimal Express test application
const app = express();
app.use("/api/transactions", transactionsRoutes);

// Structured error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

// Valid 56-char G... addresses generated synthetically
const USER_ADDRESS = "G" + "A".repeat(55);
const OTHER_ADDRESS = "G" + "B".repeat(55);

const CSV_HEADER =
  "id,hash,ledger,created_at,from,to,amount,asset,memo,memo_type,successful,type\n";

/**
 * Mint a bearer token the same way src/routes/auth.js issues them.
 */
function bearerToken(publicKey) {
  return jwt.sign({ publicKey }, process.env.JWT_SECRET, { expiresIn: "15m" });
}

/**
 * Build a synthetic Horizon transaction record.
 */
function horizonRecord(overrides = {}) {
  return {
    id: overrides.id || "tx-1",
    hash: overrides.hash || "hash-1",
    ledger: overrides.ledger ?? 100,
    created_at: overrides.created_at || "2026-01-01T00:00:00Z",
    source_account: overrides.source_account || OTHER_ADDRESS,
    memo: overrides.memo || "",
    memo_type: overrides.memo_type || "none",
    successful: overrides.successful ?? true,
    _embedded: { operations: overrides.operations || [] },
  };
}

function horizonResponse(records, links = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ _embedded: { records }, _links: links }),
  };
}

describe("Transactions Route Suite (/api/transactions)", () => {
  const originalFetch = global.fetch;
  // Restore any env overrides so they never leak into suites sharing this
  // worker (rate-limit-sensitive suites read these lazily).
  const originalRateLimitScale = process.env.RATE_LIMIT_SCALE;
  const originalHorizonUrl = process.env.HORIZON_URL;

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalRateLimitScale === undefined) {
      delete process.env.RATE_LIMIT_SCALE;
    } else {
      process.env.RATE_LIMIT_SCALE = originalRateLimitScale;
    }
    if (originalHorizonUrl === undefined) {
      delete process.env.HORIZON_URL;
    } else {
      process.env.HORIZON_URL = originalHorizonUrl;
    }
  });

  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // GET /api/transactions/export — happy path
  // =========================================================================
  describe("GET /api/transactions/export — happy path", () => {
    const sentTx = horizonRecord({
      id: "tx-sent-1",
      hash: "hash-sent",
      ledger: 100,
      created_at: "2026-01-01T00:00:00Z",
      operations: [
        {
          from: USER_ADDRESS,
          to: OTHER_ADDRESS,
          amount: "25.0000000",
          asset_type: "native",
        },
      ],
    });
    const receivedTx = horizonRecord({
      id: "tx-received-1",
      hash: "hash-received",
      ledger: 101,
      created_at: "2026-01-02T00:00:00Z",
      operations: [
        {
          from: OTHER_ADDRESS,
          to: USER_ADDRESS,
          amount: "10.0000000",
          asset_type: "native",
        },
      ],
    });

    const SENT_ROW =
      `"tx-sent-1","hash-sent","100","2026-01-01T00:00:00Z","${USER_ADDRESS}","${OTHER_ADDRESS}",` +
      `"25.0000000","XLM","","none","true","sent"\n`;
    const RECEIVED_ROW =
      `"tx-received-1","hash-received","101","2026-01-02T00:00:00Z","${OTHER_ADDRESS}","${USER_ADDRESS}",` +
      `"10.0000000","XLM","","none","true","received"\n`;

    it("200 — streams the transaction history as a downloadable CSV", async () => {
      global.fetch = jest.fn().mockResolvedValue(horizonResponse([sentTx, receivedTx]));

      const res = await request(app)
        .get("/api/transactions/export")
        .query({ format: "csv", account: USER_ADDRESS })
        .set("Authorization", `Bearer ${bearerToken(USER_ADDRESS)}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["content-disposition"]).toMatch(
        /^attachment; filename="transactions-GAAAAAAA-\d{4}-\d{2}-\d{2}\.csv"$/
      );
      expect(res.text.startsWith(CSV_HEADER)).toBe(true);
      expect(res.text).toContain(SENT_ROW);
      expect(res.text).toContain(RECEIVED_ROW);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][0]).toContain(
        `/accounts/${encodeURIComponent(USER_ADDRESS)}/transactions`
      );
    });

    it("200 — applies the filter query parameter to the exported rows", async () => {
      global.fetch = jest.fn().mockResolvedValue(horizonResponse([sentTx, receivedTx]));

      const res = await request(app)
        .get("/api/transactions/export")
        .query({ format: "csv", account: USER_ADDRESS, filter: "sent" })
        .set("Authorization", `Bearer ${bearerToken(USER_ADDRESS)}`);

      expect(res.status).toBe(200);
      expect(res.text).toBe(CSV_HEADER + SENT_ROW);
    });
  });

  // =========================================================================
  // GET /api/transactions/export — authentication / authorisation
  // =========================================================================
  describe("GET /api/transactions/export — authentication / authorisation", () => {
    it("401 — rejects the request when no JWT is presented", async () => {
      global.fetch = jest.fn();

      const res = await request(app)
        .get("/api/transactions/export")
        .query({ format: "csv", account: USER_ADDRESS });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized: Missing or invalid token");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("401 — rejects the request when the JWT is invalid", async () => {
      global.fetch = jest.fn();

      const res = await request(app)
        .get("/api/transactions/export")
        .query({ format: "csv", account: USER_ADDRESS })
        .set("Authorization", "Bearer not-a-real-jwt.token.value");

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized: Invalid or expired token");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("403 — rejects exporting another user's transactions", async () => {
      global.fetch = jest.fn();

      const res = await request(app)
        .get("/api/transactions/export")
        .query({ format: "csv", account: USER_ADDRESS })
        .set("Authorization", `Bearer ${bearerToken(OTHER_ADDRESS)}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        "Forbidden: you may only export your own transactions"
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // GET /api/transactions/export — validation failures
  // =========================================================================
  describe("GET /api/transactions/export — validation failures", () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it("400 — rejects unsupported export formats", async () => {
      const res = await request(app)
        .get("/api/transactions/export")
        .query({ format: "json", account: USER_ADDRESS })
        .set("Authorization", `Bearer ${bearerToken(USER_ADDRESS)}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Unsupported format. Use format=csv");
    });

    it("400 — rejects a missing account parameter", async () => {
      const res = await request(app)
        .get("/api/transactions/export")
        .query({ format: "csv" })
        .set("Authorization", `Bearer ${bearerToken(USER_ADDRESS)}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Valid Stellar account address required");
    });

    it("400 — rejects a malformed Stellar account address", async () => {
      const res = await request(app)
        .get("/api/transactions/export")
        .query({ format: "csv", account: "not-a-stellar-address" })
        .set("Authorization", `Bearer ${bearerToken(USER_ADDRESS)}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Valid Stellar account address required");
    });
  });

  // =========================================================================
  // Not-found paths
  // =========================================================================
  describe("Not-found paths", () => {
    it("404 — unknown sub-route under /api/transactions", async () => {
      const res = await request(app).get("/api/transactions/does-not-exist");

      expect(res.status).toBe(404);
    });

    it("200 — Horizon 404 (account has no history) yields a header-only CSV", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

      const res = await request(app)
        .get("/api/transactions/export")
        .query({ format: "csv", account: USER_ADDRESS })
        .set("Authorization", `Bearer ${bearerToken(USER_ADDRESS)}`);

      expect(res.status).toBe(200);
      expect(res.text).toBe(CSV_HEADER);
    });
  });
});
