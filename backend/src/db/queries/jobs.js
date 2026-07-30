"use strict";

/**
 * @typedef {{ query: (text: string, values?: unknown[]) => Promise<{rows: Object[]}> }} Queryable
 * @typedef {{ id: string|number, includeDeleted?: boolean }} FindJobByIdParams
 * @typedef {{ selectColumns: string, conditions: string[], params: unknown[], orderClause: string, limit: number }} ListJobsParams
 */

/**
 * Find one job, optionally including soft-deleted records.
 *
 * @param {Queryable} db
 * @param {FindJobByIdParams} params
 * @returns {Promise<Object|null>} The job row, or null when it does not exist.
 */
async function findJobById(db, { id, includeDeleted = false }) {
  const deletedFilter = includeDeleted ? "" : "AND deleted_at IS NULL";
  const { rows } = await db.query(
    `SELECT * FROM jobs WHERE id = $1 ${deletedFilter}`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Execute the typed list-jobs query assembled from validated service filters.
 *
 * @param {Queryable} db
 * @param {ListJobsParams} query
 * @returns {Promise<Object[]>} Job rows in the requested order.
 */
async function listJobs(db, {
  selectColumns,
  conditions,
  params,
  orderClause,
  limit,
}) {
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const values = [...params, limit];
  const { rows } = await db.query(
    `SELECT ${selectColumns}, COALESCE(agg.skills, '{}') AS skills
     FROM jobs
     LEFT JOIN LATERAL (
       SELECT array_agg(s.display_name ORDER BY s.display_name) AS skills
       FROM job_skills js
       JOIN skills s ON s.id = js.skill_id
       WHERE js.job_id = jobs.id
     ) agg ON true
     ${where}
     ORDER BY ${orderClause}
     LIMIT $${values.length}`,
    values,
  );
  return rows;
}

module.exports = { findJobById, listJobs };
