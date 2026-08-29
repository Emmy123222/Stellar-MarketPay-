/**
 * src/services/profileMigrationService.js
 * Stellar account merge (identity migration) — Issue #885.
 *
 * A user proves ownership of BOTH their old and new Stellar accounts by signing
 * a canonical challenge string with each secret key. On success, in one DB
 * transaction: profile data is copied to the new address, every job-history /
 * reputation / referral / messaging table is re-pointed from old -> new, and
 * the old profile row is marked `migrated_to = new` (kept, not deleted, so it
 * remains searchable and redirects).
 */
"use strict";

const { Keypair } = require("@stellar/stellar-sdk");
const pool = require("../db/pool");
const cache = require("./cacheService");

const CHALLENGE_PREFIX = "MARKETPAY-ACCOUNT-MERGE";
const CHALLENGE_TTL_MS = 10 * 60 * 1000; // signature must be issued within 10 min

/** Build the canonical string both parties must sign. */
function buildChallenge(oldPublicKey, newPublicKey, issuedAtIso) {
  return [
    CHALLENGE_PREFIX,
    oldPublicKey,
    newPublicKey,
    issuedAtIso,
  ].join("\n");
}

/** Verify an ed25519 signature (hex or base64) of `message` by `publicKey`. */
function verifySig(publicKey, message, signature) {
  try {
    const kp = Keypair.fromPublicKey(publicKey);
    const raw = /^[0-9a-fA-F]{128}$/.test(signature)
      ? Buffer.from(signature, "hex")
      : Buffer.from(signature, "base64");
    if (raw.length !== 64) return false;
    return kp.verify(Buffer.from(message, "utf8"), raw);
  } catch (_) {
    return false;
  }
}

function createError(message, status) {
  const e = new Error(message);
  e.status = status || 400;
  return e;
}

/**
 * Merge `oldPublicKey` into `newPublicKey` after verifying both signatures.
 *
 * @param {object} p
 * @param {string} p.oldPublicKey
 * @param {string} p.newPublicKey
 * @param {string} p.oldSignature  ed25519 sig of the challenge by the OLD key
 * @param {string} p.newSignature  ed25519 sig of the challenge by the NEW key
 * @param {string} p.issuedAt      ISO timestamp embedded in the challenge
 * @param {string} [p.network]     testnet | mainnet (documentation only)
 * @returns {Promise<object>} summary of transferred rows
 */
async function migrateProfile({ oldPublicKey, newPublicKey, oldSignature, newSignature, issuedAt, network: _network = "testnet" }) {
  // ── 1. Challenge + dual-signature verification ──────────────────────────
  // The challenge embeds both addresses AND issuedAt, so each signature is
  // only valid for this exact (old, new, time) triple; issuedAt freshness
  // guards against replay. The client signs challenge(old, new, issuedAt)
  // with each key and passes issuedAt alongside the two signatures.
  if (!issuedAt) {
    throw createError("issuedAt (ISO timestamp used in the challenge) is required", 400);
  }
  const issued = new Date(issuedAt);
  if (Number.isNaN(issued.getTime())) {
    throw createError("issuedAt is not a valid ISO timestamp", 400);
  }
  if (Math.abs(Date.now() - issued.getTime()) > CHALLENGE_TTL_MS) {
    throw createError("Challenge expired — sign a fresh challenge (10-minute window)", 400);
  }

  const challenge = buildChallenge(oldPublicKey, newPublicKey, issuedAt);
  if (!verifySig(oldPublicKey, challenge, oldSignature)) {
    throw createError("oldSignature does not prove ownership of oldPublicKey", 401);
  }
  if (!verifySig(newPublicKey, challenge, newSignature)) {
    throw createError("newSignature does not prove ownership of newPublicKey", 401);
  }

  // ── 2. Precondition checks ───────────────────────────────────────────────
  const { rows: oldRows } = await pool.query(
    `SELECT public_key, migrated_to FROM profiles WHERE public_key = $1`, [oldPublicKey]);
  if (!oldRows.length) throw createError("Old profile not found", 404);
  if (oldRows[0].migrated_to) throw createError("Old address is already migrated", 409);

  const { rows: newRows } = await pool.query(
    `SELECT public_key, migrated_to FROM profiles WHERE public_key = $1`, [newPublicKey]);
  if (newRows.length && newRows[0].migrated_to) {
    throw createError("New address is itself migrated; migrate to the final address instead", 409);
  }

  // ── 3. Transactional transfer ────────────────────────────────────────────
  const client = await pool.connect();
  const summary = {};
  try {
    await client.query("BEGIN");

    // 3a. Create the new profile row if absent, copying identity/reputation
    //     fields from the old one (INSERT ... SELECT keeps it atomic).
    const { rows: created } = await client.query(
      `INSERT INTO profiles (public_key, display_name, bio, skills, portfolio_items,
                             availability, role, completed_jobs, total_earned_xlm,
                             rating, reputation_points, referral_count,
                             email_notifications_enabled, is_kyc_verified, did_hash)
       SELECT $2, display_name, bio, skills, portfolio_items,
              availability, role, completed_jobs, total_earned_xlm,
              rating, reputation_points, referral_count,
              email_notifications_enabled, is_kyc_verified, did_hash
       FROM profiles WHERE public_key = $1
       ON CONFLICT (public_key) DO NOTHING
       RETURNING public_key`,
      [oldPublicKey, newPublicKey]);
    summary.profile_created = created.length > 0;

    // 3b. If the new profile already existed, carry over any reputation the
    //     old one had that the new one lacks (max-merge, never destroy).
    await client.query(
      `UPDATE profiles new
         SET completed_jobs   = GREATEST(new.completed_jobs, old.completed_jobs),
             total_earned_xlm = GREATEST(new.total_earned_xlm, old.total_earned_xlm),
             rating           = COALESCE(new.rating, old.rating),
             reputation_points = GREATEST(new.reputation_points, old.reputation_points),
             referral_count   = GREATEST(new.referral_count, old.referral_count),
             is_kyc_verified  = new.is_kyc_verified OR old.is_kyc_verified,
             skills           = CASE WHEN cardinality(new.skills) = 0 THEN old.skills ELSE new.skills END,
             did_hash         = COALESCE(new.did_hash, old.did_hash)
       FROM profiles old
       WHERE new.public_key = $2 AND old.public_key = $1`,
      [oldPublicKey, newPublicKey]);

    // 3c. Re-point every history table old -> new. Each statement updates
    //     summary counts. Tables with a UNIQUE constraint spanning the address
    //     (ratings: job_id+rater, referrals: referrer+referee) use ON CONFLICT
    //     DO NOTHING so a self-pair collapse can't violate the constraint.
    const repoint = [
      ["jobs.client_address", "UPDATE jobs SET client_address = $2 WHERE client_address = $1", "jobs_client"],
      ["jobs.freelancer_address", "UPDATE jobs SET freelancer_address = $2 WHERE freelancer_address = $1", "jobs_freelancer"],
      ["applications.freelancer_address", "UPDATE applications SET freelancer_address = $2 WHERE freelancer_address = $1", "applications"],
      ["ratings.rater_address", "UPDATE ratings SET rater_address = $2 WHERE rater_address = $1 ON CONFLICT DO NOTHING", "ratings_rater"],
      ["ratings.rated_address", "UPDATE ratings SET rated_address = $2 WHERE rated_address = $1 ON CONFLICT DO NOTHING", "ratings_rated"],
      ["referrals.referrer_address", "UPDATE referrals SET referrer_address = $2 WHERE referrer_address = $1 ON CONFLICT DO NOTHING", "referrals_referrer"],
      ["referrals.referee_address", "UPDATE referrals SET referee_address = $2 WHERE referee_address = $1 ON CONFLICT DO NOTHING", "referrals_referee"],
      ["referral_payouts.referrer_address", "UPDATE referral_payouts SET referrer_address = $2 WHERE referrer_address = $1", "referral_payouts_referrer"],
      ["referral_payouts.referee_address", "UPDATE referral_payouts SET referee_address = $2 WHERE referee_address = $1", "referral_payouts_referee"],
      ["messages.sender_address", "UPDATE messages SET sender_address = $2 WHERE sender_address = $1", "messages_sender"],
      ["messages.receiver_address", "UPDATE messages SET receiver_address = $2 WHERE receiver_address = $1", "messages_receiver"],
      ["progress_updates.author_address", "UPDATE progress_updates SET author_address = $2 WHERE author_address = $1", "progress_updates"],
      ["dispute_evidence.uploader_address", "UPDATE dispute_evidence SET uploader_address = $2 WHERE uploader_address = $1", "dispute_evidence"],
      ["archived_jobs.client_address", "UPDATE archived_jobs SET client_address = $2 WHERE client_address = $1", "archived_jobs_client"],
      ["archived_jobs.freelancer_address", "UPDATE archived_jobs SET freelancer_address = $2 WHERE freelancer_address = $1", "archived_jobs_freelancer"],
      ["archived_applications.freelancer_address", "UPDATE archived_applications SET freelancer_address = $2 WHERE freelancer_address = $1", "archived_applications"],
      ["archived_ratings.rater_address", "UPDATE archived_ratings SET rater_address = $2 WHERE rater_address = $1", "archived_ratings_rater"],
      ["archived_ratings.rated_address", "UPDATE archived_ratings SET rated_address = $2 WHERE rated_address = $1", "archived_ratings_rated"],
      ["skill_certificates.public_key", "UPDATE skill_certificates SET public_key = $2 WHERE public_key = $1 ON CONFLICT DO NOTHING", "skill_certificates"],
      ["push_subscriptions.user_address", "UPDATE push_subscriptions SET user_address = $2 WHERE user_address = $1 ON CONFLICT DO NOTHING", "push_subscriptions"],
      ["api_keys.owner_public_key", "UPDATE api_keys SET owner_public_key = $2 WHERE owner_public_key = $1", "api_keys"],
    ];
    for (const [label, sql, summaryKey] of repoint) {
      try {
        const r = await client.query(sql, [oldPublicKey, newPublicKey]);
        summary[summaryKey || label] = r.rowCount || 0;
      } catch (e) {
        // A table may not exist in a given deployment; record and continue.
        summary[summaryKey || label] = `skipped: ${e.message.split("\n")[0].slice(0, 80)}`;
      }
    }

    // 3d. Mark the old address as migrated (the redirect marker).
    await client.query(
      `UPDATE profiles SET migrated_to = $2, migrated_at = NOW(), updated_at = NOW()
       WHERE public_key = $1`,
      [oldPublicKey, newPublicKey]);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // 4. Invalidate caches for both addresses.
  await cache.del(cache.profileKey(oldPublicKey));
  await cache.del(cache.profileKey(newPublicKey));

  summary.oldPublicKey = oldPublicKey;
  summary.newPublicKey = newPublicKey;
  summary.migratedTo = newPublicKey;
  return summary;
}

/**
 * Follow one redirect hop for a migrated address (used by getProfile).
 * @param {string} publicKey
 * @returns {Promise<string|null>} the new address, or null
 */
async function getRedirectTarget(publicKey) {
  const { rows } = await pool.query(
    `SELECT migrated_to FROM profiles WHERE public_key = $1 AND migrated_to IS NOT NULL`,
    [publicKey]);
  return rows.length ? rows[0].migrated_to : null;
}

module.exports = { buildChallenge, verifySig, migrateProfile, getRedirectTarget, CHALLENGE_TTL_MS };
