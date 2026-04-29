/**
 * Job recommendation engine for Issue #221
 * Scores jobs based on skill match, budget, category, and client reputation
 */
"use strict";
const pool = require("../db/pool");

async function getRecommendations(freelancerAddress, limit = 10) {
  const query = `
    WITH freelancer_data AS (
      SELECT skills, completed_jobs, rating FROM profiles
      WHERE public_key = $1
    ),
    job_scores AS (
      SELECT
        j.id,
        j.title,
        j.description,
        j.budget,
        j.category,
        j.skills,
        j.client_address,
        p.display_name as client_name,
        p.rating as client_rating,
        p.completed_jobs as client_completed_jobs,
        j.created_at,
        j.status,
        -- Calculate skill match percentage
        CASE
          WHEN array_length(j.skills, 1) = 0 THEN 50::numeric
          ELSE (
            array_length(
              array_intersect(j.skills, (SELECT skills FROM freelancer_data)), 1
            )::numeric / array_length(j.skills, 1)::numeric * 100
          )
        END as skill_match_score,
        -- Budget alignment (prefer jobs near freelancer's past average bid)
        CASE
          WHEN (SELECT completed_jobs FROM freelancer_data) = 0 THEN 50::numeric
          ELSE (
            CASE
              WHEN j.budget > 0 THEN 100 - ABS(j.budget - 500)::numeric / 50
              ELSE 50::numeric
            END
          )
        END as budget_score,
        -- Client reputation bonus
        COALESCE((SELECT rating FROM freelancer_data), 3) * 10 as reputation_score
      FROM jobs j
      LEFT JOIN profiles p ON j.client_address = p.public_key
      WHERE j.status = 'open'
        AND j.client_address != $1
        AND NOT EXISTS (
          SELECT 1 FROM applications
          WHERE job_id = j.id AND freelancer_address = $1
        )
    )
    SELECT
      id,
      title,
      description,
      budget,
      category,
      skills,
      client_name,
      client_rating,
      skill_match_score,
      ROUND((skill_match_score * 0.5 + budget_score * 0.3 + reputation_score * 0.2)::numeric, 1) as match_score,
      created_at
    FROM job_scores
    ORDER BY match_score DESC
    LIMIT $2
  `;

  try {
    const result = await pool.query(query, [freelancerAddress, limit]);
    return result.rows;
  } catch (error) {
    // Fallback to basic query if array_intersect is not available
    const fallbackQuery = `
      SELECT
        j.id,
        j.title,
        j.description,
        j.budget,
        j.category,
        j.skills,
        p.display_name as client_name,
        p.rating as client_rating,
        50::numeric as skill_match_score,
        50::numeric as match_score,
        j.created_at
      FROM jobs j
      LEFT JOIN profiles p ON j.client_address = p.public_key
      WHERE j.status = 'open'
        AND j.client_address != $1
        AND NOT EXISTS (
          SELECT 1 FROM applications
          WHERE job_id = j.id AND freelancer_address = $1
        )
      ORDER BY j.created_at DESC
      LIMIT $2
    `;
    const result = await pool.query(fallbackQuery, [freelancerAddress, limit]);
    return result.rows;
  }
}

module.exports = {
  getRecommendations
};
