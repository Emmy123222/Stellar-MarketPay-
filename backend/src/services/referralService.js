/**
 * src/services/referralService.js
 *
 * Manages referral relationships and bonus payout recording.
 *
 * Flow:
 *   1. When a new user signs up via a referral link (?ref=GXXX), call
 *      registerReferral(referrerAddress, refereeAddress) to create the
 *      pending referral row.
 *   2. When the referee's first job is released, call
 *      processReferralPayout(jobId, refereeAddress, amountXlm, contractTxHash)
 *      which marks the referral as paid and writes an audit row.
 *   3. GET /api/referrals/:publicKey returns the referrer's history via
 *      getReferralStats(publicKey).
 *   4. GET /api/referrals/my-stats returns the authenticated referrer's
 *      pipeline (registered → first job completed → credit paid) with
 *      pending / paid credit totals and a paginated referee table via
 *      getMyReferralStats(publicKey, opts).
 */
"use strict";

const pool = require("../db/pool");

const REFERRAL_BONUS_BPS = 200; // 2% = 200 basis points

/**
 * Validate a Stellar G-address.
 * @param {string} key
 */
function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

/**
 * Register a referral relationship when a new user signs up via a referral link.
 * Idempotent — silently ignores duplicate (referrer, referee) pairs.
 *
 * @param {string} referrerAddress  The user who shared the link.
 * @param {string} refereeAddress   The new user who signed up.
 * @returns {Promise<Object|null>}  The referral row, or null if already existed.
 */
async function registerReferral(referrerAddress, refereeAddress) {
  validatePublicKey(referrerAddress);
  validatePublicKey(refereeAddress);

  if (referrerAddress === refereeAddress) {
    const e = new Error("Referrer and referee cannot be the same address");
    e.status = 400;
    throw e;
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO referrals (referrer_address, referee_address, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (referrer_address, referee_address) DO NOTHING
       RETURNING *`,
      [referrerAddress, refereeAddress],
    );

    if (rows.length === 0) return null; // already existed

    // Increment referral_count on the referrer's profile
    await pool.query(
      `UPDATE profiles
       SET referral_count = referral_count + 1, updated_at = NOW()
       WHERE public_key = $1`,
      [referrerAddress],
    );

    return rows[0];
  } catch (err) {
    // FK violation means one of the addresses has no profile yet — not an error
    if (err.code === "23503") return null;
    throw err;
  }
}

/**
 * Look up the referrer for a given referee address.
 *
 * @param {string} refereeAddress
 * @returns {Promise<string|null>}  Referrer public key, or null if none.
 */
async function getReferrerForReferee(refereeAddress) {
  const { rows } = await pool.query(
    `SELECT referrer_address FROM referrals
     WHERE referee_address = $1 AND status = 'pending'
     LIMIT 1`,
    [refereeAddress],
  );
  return rows.length ? rows[0].referrer_address : null;
}

/**
 * Process the referral bonus payout when a referee's first job is released.
 * Calculates 2% of the job's escrow amount and records the payout.
 * This is called from the escrow release route — the actual on-chain transfer
 * is handled by the Soroban contract's release_escrow() function.
 *
 * @param {string} jobId             UUID of the completed job.
 * @param {string} refereeAddress    The freelancer who just completed the job.
 * @param {string} amountXlm        The full escrow amount in XLM (string).
 * @param {string} [contractTxHash] On-chain tx hash from the release.
 * @returns {Promise<{referrer: string, bonusXlm: string}|null>}
 */
async function processReferralPayout(
  jobId,
  refereeAddress,
  amountXlm,
  contractTxHash,
) {
  validatePublicKey(refereeAddress);

  // Only pay out on the referee's FIRST completed job
  const { rows: prevJobs } = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM escrows e
     JOIN jobs j ON j.id = e.job_id
     WHERE j.freelancer_address = $1
       AND e.status = 'released'
       AND j.id != $2`,
    [refereeAddress, jobId],
  );
  const previousCompletedJobs = parseInt(prevJobs[0].cnt, 10);
  if (previousCompletedJobs > 0) {
    // Not the first job — no bonus
    return null;
  }

  // Find the pending referral
  const { rows: refRows } = await pool.query(
    `SELECT * FROM referrals
     WHERE referee_address = $1 AND status = 'pending'
     LIMIT 1`,
    [refereeAddress],
  );
  if (!refRows.length) return null;

  const referral = refRows[0];
  const escrowAmount = parseFloat(amountXlm);
  if (isNaN(escrowAmount) || escrowAmount <= 0) return null;

  // 2% bonus
  const bonusXlm = ((escrowAmount * REFERRAL_BONUS_BPS) / 10_000).toFixed(7);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Mark referral as paid
    await client.query(
      `UPDATE referrals
       SET status = 'paid', payout_amount = $1, job_id = $2, paid_at = NOW()
       WHERE id = $3`,
      [bonusXlm, jobId, referral.id],
    );

    // Write audit row
    await client.query(
      `INSERT INTO referral_payouts
         (referral_id, referrer_address, referee_address, job_id, amount_xlm, contract_tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        referral.id,
        referral.referrer_address,
        refereeAddress,
        jobId,
        bonusXlm,
        contractTxHash || null,
      ],
    );

    // Reputation bonus for referrer (+5 points, same as before)
    await client.query(
      `UPDATE profiles
       SET reputation_points = reputation_points + 5, updated_at = NOW()
       WHERE public_key = $1`,
      [referral.referrer_address],
    );

    await client.query("COMMIT");
    return { referrer: referral.referrer_address, bonusXlm };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get referral stats and history for a given public key (as referrer).
 *
 * @param {string} publicKey
 * @returns {Promise<Object>}
 */
async function getReferralStats(publicKey) {
  validatePublicKey(publicKey);

  // Summary counts
  const { rows: summary } = await pool.query(
    `SELECT
       COUNT(*)                                          AS total_referrals,
       COUNT(*) FILTER (WHERE status = 'paid')          AS paid_referrals,
       COUNT(*) FILTER (WHERE status = 'pending')       AS pending_referrals,
       COALESCE(SUM(payout_amount) FILTER (WHERE status = 'paid'), 0) AS total_earned_xlm
     FROM referrals
     WHERE referrer_address = $1`,
    [publicKey],
  );

  // Per-referee detail
  const { rows: referees } = await pool.query(
    `SELECT
       r.id,
       r.referee_address,
       r.status,
       r.payout_amount,
       r.paid_at,
       r.created_at,
       p.display_name AS referee_display_name,
       j.title        AS job_title
     FROM referrals r
     LEFT JOIN profiles p ON p.public_key = r.referee_address
     LEFT JOIN jobs j     ON j.id = r.job_id
     WHERE r.referrer_address = $1
     ORDER BY r.created_at DESC`,
    [publicKey],
  );

  // Payout history
  const { rows: payouts } = await pool.query(
    `SELECT
       rp.id,
       rp.referee_address,
       rp.job_id,
       rp.amount_xlm,
       rp.contract_tx_hash,
       rp.created_at,
       j.title AS job_title
     FROM referral_payouts rp
     JOIN jobs j ON j.id = rp.job_id
     WHERE rp.referrer_address = $1
     ORDER BY rp.created_at DESC`,
    [publicKey],
  );

  const s = summary[0];
  return {
    totalReferrals: parseInt(s.total_referrals, 10),
    paidReferrals: parseInt(s.paid_referrals, 10),
    pendingReferrals: parseInt(s.pending_referrals, 10),
    totalEarnedXlm: parseFloat(s.total_earned_xlm).toFixed(7),
    bonusBps: REFERRAL_BONUS_BPS,
    referees: referees.map((r) => ({
      id: r.id,
      refereeAddress: r.referee_address,
      refereeDisplayName: r.referee_display_name || null,
      status: r.status,
      payoutAmount: r.payout_amount
        ? parseFloat(r.payout_amount).toFixed(7)
        : null,
      paidAt: r.paid_at || null,
      jobTitle: r.job_title || null,
      createdAt: r.created_at,
    })),
    payouts: payouts.map((p) => ({
      id: p.id,
      refereeAddress: p.referee_address,
      jobId: p.job_id,
      jobTitle: p.job_title,
      amountXlm: parseFloat(p.amount_xlm).toFixed(7),
      contractTxHash: p.contract_tx_hash || null,
      createdAt: p.created_at,
    })),
  };
}

/** Pipeline stages surfaced on the referral dashboard (Issue #1559). */
const PIPELINE_STATUSES = ["registered", "first_job_completed", "credit_paid"];
const MY_STATS_MAX_LIMIT = 50;

/**
 * Shared CTE that classifies every referral of a referrer into a pipeline stage.
 *
 *   registered           — referee signed up but has no released escrow yet
 *   first_job_completed  — referee has a released escrow but the credit is not paid yet
 *   credit_paid          — referral bonus has been recorded as paid
 *
 * `estimated_credit_xlm` is the bonus the referrer can expect for referrals that
 * are not yet paid: 2% of the referee's first released escrow, or of their
 * earliest still-funded escrow when no job has been released yet.
 */
const PIPELINE_CTE = `
  WITH pipeline AS (
    SELECT
      r.id,
      r.referee_address,
      r.status,
      r.payout_amount,
      r.paid_at,
      r.created_at,
      p.display_name AS referee_display_name,
      pj.title       AS paid_job_title,
      fr.job_id      AS first_job_id,
      fr.title       AS first_job_title,
      fr.amount_xlm  AS first_released_xlm,
      fr.released_at AS first_job_completed_at,
      af.amount_xlm  AS active_escrow_xlm,
      CASE
        WHEN r.status = 'paid'   THEN 'credit_paid'
        WHEN fr.job_id IS NOT NULL THEN 'first_job_completed'
        ELSE 'registered'
      END AS pipeline_status
    FROM referrals r
    LEFT JOIN profiles p ON p.public_key = r.referee_address
    LEFT JOIN jobs pj    ON pj.id = r.job_id
    LEFT JOIN LATERAL (
      SELECT e.job_id, j.title, e.amount_xlm, COALESCE(e.released_at, e.updated_at) AS released_at
      FROM escrows e
      JOIN jobs j ON j.id = e.job_id
      WHERE j.freelancer_address = r.referee_address
        AND e.status = 'released'
      ORDER BY COALESCE(e.released_at, e.updated_at) ASC
      LIMIT 1
    ) fr ON TRUE
    LEFT JOIN LATERAL (
      SELECT e.amount_xlm
      FROM escrows e
      JOIN jobs j ON j.id = e.job_id
      WHERE j.freelancer_address = r.referee_address
        AND e.status = 'funded'
      ORDER BY e.created_at ASC
      LIMIT 1
    ) af ON TRUE
    WHERE r.referrer_address = $1
      AND r.status <> 'ineligible'
  )`;

/**
 * Referral dashboard stats for the authenticated referrer (Issue #1559).
 *
 * @param {string} publicKey
 * @param {Object} [opts]
 * @param {number} [opts.page=1]    1-based page number.
 * @param {number} [opts.limit=10]  Page size (max 50).
 * @param {string} [opts.status]    Optional pipeline status filter.
 * @returns {Promise<Object>}
 */
async function getMyReferralStats(publicKey, { page = 1, limit = 10, status } = {}) {
  validatePublicKey(publicKey);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(MY_STATS_MAX_LIMIT, Math.max(1, parseInt(limit, 10) || 10));

  if (status && !PIPELINE_STATUSES.includes(status)) {
    const e = new Error(`status must be one of: ${PIPELINE_STATUSES.join(", ")}`);
    e.status = 400;
    throw e;
  }

  const bonusFactor = REFERRAL_BONUS_BPS / 10_000;

  const { rows: summaryRows } = await pool.query(
    `${PIPELINE_CTE}
     SELECT
       COUNT(*)                                                         AS total_referred,
       COUNT(*) FILTER (WHERE pipeline_status = 'registered')           AS registered,
       COUNT(*) FILTER (WHERE pipeline_status = 'first_job_completed')  AS first_job_completed,
       COUNT(*) FILTER (WHERE pipeline_status = 'credit_paid')          AS credit_paid,
       COALESCE(SUM(payout_amount) FILTER (WHERE pipeline_status = 'credit_paid'), 0) AS paid_credits_xlm,
       COALESCE(SUM(COALESCE(first_released_xlm, active_escrow_xlm) * $2)
         FILTER (WHERE pipeline_status <> 'credit_paid'), 0)            AS pending_credits_xlm
     FROM pipeline`,
    [publicKey, bonusFactor],
  );

  const params = [publicKey];
  let where = "";
  if (status) {
    params.push(status);
    where = `WHERE pipeline_status = $${params.length}`;
  }
  params.push(pageSize, (pageNum - 1) * pageSize);

  const { rows } = await pool.query(
    `${PIPELINE_CTE}
     SELECT * FROM pipeline
     ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const s = summaryRows[0];
  const total = status
    ? parseInt(s[status], 10)
    : parseInt(s.total_referred, 10);
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  const toXlm = (v) => (v == null ? null : parseFloat(v).toFixed(7));

  return {
    referralLink: `${baseUrl}/?ref=${publicKey}`,
    bonusBps: REFERRAL_BONUS_BPS,
    totalReferred: parseInt(s.total_referred, 10),
    pendingCreditsXlm: toXlm(s.pending_credits_xlm),
    paidCreditsXlm: toXlm(s.paid_credits_xlm),
    pipeline: {
      registered: parseInt(s.registered, 10),
      firstJobCompleted: parseInt(s.first_job_completed, 10),
      creditPaid: parseInt(s.credit_paid, 10),
    },
    referees: rows.map((r) => {
      const baseAmount = r.first_released_xlm ?? r.active_escrow_xlm;
      return {
        id: r.id,
        refereeAddress: r.referee_address,
        refereeDisplayName: r.referee_display_name || null,
        status: r.pipeline_status,
        registeredAt: r.created_at,
        firstJobId: r.first_job_id || null,
        firstJobTitle: r.paid_job_title || r.first_job_title || null,
        firstJobCompletedAt: r.first_job_completed_at || null,
        creditXlm:
          r.pipeline_status === "credit_paid"
            ? toXlm(r.payout_amount)
            : baseAmount != null
              ? (parseFloat(baseAmount) * bonusFactor).toFixed(7)
              : null,
        paidAt: r.paid_at || null,
      };
    }),
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

module.exports = {
  registerReferral,
  getReferrerForReferee,
  processReferralPayout,
  getReferralStats,
  getMyReferralStats,
  PIPELINE_STATUSES,
  REFERRAL_BONUS_BPS,
};
