/**
 * src/services/profileService.js
 * All data persisted in the `profiles` PostgreSQL table.
 */
"use strict";

const pool = require("../db/pool");

// ─── helpers ────────────────────────────────────────────────────────────────

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

/** Convert snake_case DB row → camelCase API object */
function rowToProfile(row) {
  return {
    publicKey:       row.public_key,
    displayName:     row.display_name,
    bio:             row.bio,
    skills:          row.skills,
    role:            row.role,
    completedJobs:   row.completed_jobs,
    totalEarnedXLM:  row.total_earned_xlm,
    rating:          row.rating !== null ? parseFloat(row.rating) : null,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

// ─── service functions ───────────────────────────────────────────────────────

async function getProfile(publicKey) {
  validatePublicKey(publicKey);

  const { rows } = await pool.query(
    `SELECT p.*,
       ROUND(AVG(r.stars)::numeric, 2) AS avg_rating,
       COUNT(r.id)::int                AS rating_count,
       -- Reputation metrics
       (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (a.accepted_at - j.created_at)) / 3600)::numeric, 1)
        FROM jobs j
        JOIN applications a ON a.job_id = j.id
        WHERE j.client_address = p.public_key AND a.status = 'accepted' AND a.accepted_at IS NOT NULL
       ) AS avg_accept_hours,
       (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (e.released_at - e.created_at)) / 3600)::numeric, 1)
        FROM escrows e
        JOIN jobs j ON j.id = e.job_id
        WHERE j.client_address = p.public_key AND e.status = 'released' AND e.released_at IS NOT NULL
       ) AS avg_release_hours
     FROM profiles p
     LEFT JOIN ratings r ON r.rated_address = p.public_key
     WHERE p.public_key = $1
     GROUP BY p.public_key`,
    [publicKey]
  );

  if (!rows.length) {
    const e = new Error("Profile not found");
    e.status = 404;
    throw e;
  }

  const profile = rowToProfile(rows[0]);
  profile.rating      = rows[0].avg_rating !== null ? parseFloat(rows[0].avg_rating) : null;
  profile.ratingCount = rows[0].rating_count;
  
  // Calculate reputation score (simple formula: higher weight on ratings, lower on time)
  // Max score 100.
  let repScore = 0;
  if (profile.rating) repScore += profile.rating * 15; // up to 75
  
  // Bonus for fast acceptance (avg < 24h)
  const acceptHours = parseFloat(rows[0].avg_accept_hours || 0);
  if (acceptHours > 0 && acceptHours < 24) repScore += 15;
  else if (acceptHours > 0 && acceptHours < 72) repScore += 10;
  
  // Bonus for fast release (avg < 48h)
  const releaseHours = parseFloat(rows[0].avg_release_hours || 0);
  if (releaseHours > 0 && releaseHours < 48) repScore += 10;
  else if (releaseHours > 0 && releaseHours < 168) repScore += 5;

  profile.reputationScore = Math.min(repScore, 100);
  profile.reputationMetrics = {
    avgAcceptHours: acceptHours,
    avgReleaseHours: releaseHours
  };

  return profile;
}

async function upsertProfile({ publicKey, displayName, bio, skills, role }) {
  validatePublicKey(publicKey);

  const safeSkills = Array.isArray(skills) ? skills.slice(0, 15) : null;

  // INSERT … ON CONFLICT lets us handle create-or-update atomically.
  const { rows } = await pool.query(
    `
    INSERT INTO profiles (public_key, display_name, bio, skills, role, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    ON CONFLICT (public_key) DO UPDATE
      SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), profiles.display_name),
          bio          = COALESCE(NULLIF(EXCLUDED.bio,          ''), profiles.bio),
          skills       = COALESCE(EXCLUDED.skills,                  profiles.skills),
          role         = COALESCE(NULLIF(EXCLUDED.role,         ''), profiles.role),
          updated_at   = NOW()
    RETURNING *
    `,
    [
      publicKey,
      displayName?.trim() || null,
      bio?.trim()         || null,
      safeSkills,
      role || "both",
    ]
  );

  return rowToProfile(rows[0]);
}

module.exports = { getProfile, upsertProfile };