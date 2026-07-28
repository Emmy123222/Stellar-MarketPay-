"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");
const { createServiceLogger } = require("../utils/logger");

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

/**
 * Attempt an initial `pool.connect()` health-check with exponential back-off.
 *
 * Retry schedule (jitter-free, capped at 30 s):
 *   attempt 1 → wait 1 s
 *   attempt 2 → wait 2 s
 *   attempt 3 → wait 4 s
 *   …
 *   attempt 9 → wait 30 s  (cap)
 *
 * @param {object} [opts]
 * @param {number}  [opts.maxAttempts=10]   Maximum number of attempts.
 * @param {number}  [opts.baseDelayMs=1000] Delay after the 1st failure (ms).
 * @param {number}  [opts.maxDelayMs=30000] Upper cap for the delay (ms).
 * @returns {Promise<void>} Resolves when a connection is acquired; rejects (and
 *   calls `process.exit(1)`) when all attempts are exhausted.
 */
async function connectWithRetry({
  maxAttempts = 10,
  baseDelayMs = 1_000,
  maxDelayMs = 30_000,
} = {}) {
  const logger = createServiceLogger("db-pool");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = await pool.connect();
      client.release();
      logger.info({ attempt }, "Database connection established");
      return;
    } catch (err) {
      const isLast = attempt === maxAttempts;

      if (isLast) {
        logger.error(
          { attempt, maxAttempts, err: err.message },
          "Database connection failed — all retry attempts exhausted, shutting down"
        );
        process.exit(1);
      }

      // Exponential back-off: 2^(attempt-1) * baseDelayMs, capped at maxDelayMs
      const delayMs = Math.min(
        Math.pow(2, attempt - 1) * baseDelayMs,
        maxDelayMs
      );

      logger.warn(
        { attempt, maxAttempts, delayMs, err: err.message },
        `Database connection attempt ${attempt}/${maxAttempts} failed — retrying in ${delayMs}ms`
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = pool;
module.exports.getPoolStats = getPoolStats;
module.exports.connectWithRetry = connectWithRetry;
