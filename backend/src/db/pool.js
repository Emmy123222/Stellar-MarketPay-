"use strict";

const { Pool } = require("pg");
const { requireEnv } = require("../config/env");
const {
  sqlOperation,
  observePoolQuery,
  dbConnections,
  pgPoolTotal,
  pgPoolIdle,
  pgPoolWaiting,
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

// Log pool stats every 60 seconds
setInterval(() => {
  const stats = getPoolStats();
  console.log("[pg] Pool stats:", JSON.stringify(stats));
}, 60_000).unref();

module.exports = pool;
module.exports.getPoolStats = getPoolStats;
