/**
 * Platform statistics service for Issue #232
 * Aggregates and serves platform-wide metrics.
 *
 * Issue #232 perf (V57): reads from the platform_stats_mv materialized view
 * instead of running live COUNT(*) queries.  The MV is refreshed every
 * STATS_REFRESH_INTERVAL_MS (default 5 min) by scheduleStatsRefresh().
 */
"use strict";
const pool = require("../db/pool");

/** How often (ms) to run REFRESH MATERIALIZED VIEW CONCURRENTLY. */
const STATS_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Refresh the platform_stats_mv materialized view.
 *
 * CONCURRENTLY means readers are never blocked — Postgres holds only a
 * ShareUpdateExclusiveLock instead of an ExclusiveLock.  The unique index
 * platform_stats_mv_singleton_idx (added in V57) is required for this mode.
 *
 * @returns {Promise<{refreshed_at: string}>}
 */
async function computeStats() {
  await pool.query(
    "REFRESH MATERIALIZED VIEW CONCURRENTLY platform_stats_mv"
  );
  const { rows } = await pool.query("SELECT * FROM platform_stats_mv LIMIT 1");
  return rows[0] ?? null;
}

/**
 * Return the current pre-computed platform statistics from the MV.
 * Falls back to a live refresh if the MV has no rows yet (cold-start).
 *
 * @returns {Promise<object>}
 */
async function getStats() {
  const { rows } = await pool.query(
    "SELECT * FROM platform_stats_mv LIMIT 1"
  );
  if (!rows[0]) {
    // MV is empty (first startup before first refresh) — populate it now.
    return computeStats();
  }
  return rows[0];
}

/**
 * Start a background setInterval that refreshes the materialized view every
 * STATS_REFRESH_INTERVAL_MS.  Call this once from server.js after the DB pool
 * is ready.  Errors are logged but do NOT crash the process.
 *
 * @returns {NodeJS.Timeout} The interval handle (pass to clearInterval to stop).
 */
function scheduleStatsRefresh() {
  const interval = setInterval(async () => {
    try {
      await pool.query(
        "REFRESH MATERIALIZED VIEW CONCURRENTLY platform_stats_mv"
      );
    } catch (err) {
      // Non-fatal: the stale MV value is still served until the next cycle.
      console.error("[statsService] MV refresh failed:", err.message);
    }
  }, STATS_REFRESH_INTERVAL_MS);

  // Allow the process to exit even if this interval is still pending.
  if (interval.unref) interval.unref();

  return interval;
}

async function getJobTrends(days = 90) {
  const query = `
    SELECT
      DATE_TRUNC('day', created_at)::date as date,
      COUNT(*) as jobs_posted,
      COALESCE(AVG(budget), 0) as avg_budget
    FROM jobs
    WHERE created_at > NOW() - INTERVAL $1
      AND deleted_at IS NULL
    GROUP BY DATE_TRUNC('day', created_at)
    ORDER BY date DESC
  `;

  const result = await pool.query(query, [`${days} days`]);
  return result.rows;
}

async function getEscrowTrends(days = 90) {
  const query = `
    SELECT
      DATE_TRUNC('day', created_at)::date as date,
      COUNT(*) as escrow_count,
      COALESCE(SUM(amount_xlm), 0) as total_amount
    FROM escrows
    WHERE created_at > NOW() - INTERVAL $1
    GROUP BY DATE_TRUNC('day', created_at)
    ORDER BY date DESC
  `;

  const result = await pool.query(query, [`${days} days`]);
  return result.rows;
}

async function getTopCategories(limit = 10) {
  const query = `
    SELECT
      category,
      COUNT(*) as job_count,
      COALESCE(AVG(budget), 0) as avg_budget
    FROM jobs
    WHERE status IN ('open', 'assigned', 'in_progress', 'completed')
      AND deleted_at IS NULL
    GROUP BY category
    ORDER BY job_count DESC
    LIMIT $1
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

// Issue #561: Hourly aggregation into platform_metrics
async function aggregatePlatformMetrics() {
  const bucket = new Date();
  bucket.setMinutes(0, 0, 0);

  const queries = [
    {
      metric: "total_jobs",
      sql: "SELECT COUNT(*)::numeric AS value FROM jobs WHERE deleted_at IS NULL",
    },
    {
      metric: "total_escrow_volume_xlm",
      sql: "SELECT COALESCE(SUM(amount_xlm), 0) AS value FROM escrows WHERE status = 'funded'",
    },
    {
      metric: "active_users",
      sql: "SELECT COUNT(DISTINCT public_key)::numeric AS value FROM profiles WHERE deleted_at IS NULL",
    },
    {
      metric: "dispute_rate",
      sql: `SELECT COALESCE(
        ROUND(
          COUNT(*) FILTER (WHERE status = 'disputed')::numeric /
          NULLIF(COUNT(*)::numeric, 0) * 100, 2
        ), 0
      ) AS value FROM jobs WHERE deleted_at IS NULL`,
    },
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { metric, sql } of queries) {
      const { rows } = await client.query(sql);
      const value = rows[0]?.value ?? 0;
      await client.query(
        `INSERT INTO platform_metrics (metric_name, value, granularity, bucket, created_at)
         VALUES ($1, $2, 'hour', $3, NOW())
         ON CONFLICT (metric_name, granularity, bucket)
         DO UPDATE SET value = EXCLUDED.value, created_at = NOW()`,
        [metric, value, bucket]
      );
    }
    await client.query("COMMIT");
    return { success: true, bucket: bucket.toISOString() };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Issue #561: Get time-series metrics from platform_metrics
async function getTimeSeriesMetrics({ metric = "total_jobs", from, to, granularity = "day" } = {}) {
  const conditions = ["metric_name = $1", "granularity = $2"];
  const params = [metric, granularity];
  let paramIdx = 3;

  if (from) {
    conditions.push(`bucket >= $${paramIdx}`);
    params.push(from);
    paramIdx++;
  }
  if (to) {
    conditions.push(`bucket <= $${paramIdx}`);
    params.push(to);
  }

  const where = conditions.join(" AND ");
  const { rows } = await pool.query(
    `SELECT metric_name, value, granularity, bucket
     FROM platform_metrics
     WHERE ${where}
     ORDER BY bucket ASC`,
    params
  );
  return rows;
}

module.exports = {
  computeStats,
  getStats,
  getJobTrends,
  getEscrowTrends,
  getTopCategories,
  aggregatePlatformMetrics,
  getTimeSeriesMetrics,
  scheduleStatsRefresh,
  STATS_REFRESH_INTERVAL_MS,
};
