/**
 * src/routes/twoFactor.js
 * TOTP 2FA routes for admin accounts
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { generateSecret, enable2FA, verify2FA, verifyBackupCode, disable2FA, get2FAStatus } = require("../services/twoFactorService");
const QRCode = require("qrcode");
const speakeasy = require("speakeasy");

const { pool } = require("../db/pool");

// GET /api/2fa/status — check if 2FA is enabled
router.get("/status", verifyJWT, async (req, res, next) => {
  try {
    const status = await get2FAStatus(req.user.publicKey);
    res.json({ success: true, data: status });
  } catch (e) { next(e); }
});

// POST /api/2fa/setup — generate secret and QR code
router.post("/setup", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey } = req.user;

    // Check if admin
    const { rows } = await pool.query("SELECT id, email FROM admin_profiles WHERE id = $1", [publicKey]);
    if (!rows[0]) return res.status(403).json({ success: false, error: "Admin access required" });

    const secret = generateSecret(rows[0].email || publicKey);
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauthURL());

    // Store secret temporarily (not enabled until verified)
    await pool.query(
      "UPDATE admin_profiles SET totp_secret = $1, totp_enabled = false WHERE id = $2",
      [secret.base32, publicKey]
    );

    res.json({
      success: true,
      data: {
        secret: secret.base32,
        qrCode: qrCodeUrl,
      }
    });
  } catch (e) { next(e); }
});

// POST /api/2fa/verify — verify TOTP code and enable 2FA
router.post("/verify", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey } = req.user;
    const { token } = req.body;

    if (!token) return res.status(400).json({ success: false, error: "Token is required" });

    const { rows } = await pool.query("SELECT totp_secret FROM admin_profiles WHERE id = $1", [publicKey]);
    if (!rows[0] || !rows[0].totp_secret) {
      return res.status(400).json({ success: false, error: "2FA setup not initiated" });
    }

    const verified = speakeasy.totp.verify({
      secret: rows[0].totp_secret,
      encoding: "base32",
      token,
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({ success: false, error: "Invalid verification code" });
    }

    // Generate backup codes
    const backupCodes = Array.from({ length: 10 }, () =>
      Math.random().toString(36).substring(2, 8).toUpperCase()
    );

    await enable2FA(publicKey, rows[0].totp_secret, backupCodes);

    res.json({
      success: true,
      data: {
        backupCodes,
        message: "2FA enabled successfully. Save these backup codes!"
      }
    });
  } catch (e) { next(e); }
});

// POST /api/2fa/disable — disable 2FA (requires wallet + TOTP or backup code)
router.post("/disable", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey } = req.user;
    const { token, backupCode } = req.body;

    if (!token && !backupCode) {
      return res.status(400).json({ success: false, error: "Token or backup code required" });
    }

    let verified = false;
    if (token) {
      const result = await verify2FA(publicKey, token);
      verified = result.success;
    } else if (backupCode) {
      const result = await verifyBackupCode(publicKey, backupCode);
      verified = result.success;
    }

    if (!verified) {
      return res.status(400).json({ success: false, error: "Invalid token or backup code" });
    }

    await disable2FA(publicKey);
    res.json({ success: true, message: "2FA disabled successfully" });
  } catch (e) { next(e); }
});

// POST /api/2fa/validate — validate TOTP during login
router.post("/validate", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey } = req.user;
    const { token } = req.body;

    if (!token) return res.status(400).json({ success: false, error: "Token is required" });

    const result = await verify2FA(publicKey, token);
    res.json({ success: result.success, error: result.error });
  } catch (e) { next(e); }
});

module.exports = router;
