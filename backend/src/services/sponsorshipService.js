/**
 * src/services/sponsorshipService.js
 * Gas fee sponsorship system for verified freelancers (Issue #1554)
 */
"use strict";

const { Keypair, TransactionBuilder, Networks, FeeBumpTransaction } = require("@stellar/stellar-sdk");
const pool = require("../db/pool");
const { createError, ErrorCodes } = require("../utils/errors");

const networkPassphrase =
  process.env.STELLAR_NETWORK_PASSPHRASE ||
  (process.env.STELLAR_NETWORK === "public" ? Networks.PUBLIC : Networks.TESTNET);

// Sponsoring keypair
let sponsoringKeypair;
function getSponsoringKeypair() {
  if (!sponsoringKeypair) {
    const secret = process.env.SPONSORING_ACCOUNT_SECRET || process.env.PLATFORM_SECRET_KEY;
    if (secret) {
      try {
        sponsoringKeypair = Keypair.fromSecret(secret);
      } catch (err) {
        console.warn("[sponsorship] Invalid secret in env, using generated keypair:", err.message);
        sponsoringKeypair = Keypair.random();
      }
    } else {
      // Default to deterministic or random keypair for testing/development
      sponsoringKeypair = Keypair.random();
    }
  }
  return sponsoringKeypair;
}

function setSponsoringKeypair(keypair) {
  sponsoringKeypair = keypair;
}

function getSponsoringPublicKey() {
  return getSponsoringKeypair().publicKey();
}

/**
 * Get or initialize sponsorship credits for a freelancer.
 */
async function getSponsorshipCredits(freelancerId) {
  const { rows } = await pool.query(
    "SELECT freelancer_id, credits_remaining, total_sponsored FROM sponsorship_credits WHERE freelancer_id = $1",
    [freelancerId]
  );

  if (rows.length > 0) {
    return {
      freelancerId: rows[0].freelancer_id,
      creditsRemaining: rows[0].credits_remaining,
      totalSponsored: rows[0].total_sponsored,
    };
  }

  // Initialize with 5 credits
  const insertResult = await pool.query(
    `INSERT INTO sponsorship_credits (freelancer_id, credits_remaining, total_sponsored, created_at, updated_at)
     VALUES ($1, 5, 0, NOW(), NOW())
     ON CONFLICT (freelancer_id) DO UPDATE SET updated_at = NOW()
     RETURNING freelancer_id, credits_remaining, total_sponsored`,
    [freelancerId]
  );

  const row = insertResult.rows[0];
  return {
    freelancerId: row.freelancer_id,
    creditsRemaining: row.credits_remaining,
    totalSponsored: row.total_sponsored,
  };
}

/**
 * Check freelancer eligibility for gas fee sponsorship.
 * Criteria:
 * 1. Verified email
 * 2. Completed profile (display_name, bio, skills.length > 0)
 * 3. 0 completed jobs
 */
async function checkEligibility(freelancerId) {
  const { rows } = await pool.query(
    `SELECT public_key, display_name, bio, skills, completed_jobs, email, email_verified
     FROM profiles WHERE public_key = $1`,
    [freelancerId]
  );

  if (rows.length === 0) {
    return {
      eligible: false,
      reason: "Profile not found. Please create a profile first.",
    };
  }

  const profile = rows[0];

  // 1. Email verification check
  const isEmailVerified = Boolean(
    profile.email_verified === true ||
    (profile.email && profile.email_verified !== false)
  );

  if (!isEmailVerified) {
    return {
      eligible: false,
      reason: "Email must be verified to be eligible for gas sponsorship.",
      missing: "verified_email",
    };
  }

  // 2. Completed profile check
  const hasDisplayName = Boolean(profile.display_name && profile.display_name.trim().length > 0);
  const hasBio = Boolean(profile.bio && profile.bio.trim().length > 0);
  const hasSkills = Array.isArray(profile.skills) && profile.skills.length > 0;

  if (!hasDisplayName || !hasBio || !hasSkills) {
    return {
      eligible: false,
      reason: "Profile must be fully completed (name, bio, and skills) to be eligible.",
      missing: "completed_profile",
    };
  }

  // 3. 0 completed jobs check
  const completedJobsCount = Number(profile.completed_jobs) || 0;
  if (completedJobsCount > 0) {
    return {
      eligible: false,
      reason: "Fee sponsorship is only available to freelancers with 0 completed jobs.",
      missing: "zero_completed_jobs",
    };
  }

  // Check additional jobs check from jobs table if any
  const { rows: jobsRows } = await pool.query(
    "SELECT COUNT(*) AS count FROM jobs WHERE freelancer_address = $1 AND status = 'completed'",
    [freelancerId]
  );
  if (parseInt(jobsRows[0]?.count || "0", 10) > 0) {
    return {
      eligible: false,
      reason: "Fee sponsorship is only available to freelancers with 0 completed jobs.",
      missing: "zero_completed_jobs",
    };
  }

  // Check remaining credits
  const credits = await getSponsorshipCredits(freelancerId);
  if (credits.creditsRemaining <= 0) {
    return {
      eligible: false,
      reason: "No sponsorship credits remaining (limit of 5 sponsored transactions reached).",
      missing: "credits_remaining",
      creditsRemaining: 0,
    };
  }

  return {
    eligible: true,
    creditsRemaining: credits.creditsRemaining,
    totalSponsored: credits.totalSponsored,
  };
}

/**
 * Sponsor a transaction envelope for an eligible freelancer.
 */
async function sponsorTransaction(freelancerId, xdr) {
  if (!xdr) {
    throw createError(ErrorCodes.VALIDATION_ERROR, "Transaction XDR is required", 400);
  }

  const eligibility = await checkEligibility(freelancerId);
  if (!eligibility.eligible) {
    throw createError(
      ErrorCodes.FORBIDDEN || "FORBIDDEN",
      `Sponsorship request rejected: ${eligibility.reason}`,
      403
    );
  }

  const keypair = getSponsoringKeypair();
  let sponsoredXdr;

  try {
    const parsedTx = TransactionBuilder.fromXDR(xdr, networkPassphrase);

    if (parsedTx instanceof FeeBumpTransaction) {
      parsedTx.sign(keypair);
      sponsoredXdr = parsedTx.toXDR();
    } else {
      // Build a FeeBumpTransaction where the platform sponsoring account pays the fee
      const feeBump = TransactionBuilder.buildFeeBumpTransaction(
        keypair,
        "1000000", // 0.1 XLM max fee
        parsedTx,
        networkPassphrase
      );
      feeBump.sign(keypair);
      sponsoredXdr = feeBump.toXDR();
    }
  } catch (err) {
    // If fee bump wrapping fails (e.g. invalid transaction format), try standard envelope signing
    try {
      const parsedTx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      parsedTx.sign(keypair);
      sponsoredXdr = parsedTx.toXDR();
    } catch (innerErr) {
      throw createError(
        ErrorCodes.VALIDATION_ERROR,
        `Invalid transaction envelope XDR: ${innerErr.message || err.message}`,
        400
      );
    }
  }

  // Deduct 1 credit and increment total_sponsored
  const updateResult = await pool.query(
    `UPDATE sponsorship_credits
     SET credits_remaining = credits_remaining - 1,
         total_sponsored = total_sponsored + 1,
         updated_at = NOW()
     WHERE freelancer_id = $1 AND credits_remaining > 0
     RETURNING credits_remaining, total_sponsored`,
    [freelancerId]
  );

  if (updateResult.rows.length === 0) {
    throw createError(ErrorCodes.FORBIDDEN, "No credits remaining to sponsor transaction", 403);
  }

  const row = updateResult.rows[0];

  return {
    success: true,
    sponsoredEnvelope: sponsoredXdr,
    envelopeXdr: sponsoredXdr,
    creditsRemaining: row.credits_remaining,
    totalSponsored: row.total_sponsored,
    sponsorAccount: keypair.publicKey(),
  };
}

module.exports = {
  getSponsoringKeypair,
  setSponsoringKeypair,
  getSponsoringPublicKey,
  getSponsorshipCredits,
  checkEligibility,
  sponsorTransaction,
};
