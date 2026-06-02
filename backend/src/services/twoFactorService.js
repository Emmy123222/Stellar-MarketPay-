/**
 * TOTP 2FA for admin accounts (speakeasy + encrypted storage)
 */
"use strict";

const speakeasy = require("speakeasy");
const pool = require("../db/pool");
const { encrypt, decrypt } = require("../utils/encryption");

function generateSecret(adminId) {
  const secret = speakeasy.generateSecret({
    name: `StellarMarketPay:${adminId}`,
    length: 20,
  });
  return {
    base32: secret.base32,
    otpauth_url: secret.otpauth_url,
  };
}

async function ensureAdminProfile(adminId) {
  await pool.query(
    `INSERT INTO admin_profiles (id, email, totp_enabled, created_at, updated_at)
     VALUES ($1, $2, false, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [adminId, `${adminId.slice(0, 8)}@admin.local`]
  );
}

async function getDecryptedSecret(adminId) {
  const { rows } = await pool.query(
    "SELECT totp_secret FROM admin_profiles WHERE id = $1",
    [adminId]
  );
  if (!rows[0]?.totp_secret) return null;
  return decrypt(rows[0].totp_secret);
}

async function enable2FA(adminId, plainSecret, backupCodes) {
  const encryptedSecret = encrypt(plainSecret);
  const encryptedBackupCodes = encrypt(JSON.stringify(backupCodes));
  await pool.query(
    `UPDATE admin_profiles
     SET totp_secret = $1, totp_enabled = true, backup_codes = $2,
         totp_attempts = 0, totp_locked_until = NULL, updated_at = NOW()
     WHERE id = $3`,
    [encryptedSecret, encryptedBackupCodes, adminId]
  );
}

async function verify2FA(adminId, token) {
  const { rows } = await pool.query(
    `SELECT totp_secret, totp_enabled, totp_attempts, totp_locked_until
     FROM admin_profiles WHERE id = $1`,
    [adminId]
  );
  const admin = rows[0];
  if (!admin || !admin.totp_enabled) return { success: false, error: "2FA not enabled" };

  if (admin.totp_locked_until && new Date(admin.totp_locked_until) > new Date()) {
    return { success: false, error: "Account locked due to too many failed attempts. Try again later." };
  }

  const secret = decrypt(admin.totp_secret);
  const verified = speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
  });

  if (verified) {
    await pool.query("UPDATE admin_profiles SET totp_attempts = 0 WHERE id = $1", [adminId]);
    return { success: true };
  }

  const newAttempts = (admin.totp_attempts || 0) + 1;
  if (newAttempts >= 5) {
    const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      "UPDATE admin_profiles SET totp_attempts = $1, totp_locked_until = $2 WHERE id = $3",
      [newAttempts, lockUntil, adminId]
    );
    return { success: false, error: "Too many failed attempts. Account locked for 15 minutes." };
  }

  await pool.query("UPDATE admin_profiles SET totp_attempts = $1 WHERE id = $2", [newAttempts, adminId]);
  return { success: false, error: "Invalid 2FA code" };
}

async function verifyBackupCode(adminId, code) {
  const { rows } = await pool.query(
    "SELECT backup_codes FROM admin_profiles WHERE id = $1",
    [adminId]
  );
  const admin = rows[0];
  if (!admin?.backup_codes) return { success: false, error: "No backup codes found" };

  const codes = JSON.parse(decrypt(admin.backup_codes));
  const index = codes.indexOf(code);
  if (index === -1) return { success: false, error: "Invalid backup code" };

  codes.splice(index, 1);
  await pool.query(
    "UPDATE admin_profiles SET backup_codes = $1 WHERE id = $2",
    [encrypt(JSON.stringify(codes)), adminId]
  );
  return { success: true };
}

async function disable2FA(adminId) {
  await pool.query(
    `UPDATE admin_profiles
     SET totp_secret = NULL, totp_enabled = false, backup_codes = NULL,
         totp_attempts = 0, totp_locked_until = NULL, updated_at = NOW()
     WHERE id = $1`,
    [adminId]
  );
}

async function get2FAStatus(adminId) {
  const { rows } = await pool.query(
    "SELECT totp_enabled FROM admin_profiles WHERE id = $1",
    [adminId]
  );
  return rows[0] || { totp_enabled: false };
}

module.exports = {
  generateSecret,
  ensureAdminProfile,
  getDecryptedSecret,
  enable2FA,
  verify2FA,
  verifyBackupCode,
  disable2FA,
  get2FAStatus,
};
