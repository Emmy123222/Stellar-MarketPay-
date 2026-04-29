/**
 * Platform statistics service for Issue #232
 * Aggregates and serves platform-wide metrics
 */
"use strict";
const pool = require("../db/pool");

async function computeStats() {
  const query = `
    WITH stats AS (
      SELECT
        (SELECT COUNT(*) FROM jobs) as total_jobs,
        (SELECT COUNT(DISTINCT client_address) FROM jobs) as total_clients,
        (SELECT COUNT(DISTINCT freelancer_address) FROM jobs WHERE freelancer_address IS NOT NULL) as total_freelancers,
        (SELECT COUNT(DISTINCT public_key) FROM profiles WHERE completed_jobs > 0 OR role = 'client') as active_users,
        (SELECT COALESCE(SUM(amount_xlm), 0) FROM escrows WHERE status = 'funded') as total_escrow_xlm,
        (SELECT COALESCE(AVG(budget), 0) FROM jobs WHERE status IN ('assigned', 'in_progress', 'completed')) as avg_job_budget,
        (SELECT COUNT(*) FILTER (WHERE status = 'completed') * 100.0 / COUNT(*) FROM jobs WHERE status IN ('completed', 'cancelled')) as completion_rate
    )
    UPDATE platform_stats
    SET
      total_jobs_posted = (SELECT total_jobs FROM stats),
      active_users_30d = (SELECT active_users FROM stats),
      total_escrow_xlm = (SELECT total_escrow_xlm FROM stats),
      avg_job_budget = (SELECT avg_job_budget FROM stats),
      completion_rate = COALESCE((SELECT completion_rate FROM stats), 0),
      last_updated = NOW()
    WHERE id = 1
    RETURNING *
  `;

  const result = await pool.query(query);
  return result.rows[0];
}

async function getStats() {
  const query = `
    SELECT
      total_jobs_posted,
      total_escrow_xlm,
      active_users_30d,
      completion_rate,
      avg_job_budget,
      last_updated
    FROM platform_stats
    WHERE id = 1
  `;

  const result = await pool.query(query);
  if (!result.rows[0]) {
    return await computeStats();
  }
  return result.rows[0];
}

async function getJobTrends(days = 90) {
  const query = `
    SELECT
      DATE_TRUNC('day', created_at)::date as date,
      COUNT(*) as jobs_posted,
      COALESCE(AVG(budget), 0) as avg_budget
    FROM jobs
    WHERE created_at > NOW() - INTERVAL $1
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
    GROUP BY category
    ORDER BY job_count DESC
    LIMIT $1
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

module.exports = {
  computeStats,
  getStats,
  getJobTrends,
  getEscrowTrends,
  getTopCategories
};
