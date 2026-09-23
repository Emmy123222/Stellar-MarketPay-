/**
 * src/services/reputationService.js
 *
 * Issue #1561: On-chain reputation score visible to all parties before a job
 * starts.
 *
 * The score (0–100) blends five signals so clients and freelancers can judge
 * each other beyond raw star ratings:
 *
 *   Completed jobs        30 pts  — saturates at 20 completed jobs
 *   Dispute rate          25 pts  — share of the user's engaged jobs that were disputed
 *   Response time         15 pts  — avg hours to reply to messages / applications
 *   Star rating           20 pts  — avg stars, weighted by rating count
 *   Referral quality      10 pts  — share of referees who completed a job
 *
 * Signals with no data yet contribute a neutral half-weight so new users are
 * not punished for, e.g., never having referred anyone.
 *
 * Scores are stored in `reputation_scores` and recalculated asynchronously via
 * scheduleReputationRecalc() after each escrow release, dispute resolution and
 * rating. GET /api/reputation/:userId reads the stored row (computing it lazily
 * on first access) and exposes an integer form for future cross-contract use.
 */
"use strict";

const pool = require("../db/pool");
const { createServiceLogger, logError } = require("../utils/logger");

const logger = createServiceLogger("reputation");

const WEIGHTS = {
  completedJobs: 30,
  disputeRate: 25,
  responseTime: 15,
  rating: 20,
  referralQuality: 10,
};

const COMPLETED_JOBS_SATURATION = 20;
const RESPONSE_HOURS_CEILING = 72; // replying after 3 days scores 0
const RATING_CONFIDENCE_COUNT = 5; // ratings needed for full rating weight
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

/**
 * Gather the raw reputation inputs for a user from the database.
 *
 * @param {string} publicKey
 * @param {Object} [queryRunner=pool]
 */
async function collectMetrics(publicKey, queryRunner = pool) {
  const { rows } = await queryRunner.query(
    `
    WITH engaged_jobs AS (
      SELECT id, status, disputed_at
      FROM jobs
      WHERE (client_address = $1 OR freelancer_address = $1)
        AND freelancer_address IS NOT NULL
    ),
    message_replies AS (
      SELECT EXTRACT(EPOCH FROM (reply.created_at - m.created_at)) / 3600.0 AS hours
      FROM messages m
      JOIN LATERAL (
        SELECT r.created_at
        FROM messages r
        WHERE r.job_id = m.job_id
          AND r.sender_address = $1
          AND r.receiver_address = m.sender_address
          AND r.created_at > m.created_at
        ORDER BY r.created_at ASC
        LIMIT 1
      ) reply ON TRUE
      WHERE m.receiver_address = $1
        AND m.created_at > NOW() - INTERVAL '180 days'
    ),
    application_replies AS (
      SELECT EXTRACT(EPOCH FROM (a.accepted_at - a.created_at)) / 3600.0 AS hours
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      WHERE j.client_address = $1
        AND a.accepted_at IS NOT NULL
        AND a.accepted_at >= a.created_at
    ),
    referral_outcomes AS (
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (
          WHERE r.status = 'paid'
             OR EXISTS (
               SELECT 1 FROM escrows e
               JOIN jobs j ON j.id = e.job_id
               WHERE j.freelancer_address = r.referee_address
                 AND e.status = 'released'
             )
        ) AS converted
      FROM referrals r
      WHERE r.referrer_address = $1
        AND r.status <> 'ineligible'
    )
    SELECT
      (SELECT COUNT(*) FROM engaged_jobs WHERE status = 'completed')::int                  AS completed_jobs,
      (SELECT COUNT(*) FROM engaged_jobs)::int                                             AS engaged_jobs,
      (SELECT COUNT(*) FROM engaged_jobs
         WHERE disputed_at IS NOT NULL OR status = 'disputed')::int                       AS disputed_jobs,
      (SELECT AVG(hours) FROM message_replies)                                             AS msg_response_hours,
      (SELECT AVG(hours) FROM application_replies)                                         AS app_response_hours,
      (SELECT AVG(stars) FROM ratings WHERE rated_address = $1)                            AS avg_rating,
      (SELECT COUNT(*) FROM ratings WHERE rated_address = $1)::int                         AS rating_count,
      (SELECT total FROM referral_outcomes)::int                                           AS referral_total,
      (SELECT converted FROM referral_outcomes)::int                                       AS referral_converted
    `,
    [publicKey],
  );

  const r = rows[0] || {};
  const toNum = (v) => (v == null ? null : Number(v));

  const msgHours = toNum(r.msg_response_hours);
  const appHours = toNum(r.app_response_hours);
  const responseSamples = [msgHours, appHours].filter((v) => v != null && Number.isFinite(v));

  return {
    completedJobs: Number(r.completed_jobs) || 0,
    engagedJobs: Number(r.engaged_jobs) || 0,
    disputedJobs: Number(r.disputed_jobs) || 0,
    avgResponseHours: responseSamples.length
      ? responseSamples.reduce((a, b) => a + b, 0) / responseSamples.length
      : null,
    avgRating: toNum(r.avg_rating),
    ratingCount: Number(r.rating_count) || 0,
    referralTotal: Number(r.referral_total) || 0,
    referralConverted: Number(r.referral_converted) || 0,
  };
}

/**
 * Pure scoring function — turns raw metrics into a 0–100 score.
 * Exported for unit testing.
 *
 * @param {Object} m  Metrics as returned by collectMetrics().
 */
function computeScore(m) {
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  const disputeRate = m.engagedJobs > 0 ? clamp01(m.disputedJobs / m.engagedJobs) : 0;
  const referralQuality = m.referralTotal > 0 ? clamp01(m.referralConverted / m.referralTotal) : 0;

  const completedPart = clamp01(m.completedJobs / COMPLETED_JOBS_SATURATION);
  const disputePart = m.engagedJobs > 0 ? 1 - disputeRate : 0.5;
  const responsePart =
    m.avgResponseHours == null ? 0.5 : clamp01(1 - m.avgResponseHours / RESPONSE_HOURS_CEILING);

  // Blend the average rating toward neutral until enough ratings are collected.
  let ratingPart = 0.5;
  if (m.ratingCount > 0 && m.avgRating != null) {
    const confidence = clamp01(m.ratingCount / RATING_CONFIDENCE_COUNT);
    const normalized = clamp01((m.avgRating - 1) / 4);
    ratingPart = 0.5 * (1 - confidence) + normalized * confidence;
  }
  const referralPart = m.referralTotal > 0 ? referralQuality : 0.5;

  const score =
    completedPart * WEIGHTS.completedJobs +
    disputePart * WEIGHTS.disputeRate +
    responsePart * WEIGHTS.responseTime +
    ratingPart * WEIGHTS.rating +
    referralPart * WEIGHTS.referralQuality;

  return {
    score: Number(Math.max(0, Math.min(100, score)).toFixed(2)),
    disputeRate: Number(disputeRate.toFixed(4)),
    referralQuality: Number(referralQuality.toFixed(4)),
  };
}

/**
 * Map a score to a human-readable label for badges.
 */
function scoreLabel(score, { completedJobs = 0, ratingCount = 0 } = {}) {
  if (completedJobs === 0 && ratingCount === 0) return "New";
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Trusted";
  if (score >= 50) return "Established";
  return "Building";
}

function rowToReputation(row) {
  const score = Number(row.score);
  const completedJobs = Number(row.completed_jobs);
  const ratingCount = Number(row.rating_count);
  return {
    userId: row.user_id,
    score,
    // Integer basis-point form (0–10000) for Soroban contracts, which have no floats.
    scoreBps: Math.round(score * 100),
    label: scoreLabel(score, { completedJobs, ratingCount }),
    completedJobs,
    disputeRate: Number(row.dispute_rate),
    avgResponseHours: row.avg_response_hours == null ? null : Number(row.avg_response_hours),
    avgRating: row.avg_rating == null ? null : Number(row.avg_rating),
    ratingCount,
    referralQuality: Number(row.referral_quality),
    updatedAt: row.updated_at,
  };
}

/**
 * Recalculate and persist the reputation score for a user.
 *
 * @param {string} publicKey
 * @returns {Promise<Object|null>} The stored reputation, or null if the user has no profile.
 */
async function recalculateReputation(publicKey) {
  validatePublicKey(publicKey);

  const metrics = await collectMetrics(publicKey);
  const { score, disputeRate, referralQuality } = computeScore(metrics);

  try {
    const { rows } = await pool.query(
      `INSERT INTO reputation_scores
         (user_id, score, completed_jobs, dispute_rate, avg_response_hours,
          avg_rating, rating_count, referral_quality, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         score              = EXCLUDED.score,
         completed_jobs     = EXCLUDED.completed_jobs,
         dispute_rate       = EXCLUDED.dispute_rate,
         avg_response_hours = EXCLUDED.avg_response_hours,
         avg_rating         = EXCLUDED.avg_rating,
         rating_count       = EXCLUDED.rating_count,
         referral_quality   = EXCLUDED.referral_quality,
         updated_at         = NOW()
       RETURNING *`,
      [
        publicKey,
        score,
        metrics.completedJobs,
        disputeRate,
        metrics.avgResponseHours == null ? null : Number(metrics.avgResponseHours.toFixed(2)),
        metrics.avgRating == null ? null : Number(metrics.avgRating.toFixed(2)),
        metrics.ratingCount,
        referralQuality,
      ],
    );
    return rowToReputation(rows[0]);
  } catch (err) {
    // FK violation — the address has no profile yet.
    if (err.code === "23503") return null;
    throw err;
  }
}

const pendingRecalcs = new Set();

/**
 * Fire-and-forget recalculation for one or more users. Duplicate requests for
 * the same user while a recalculation is queued are coalesced. Never throws.
 *
 * @param {...(string|null|undefined)} publicKeys
 */
function scheduleReputationRecalc(...publicKeys) {
  const keys = [...new Set(publicKeys.flat().filter((k) => k && /^G[A-Z0-9]{55}$/.test(k)))];
  for (const key of keys) {
    if (pendingRecalcs.has(key)) continue;
    pendingRecalcs.add(key);
    setImmediate(() => {
      recalculateReputation(key)
        .catch((err) => logError(logger, err, { operation: "reputation_recalc", publicKey: key }))
        .finally(() => pendingRecalcs.delete(key));
    });
  }
}

/**
 * Fire-and-forget recalculation for both parties of a job (and any extra
 * addresses, e.g. a referrer whose referral quality just changed). Never throws.
 *
 * @param {string} jobId
 * @param {...string} extraKeys
 */
function scheduleReputationRecalcForJob(jobId, ...extraKeys) {
  if (!jobId) {
    scheduleReputationRecalc(...extraKeys);
    return;
  }
  Promise.resolve()
    .then(() => pool.query("SELECT client_address, freelancer_address FROM jobs WHERE id = $1", [jobId]))
    .then((result) => {
      const job = result?.rows?.[0] || {};
      scheduleReputationRecalc(job.client_address, job.freelancer_address, ...extraKeys);
    })
    .catch((err) => logError(logger, err, { operation: "reputation_recalc_for_job", jobId }));
}

/**
 * Read a user's reputation. Computes it on first access and schedules a
 * background refresh when the stored value is older than 24h.
 *
 * @param {string} publicKey
 * @returns {Promise<Object|null>}
 */
async function getReputation(publicKey) {
  validatePublicKey(publicKey);

  const { rows } = await pool.query(
    "SELECT * FROM reputation_scores WHERE user_id = $1",
    [publicKey],
  );

  if (!rows.length) {
    return recalculateReputation(publicKey);
  }

  const reputation = rowToReputation(rows[0]);
  if (Date.now() - new Date(reputation.updatedAt).getTime() > STALE_AFTER_MS) {
    scheduleReputationRecalc(publicKey);
  }
  return reputation;
}

module.exports = {
  getReputation,
  recalculateReputation,
  scheduleReputationRecalc,
  scheduleReputationRecalcForJob,
  computeScore,
  scoreLabel,
  WEIGHTS,
};
