/**
 * src/db/pool.js
 * Shared PostgreSQL connection pool.
 * All services import this — never create a second Pool.
 */
"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");

const DATABASE_URL = requireEnv("DATABASE_URL");

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
  connectionTimeoutMillis: 5_000,
  // Enforce SSL in production but allow plain-text in local Docker.
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: true }
    : false,
});

pool.on("error", (err) => {
  console.error("[pg] Unexpected pool error:", err.message);
});

module.exports = pool;
