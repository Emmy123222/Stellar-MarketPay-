"use strict";

const crypto = require("crypto");
const pool = require("../db/pool");

function normalizeLabel(label) {
  if (typeof label !== "string") return "Developer key";
  const trimmed = label.trim();
  return trimmed || "Developer key";
}

function generateApiKeyValue() {
  return `sk_live_${crypto.randomBytes(32).toString("base64url")}`;
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

async function createApiKey({ ownerPublicKey, label }) {
  const apiKey = generateApiKeyValue();
  const keyHash = hashApiKey(apiKey);
  const keyPrefix = apiKey.slice(0, 12);
  const normalizedLabel = normalizeLabel(label);

  const { rows } = await pool.query(
    `INSERT INTO api_keys (owner_public_key, label, key_prefix, key_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, owner_public_key, label, key_prefix, created_at`,
    [ownerPublicKey, normalizedLabel, keyPrefix, keyHash]
  );

  return {
    apiKey,
    key: rows[0],
  };
}

async function listApiKeys(ownerPublicKey) {
  const { rows } = await pool.query(
    `SELECT
       k.id,
       k.label,
       k.key_prefix,
       k.created_at,
       k.last_used_at,
       k.revoked_at,
       COALESCE(u.request_count, 0) AS requests_today
     FROM api_keys k
     LEFT JOIN api_key_usage_daily u
       ON u.api_key_id = k.id
      AND u.usage_date = CURRENT_DATE
     WHERE k.owner_public_key = $1
     ORDER BY k.created_at DESC`,
    [ownerPublicKey]
  );

  return rows;
}

async function revokeApiKey(ownerPublicKey, keyId) {
  const { rowCount } = await pool.query(
    `UPDATE api_keys
        SET revoked_at = NOW()
      WHERE id = $1
        AND owner_public_key = $2
        AND revoked_at IS NULL`,
    [keyId, ownerPublicKey]
  );

  return rowCount > 0;
}

async function findApiKeyByRawValue(apiKey) {
  const keyHash = hashApiKey(apiKey);
  const { rows } = await pool.query(
    `SELECT id, owner_public_key, label, key_prefix, revoked_at, created_at, last_used_at
       FROM api_keys
      WHERE key_hash = $1
      LIMIT 1`,
    [keyHash]
  );

  return rows[0] || null;
}

async function recordApiKeyUsage(apiKeyId) {
  await pool.query(
    `INSERT INTO api_key_usage_daily (api_key_id, usage_date, request_count, updated_at)
     VALUES ($1, CURRENT_DATE, 1, NOW())
     ON CONFLICT (api_key_id, usage_date)
     DO UPDATE SET request_count = api_key_usage_daily.request_count + 1,
                   updated_at = NOW()`,
    [apiKeyId]
  );

  await pool.query(
    `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
    [apiKeyId]
  );
}

async function listPublicJobs(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
  const { rows } = await pool.query(
    `SELECT
       id,
       title,
       description,
       budget,
       currency,
       category,
       skills,
       status,
       client_address,
       freelancer_address,
       deadline,
       timezone,
       created_at,
       updated_at
     FROM jobs
     WHERE status = 'open'
       AND visibility = 'public'
     ORDER BY created_at DESC
     LIMIT $1`,
    [safeLimit]
  );

  return rows;
}

async function getPublicJob(jobId) {
  const { rows } = await pool.query(
    `SELECT
       id,
       title,
       description,
       budget,
       currency,
       category,
       skills,
       status,
       client_address,
       freelancer_address,
       deadline,
       timezone,
       created_at,
       updated_at
     FROM jobs
     WHERE id = $1
       AND visibility = 'public'
       AND status = 'open'
     LIMIT 1`,
    [jobId]
  );

  return rows[0] || null;
}

async function getPublicFreelancerProfile(publicKey) {
  const { rows } = await pool.query(
    `SELECT
       public_key,
       display_name,
       bio,
       skills,
       portfolio_items,
       availability,
       completed_jobs,
       total_earned_xlm,
       rating,
       reputation_points,
       created_at,
       updated_at
     FROM profiles
     WHERE public_key = $1
     LIMIT 1`,
    [publicKey]
  );

  return rows[0] || null;
}

module.exports = {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  findApiKeyByRawValue,
  recordApiKeyUsage,
  listPublicJobs,
  getPublicJob,
  getPublicFreelancerProfile,
  hashApiKey,
};
