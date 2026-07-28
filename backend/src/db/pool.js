"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");

const DATABASE_URL = requireEnv("DATABASE_URL");

const poolMin = parseInt(process.env.DATABASE_POOL_MIN, 10) || 2;
const poolMax = parseInt(process.env.DATABASE_POOL_MAX, 10) || parseInt(process.env.DATABASE_POOL_SIZE, 10) || 10;
const poolIdleTimeout = parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS, 10) || 30_000;
const poolConnectionTimeout = parseInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS, 10) || 5_000;

const ssl = process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : false;

const pool = new Pool({
  connectionString: DATABASE_URL,
  min: poolMin,
  max: poolMax,
  idleTimeoutMillis: poolIdleTimeout,
  connectionTimeoutMillis: poolConnectionTimeout,
  ssl,
});

pool.on("error", (err) => {
  console.error("[pg] Unexpected pool error:", err.message);
});

function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

// Log pool stats every 60 seconds
setInterval(() => {
  const stats = getPoolStats();
  console.log("[pg] Pool stats:", JSON.stringify(stats));
}, 60_000).unref();

module.exports = pool;
module.exports.getPoolStats = getPoolStats;
