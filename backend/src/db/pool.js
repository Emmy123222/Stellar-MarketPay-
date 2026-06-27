"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");

const DATABASE_URL = requireEnv("DATABASE_URL");

const poolSize = parseInt(process.env.DATABASE_POOL_SIZE, 10) || 10;

const ssl = process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : false;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: poolSize,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
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

module.exports = pool;
module.exports.getPoolStats = getPoolStats;
