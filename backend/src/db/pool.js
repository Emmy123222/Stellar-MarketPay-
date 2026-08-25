"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");
const { createServiceLogger } = require("../utils/logger");
// Metrics live in ../metrics so low-level modules can record into the shared
// registry without importing the server (which would create a require cycle).
const {
  dbConnections,
  pgPoolTotal,
  pgPoolIdle,
  pgPoolWaiting,
  observePoolQuery,
  sqlOperation,
} = require("../metrics");

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

// ─── Query latency instrumentation (pool_query_duration_ms) ───────────────────
// Wrap `pool.query` so every statement executed through the shared pool is
// timed, regardless of which service issued it. Only the leading SQL verb is
// used as a label, keeping metric cardinality bounded and never exposing query
// parameters. Callback-style invocations are passed through untouched by pg.
const originalQuery = pool.query.bind(pool);

pool.query = function instrumentedQuery(...args) {
  const operation = sqlOperation(args[0]);
  const start = process.hrtime.bigint();

  /**
   * Convert the elapsed time since `start` into fractional milliseconds.
   *
   * @returns {number} elapsed milliseconds
   */
  const elapsedMs = () => Number(process.hrtime.bigint() - start) / 1e6;

  // Callback form: pg invokes the callback instead of returning a promise.
  const last = args[args.length - 1];
  if (typeof last === "function") {
    const done = last;
    args[args.length - 1] = function instrumentedCallback(err, result) {
      observePoolQuery(operation, err ? "error" : "success", elapsedMs());
      return done(err, result);
    };
    return originalQuery(...args);
  }

  let result;
  try {
    result = originalQuery(...args);
  } catch (err) {
    observePoolQuery(operation, "error", elapsedMs());
    throw err;
  }

  if (!result || typeof result.then !== "function") {
    observePoolQuery(operation, "success", elapsedMs());
    return result;
  }

  return result.then(
    (value) => {
      observePoolQuery(operation, "success", elapsedMs());
      return value;
    },
    (err) => {
      observePoolQuery(operation, "error", elapsedMs());
      throw err;
    }
  );
};

// ─── Pool saturation gauges ───────────────────────────────────────────────────
// Scrape-time collectors keep the gauges accurate without a polling timer.
dbConnections.collect = function collectDbConnections() {
  this.set({ state: "total" }, pool.totalCount);
  this.set({ state: "idle" }, pool.idleCount);
  this.set({ state: "waiting" }, pool.waitingCount);
};
pgPoolTotal.collect = function collectPgPoolTotal() {
  this.set(pool.totalCount);
};
pgPoolIdle.collect = function collectPgPoolIdle() {
  this.set(pool.idleCount);
};
pgPoolWaiting.collect = function collectPgPoolWaiting() {
  this.set(pool.waitingCount);
};

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
