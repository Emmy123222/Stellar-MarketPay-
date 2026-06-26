/**
 * src/db/pool.js
 * PostgreSQL connection pools — write pool (primary) and read pool (replica).
 *
 * Import:
 *   const { readPool, writePool } = require("../db/pool");
 *
 * Use readPool  for all SELECT queries.
 * Use writePool for all INSERT / UPDATE / DELETE / DDL queries.
 *
 * Backward-compat: the module default export is writePool so existing code
 * that does `const pool = require("../db/pool")` continues to work.
 */
"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");

const DATABASE_URL     = requireEnv("DATABASE_URL");
const DATABASE_READ_URL = process.env.DATABASE_READ_URL || null;

/**
 * Maximum number of connections in the pool.
 *
 * Defaults to 10 (production-safe). In high-concurrency or load-test
 * environments set `DB_POOL_MAX` higher (e.g. 50) so concurrent requests do
 * not queue behind an undersized pool.
 */
function resolvePoolMax() {
  const raw = Number(process.env.DB_POOL_MAX);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return 10;
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Keep a modest pool; tune per deployment via DB_POOL_MAX.
  max: resolvePoolMax(),
  idleTimeoutMillis: 30_000,
const SSL_CONFIG = process.env.NODE_ENV === "production"
  ? { rejectUnauthorized: true }
  : false;

const POOL_DEFAULTS = {
  max:                    10,
  idleTimeoutMillis:      30_000,
  connectionTimeoutMillis: 5_000,
  ssl: SSL_CONFIG,
};

// ── Write pool (primary) ──────────────────────────────────────────────────────
const writePool = new Pool({
  ...POOL_DEFAULTS,
  connectionString: DATABASE_URL,
});

writePool.on("error", (err) => {
  console.error("[pg:write] Unexpected pool error:", err.message);
});

// ── Read pool (replica with primary fallback) ─────────────────────────────────
let readPool;

if (DATABASE_READ_URL) {
  const replicaPool = new Pool({
    ...POOL_DEFAULTS,
    connectionString: DATABASE_READ_URL,
  });

  replicaPool.on("error", (err) => {
    console.error("[pg:read] Replica pool error — reads will fall back to primary:", err.message);
  });

  // Proxy: attempt the replica; on connection error, retry once against primary.
  readPool = {
    query: async (...args) => {
      try {
        return await replicaPool.query(...args);
      } catch (err) {
        if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "57P01") {
          console.warn("[pg:read] Replica unavailable, falling back to primary for this query");
          return writePool.query(...args);
        }
        throw err;
      }
    },
    connect: async () => {
      try {
        return await replicaPool.connect();
      } catch (err) {
        if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "57P01") {
          console.warn("[pg:read] Replica unavailable, falling back to primary for client connection");
          return writePool.connect();
        }
        throw err;
      }
    },
    end: () => replicaPool.end(),
  };
} else {
  // No replica configured — both pools point to the same primary.
  readPool = writePool;
}

// Backward-compatible default export: writePool.
module.exports = writePool;
module.exports.readPool  = readPool;
module.exports.writePool = writePool;
