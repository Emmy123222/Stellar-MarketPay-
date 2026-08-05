"use strict";

/**
 * @typedef {{ query: (text: string, values?: unknown[]) => Promise<{rows: Object[]}> }} Queryable
 * @typedef {{ jobId: string|number }} FindApplicationsByJobParams
 */

/**
 * Find visible applications for a job with their freelancer summary data.
 *
 * @param {Queryable} db
 * @param {FindApplicationsByJobParams} params
 * @returns {Promise<Object[]>} Application rows ordered by creation time.
 */
async function findApplicationsByJob(db, { jobId }) {
  const { rows } = await db.query(
    `SELECT a.*,
            COALESCE(p.completed_jobs, 0) AS completed_jobs,
            COALESCE(p.total_earned_xlm, 0) AS total_earned_xlm,
            p.created_at AS profile_created_at,
            COUNT(DISTINCT fj.id)::int AS total_jobs,
            ROUND(AVG(r.stars)::numeric, 2) AS avg_rating
     FROM applications a
     LEFT JOIN profiles p ON p.public_key = a.freelancer_address
     LEFT JOIN ratings r ON r.rated_address = a.freelancer_address
     LEFT JOIN jobs fj ON fj.freelancer_address = a.freelancer_address
     WHERE a.job_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM profiles cp
         WHERE cp.public_key = (SELECT client_address FROM jobs WHERE id = $1)
           AND a.freelancer_address = ANY(cp.blocked_addresses)
       )
     GROUP BY a.id, p.completed_jobs, p.total_earned_xlm, p.created_at
     ORDER BY a.created_at ASC`,
    [jobId],
  );
  return rows;
}

module.exports = { findApplicationsByJob };
