"use strict";

const pool = require("../db/pool");

const MAX_ACTIVE_CREDENTIALS = 10;
const MAX_REGISTRATION_ATTEMPTS_PER_HOUR = 3;
const REGISTRATION_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

const registrationAttempts = new Map();

function createError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function getRecentAttempts(publicKey, now = Date.now()) {
  const cutoff = now - REGISTRATION_ATTEMPT_WINDOW_MS;
  const attempts = (registrationAttempts.get(publicKey) || []).filter((timestamp) => timestamp > cutoff);

  if (attempts.length) {
    registrationAttempts.set(publicKey, attempts);
  } else {
    registrationAttempts.delete(publicKey);
  }

  return attempts;
}

function assertRegistrationAttemptAllowed(publicKey, now = Date.now()) {
  const attempts = getRecentAttempts(publicKey, now);

  if (attempts.length >= MAX_REGISTRATION_ATTEMPTS_PER_HOUR) {
    throw createError("Too many passkey registration attempts. Please try again later.", 429);
  }
}

function recordRegistrationAttempt(publicKey, now = Date.now()) {
  const attempts = getRecentAttempts(publicKey, now);
  attempts.push(now);
  registrationAttempts.set(publicKey, attempts);
}

async function assertCanRegisterCredential(publicKey) {
  assertRegistrationAttemptAllowed(publicKey);
  await assertActiveCredentialLimit(publicKey);
}

async function assertActiveCredentialLimit(publicKey) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM webauthn_credentials WHERE public_key = $1",
    [publicKey]
  );

  if (Number(rows[0]?.count || 0) >= MAX_ACTIVE_CREDENTIALS) {
    throw createError("Maximum active passkeys reached for this account.", 409);
  }
}

async function registerCredential({ publicKey, credentialId, credentialName, publicKeyCose, counter, transports }) {
  await assertActiveCredentialLimit(publicKey);

  const { rows } = await pool.query(
    `INSERT INTO webauthn_credentials
       (public_key, credential_id, credential_name, public_key_cose, counter, transports)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (credential_id) DO NOTHING
     RETURNING id, public_key, credential_id, credential_name, created_at`,
    [
      publicKey,
      credentialId,
      credentialName,
      publicKeyCose,
      counter,
      transports,
    ]
  );

  return rows[0] || null;
}

async function listCredentials(publicKey) {
  const { rows } = await pool.query(
    "SELECT id, credential_name, created_at FROM webauthn_credentials WHERE public_key = $1 ORDER BY created_at DESC",
    [publicKey]
  );

  return rows;
}

async function removeCredential({ id, publicKey }) {
  const { rowCount } = await pool.query(
    "DELETE FROM webauthn_credentials WHERE id = $1 AND public_key = $2",
    [id, publicKey]
  );

  if (!rowCount) {
    throw createError("Passkey not found", 404);
  }
}

async function adminListCredentials(publicKey) {
  const params = [];
  const where = publicKey ? "WHERE wc.public_key = $1" : "";
  if (publicKey) params.push(publicKey);

  const { rows } = await pool.query(
    `SELECT wc.id,
            wc.public_key,
            wc.credential_id,
            wc.credential_name,
            wc.created_at,
            p.display_name
       FROM webauthn_credentials wc
       LEFT JOIN profiles p ON p.public_key = wc.public_key
       ${where}
       ORDER BY wc.created_at DESC
       LIMIT 200`,
    params
  );

  return rows;
}

async function adminRevokeCredential(id) {
  const { rows } = await pool.query(
    `DELETE FROM webauthn_credentials
      WHERE id = $1
      RETURNING id, public_key, credential_name`,
    [id]
  );

  if (!rows.length) {
    throw createError("Passkey not found", 404);
  }

  return rows[0];
}

function _resetRegistrationAttemptsForTest() {
  registrationAttempts.clear();
}

module.exports = {
  MAX_ACTIVE_CREDENTIALS,
  MAX_REGISTRATION_ATTEMPTS_PER_HOUR,
  REGISTRATION_ATTEMPT_WINDOW_MS,
  assertCanRegisterCredential,
  assertRegistrationAttemptAllowed,
  recordRegistrationAttempt,
  registerCredential,
  listCredentials,
  removeCredential,
  adminListCredentials,
  adminRevokeCredential,
  _resetRegistrationAttemptsForTest,
};
