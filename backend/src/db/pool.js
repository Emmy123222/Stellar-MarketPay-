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

const poolSize = parseInt(process.env.DATABASE_POOL_SIZE, 10) || 10;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: poolSize,
  idleTimeoutMillis: 30_000,
const SSL_CONFIG = process.env.NODE_ENV === "production"
  ? { rejectUnauthorized: true }
  : false;

const POOL_DEFAULTS = {
  max:                    10,
  idleTimeoutMillis:      30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: true }
    : false,
});

writePool.on("error", (err) => {
  console.error("[pg:write] Unexpected pool error:", err.message);
});

/**
 * Returns current pool stats for health monitoring.
 * @returns {{ total: number, idle: number, waiting: number }}
 */
function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

module.exports = pool;
module.exports.getPoolStats = getPoolStats;
