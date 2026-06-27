/**
 * src/db/pool.js
 * Shared PostgreSQL connection pool.
 * All services import this — never create a second Pool.
 */
"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");

const DATABASE_URL = requireEnv("DATABASE_URL");

const poolSize = parseInt(process.env.DATABASE_POOL_SIZE, 10) || 10;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: poolSize,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: true }
    : false,
});

pool.on("error", (err) => {
  console.error("[pg] Unexpected pool error:", err.message);
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
