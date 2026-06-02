"use strict";

const pool = require("../db/pool");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cacheKey(name, params = {}) {
  const dayKey = new Date().toISOString().slice(0, 10);
  return `${name}:${dayKey}:${JSON.stringify(params)}`;
}

async function withDailyCache(name, params, loader) {
  const key = cacheKey(name, params);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await loader();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function getCategoryInsights(limit = 20) {
  return withDailyCache("categories", { limit }, async () => {
    const { rows } = await pool.query(
      `
      WITH job_applications AS (
        SELECT
          j.id,
          j.category,
          j.client_address,
          j.budget::numeric AS budget,
          COALESCE(a.application_count, 0) AS application_count,
          COALESCE(a.accepted_count, 0) AS accepted_count
        FROM jobs j
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS application_count,
            COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_count
          FROM applications app
          WHERE app.job_id = j.id
        ) a ON TRUE
      )
      SELECT
        category,
        COUNT(*)::int AS total_jobs,
        ROUND(AVG(budget)::numeric, 7) AS avg_budget,
        ROUND(AVG(application_count)::numeric, 2) AS avg_applications_per_job,
        ROUND(
          COALESCE(SUM(accepted_count)::numeric / NULLIF(SUM(application_count)::numeric, 0) * 100, 0),
          2
        ) AS acceptance_rate,
        COUNT(*) FILTER (WHERE application_count < 5)::int AS low_competition_jobs,
        COUNT(DISTINCT client_address)::int AS unique_clients
      FROM job_applications
      GROUP BY category
      ORDER BY total_jobs DESC, avg_budget DESC
      LIMIT $1
      `,
      [limit]
    );

    return rows.map((row) => ({
      category: row.category,
      totalJobs: toNumber(row.total_jobs),
      avgBudget: toNumber(row.avg_budget),
      avgApplicationsPerJob: toNumber(row.avg_applications_per_job),
      acceptanceRate: toNumber(row.acceptance_rate),
      lowCompetitionJobs: toNumber(row.low_competition_jobs),
      uniqueClients: toNumber(row.unique_clients),
    }));
  });
}

async function getSkillInsights(limit = 20) {
  return withDailyCache("skills", { limit }, async () => {
    const { rows } = await pool.query(
      `
      WITH skill_rows AS (
        SELECT
          j.id,
          unnest(j.skills) AS skill
        FROM jobs j
        WHERE COALESCE(array_length(j.skills, 1), 0) > 0
      ),
      app_counts AS (
        SELECT job_id, COUNT(*)::int AS application_count
        FROM applications
        GROUP BY job_id
      )
      SELECT
        skill,
        COUNT(*)::int AS demand_count,
        ROUND(AVG(COALESCE(app_counts.application_count, 0))::numeric, 2) AS avg_applications_per_job,
        COUNT(*) FILTER (WHERE COALESCE(app_counts.application_count, 0) < 5)::int AS low_competition_jobs
      FROM skill_rows
      LEFT JOIN app_counts ON app_counts.job_id = skill_rows.id
      GROUP BY skill
      ORDER BY demand_count DESC, skill ASC
      LIMIT $1
      `,
      [limit]
    );

    return rows.map((row) => ({
      skill: row.skill,
      demandCount: toNumber(row.demand_count),
      avgApplicationsPerJob: toNumber(row.avg_applications_per_job),
      lowCompetitionJobs: toNumber(row.low_competition_jobs),
    }));
  });
}

async function getCompetitiveJobs(limit = 20) {
  return withDailyCache("competitive", { limit }, async () => {
    const { rows } = await pool.query(
      `
      WITH app_counts AS (
        SELECT job_id, COUNT(*)::int AS application_count
        FROM applications
        GROUP BY job_id
      )
      SELECT
        j.id,
        j.title,
        j.category,
        j.budget,
        j.currency,
        j.client_address,
        j.created_at,
        COALESCE(app_counts.application_count, 0) AS application_count,
        CASE
          WHEN COALESCE(app_counts.application_count, 0) = 0 THEN 'uncontested'
          WHEN COALESCE(app_counts.application_count, 0) < 3 THEN 'light'
          ELSE 'active'
        END AS competition_level
      FROM jobs j
      LEFT JOIN app_counts ON app_counts.job_id = j.id
      WHERE j.status = 'open'
        AND COALESCE(app_counts.application_count, 0) < 5
      ORDER BY application_count ASC, j.budget DESC, j.created_at DESC
      LIMIT $1
      `,
      [limit]
    );

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      budget: toNumber(row.budget),
      currency: row.currency,
      clientAddress: row.client_address,
      createdAt: row.created_at,
      applicationCount: toNumber(row.application_count),
      competitionLevel: row.competition_level,
    }));
  });
}

async function getPayTrends(days = 30) {
  return withDailyCache("pay-trends", { days }, async () => {
    const { rows } = await pool.query(
      `
      SELECT
        DATE_TRUNC('day', created_at)::date AS date,
        category,
        ROUND(AVG(budget)::numeric, 7) AS avg_budget,
        COUNT(*)::int AS job_count
      FROM jobs
      WHERE created_at >= NOW() - ($1 || ' days')::interval
      GROUP BY DATE_TRUNC('day', created_at), category
      ORDER BY date ASC, category ASC
      `,
      [days]
    );

    return rows.map((row) => ({
      date: row.date,
      category: row.category,
      avgBudget: toNumber(row.avg_budget),
      jobCount: toNumber(row.job_count),
    }));
  });
}

async function getClientMix() {
  return withDailyCache("client-mix", {}, async () => {
    const { rows } = await pool.query(
      `
      WITH first_posts AS (
        SELECT client_address, MIN(created_at) AS first_post_at
        FROM jobs
        GROUP BY client_address
      )
      SELECT
        COUNT(*) FILTER (WHERE first_post_at >= NOW() - INTERVAL '30 days')::int AS new_clients,
        COUNT(*) FILTER (WHERE first_post_at < NOW() - INTERVAL '30 days')::int AS returning_clients,
        COUNT(*)::int AS total_clients
      FROM first_posts
      `
    );

    const row = rows[0] || {};
    return {
      newClients: toNumber(row.new_clients),
      returningClients: toNumber(row.returning_clients),
      totalClients: toNumber(row.total_clients),
    };
  });
}

module.exports = {
  getCategoryInsights,
  getSkillInsights,
  getCompetitiveJobs,
  getPayTrends,
  getClientMix,
};
