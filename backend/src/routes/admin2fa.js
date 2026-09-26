/**
 * Admin TOTP 2FA
 * POST /api/admin/2fa/setup   — generate secret + QR code
 * POST /api/admin/2fa/verify  — verify code, enable 2FA, issue upgraded JWT
 * POST /api/admin/2fa/disable — disable 2FA (requires valid TOTP or backup code)
 * GET  /api/admin/2fa/status  — check enabled state
 *
 * 2FA Implementation Notes:
 * - TOTP Validation Window: Configured with `window: 1` (allowing ±1 time step of 30 seconds drift).
 *   This accepts codes generated within [-30s, +30s] of the server time, strictly rejecting
 *   codes from 61+ seconds ago to protect privileged admin operations against replay attacks.
 *   A wider window (such as window: 2 / ±90s) is considered too permissive for admin actions.
 * - Secret Storage: Stored base32 TOTP secret is AES-256-GCM encrypted in `admin_profiles.totp_secret`.
 * - Brute-Force Rate Limiting: 5 consecutive failed verification attempts lock the admin account for 15 minutes.
 * - Backup Codes: 10 single-use cryptographically hashed backup codes generated at setup.
 *
 * @swagger
 * tags:
 *   name: Admin 2FA
 *   description: Admin two-factor authentication
 */
"use strict";

const express = require("express");
const QRCode = require("qrcode");
const speakeasy = require("speakeasy");
const pool = require("../db/pool");
const { verifyJWT, requireAdminRole } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { signAccessToken } = require("../services/authTokens");
const { encrypt } = require("../utils/encryption");
const {
  generateSecret,
  generateBackupCodes,
  enable2FA,
  verify2FA,
  verifyBackupCode,
  disable2FA,
  get2FAStatus,
  ensureAdminProfile,
  getDecryptedSecret,
  TOTP_WINDOW: SERVICE_TOTP_WINDOW,
} = require("../services/twoFactorService");

const router = express.Router();

// TOTP setup/verify/disable are authentication operations: an unbounded
// request rate lets an attacker brute-force the 6-digit code or flood the
// profile table, so cap them per IP. Reads get a looser ceiling.
const twoFactorAuthRateLimiter = createRateLimiter(10, 1); // 10 req/min per IP
const twoFactorStatusRateLimiter = createRateLimiter(30, 1); // 30 req/min per IP
/**
 * Validation window for TOTP verification (Issue #1459).
 * window: 1 corresponds to ±1 time step (±30 seconds) tolerance.
 */
const TOTP_WINDOW = SERVICE_TOTP_WINDOW || 1;

function issueAdminToken(publicKey, twoFaVerified) {
  return signAccessToken({
    publicKey,
    role: "admin",
    "2fa_verified": twoFaVerified,
  });
}

/**
 * @swagger
 * /api/admin/2fa/setup:
 *   post:
 *     summary: Generate TOTP secret and QR code for admin
 *     tags: [Admin 2FA]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR code and manual entry key
 *       400:
 *         description: 2FA already enabled
 */
router.post("/setup", twoFactorAuthRateLimiter, verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const { publicKey } = req.user;
    await ensureAdminProfile(publicKey);

    const { rows } = await pool.query(
      "SELECT totp_enabled FROM admin_profiles WHERE id = $1",
      [publicKey],
    );
    if (rows[0]?.totp_enabled) {
      return res.status(400).json({ error: "2FA is already enabled" });
    }

    const secret = generateSecret(publicKey);
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    await pool.query(
      "UPDATE admin_profiles SET totp_secret = $1, totp_enabled = false, updated_at = NOW() WHERE id = $2",
      [encrypt(secret.base32), publicKey],
    );

    res.json({
      success: true,
      data: { qrCode, manualEntryKey: secret.base32 },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/admin/2fa/verify:
 *   post:
 *     summary: Verify TOTP, enable 2FA, upgrade JWT
 *     tags: [Admin 2FA]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *               setup:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: 2FA enabled/verified with upgraded token
 *       400:
 *         description: Invalid code
 */
router.post("/verify", twoFactorAuthRateLimiter, verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const { publicKey } = req.user;
    const { token, setup } = req.body;

    if (!token || String(token).length !== 6) {
      return res.status(400).json({ error: "A 6-digit TOTP code is required" });
    }

    const status = await get2FAStatus(publicKey);
    const secret = await getDecryptedSecret(publicKey);

    if (!secret) {
      return res
        .status(400)
        .json({ error: "2FA setup not initiated. Call /setup first." });
    }

    let plainBackupCodes;

    if (setup || !status.totp_enabled) {
      // First-time enable: verify the code against the pending secret
      const verified = speakeasy.totp.verify({
        secret,
        encoding: "base32",
        token: String(token),
        window: TOTP_WINDOW,
      });

      if (!verified) {
        return res.status(400).json({ error: "Invalid verification code" });
      }

      const { plain, hashed } = generateBackupCodes();
      plainBackupCodes = plain;
      await enable2FA(publicKey, secret, hashed);
    } else {
      // Already enabled: just verify (e.g. login step-up)
      const result = await verify2FA(publicKey, String(token));
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
    }

    const upgradedToken = issueAdminToken(publicKey, true);

    res.json({
      success: true,
      token: upgradedToken,
      data: {
        backupCodes: plainBackupCodes || undefined,
        message: plainBackupCodes
          ? "2FA enabled. Save your backup codes — they will not be shown again."
          : "2FA verified",
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/2fa/disable
router.post("/disable", twoFactorAuthRateLimiter, verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const { publicKey } = req.user;
    const { token, backupCode } = req.body;

    if (!token && !backupCode) {
      return res
        .status(400)
        .json({ error: "A TOTP token or backup code is required" });
    }

    let ok = false;
    if (token) {
      const result = await verify2FA(publicKey, String(token));
      ok = result.success;
      if (!ok) return res.status(400).json({ error: result.error });
    } else {
      const result = await verifyBackupCode(publicKey, backupCode);
      ok = result.success;
      if (!ok) return res.status(400).json({ error: result.error });
    }

    await disable2FA(publicKey);
    res.json({ success: true, message: "2FA disabled" });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/admin/2fa/status:
 *   get:
 *     summary: Get admin 2FA status
 *     tags: [Admin 2FA]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 2FA status including verification state
 */
router.get("/status", twoFactorStatusRateLimiter, verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const status = await get2FAStatus(req.user.publicKey);
    res.json({
      success: true,
      data: { ...status, verified: Boolean(req.user["2fa_verified"]) },
    });
  } catch (e) {
    next(e);
  }
});

router.TOTP_WINDOW = TOTP_WINDOW;

module.exports = router;
module.exports.TOTP_WINDOW = TOTP_WINDOW;
