/**
 * Admin TOTP 2FA — POST /api/admin/2fa/setup, POST /api/admin/2fa/verify
 */
"use strict";

const express = require("express");
const QRCode = require("qrcode");
const speakeasy = require("speakeasy");
const pool = require("../db/pool");
const { verifyJWT } = require("../middleware/auth");
const { signAccessToken } = require("../services/authTokens");
const { encrypt } = require("../utils/encryption");
const {
  generateSecret,
  enable2FA,
  verify2FA,
  get2FAStatus,
  ensureAdminProfile,
  getDecryptedSecret,
} = require("../services/twoFactorService");

const router = express.Router();

function requireAdminWallet(req, res, next) {
  const adminAddresses = (process.env.ADMIN_WALLET_ADDRESSES || "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (!adminAddresses.includes(req.user.publicKey) && req.user.role !== "admin") {
    return res.status(403).json({ success: false, error: "Admin access required" });
  }
  next();
}

function issueAdminToken(publicKey, twoFaVerified) {
  return signAccessToken({ publicKey, role: "admin", "2fa_verified": twoFaVerified });
}

// POST /api/admin/2fa/setup — generate TOTP secret and QR code
router.post("/setup", verifyJWT, requireAdminWallet, async (req, res, next) => {
  try {
    const { publicKey } = req.user;
    await ensureAdminProfile(publicKey);

    const { rows } = await pool.query("SELECT totp_enabled FROM admin_profiles WHERE id = $1", [publicKey]);
    if (rows[0]?.totp_enabled) {
      return res.status(400).json({ success: false, error: "2FA is already enabled" });
    }

    const secret = generateSecret(publicKey);
    const qrCode = await QRCode.toDataURL(secret.otpauth_url || secret.otpauthURL);

    await pool.query(
      "UPDATE admin_profiles SET totp_secret = $1, totp_enabled = false, updated_at = NOW() WHERE id = $2",
      [encrypt(secret.base32), publicKey]
    );

    res.json({
      success: true,
      data: {
        qrCode,
        manualEntryKey: secret.base32,
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/2fa/verify — verify TOTP, enable 2FA (setup), upgrade JWT
router.post("/verify", verifyJWT, requireAdminWallet, async (req, res, next) => {
  try {
    const { publicKey } = req.user;
    const { token, setup } = req.body;

    if (!token || String(token).length !== 6) {
      return res.status(400).json({ success: false, error: "A 6-digit TOTP code is required" });
    }

    const status = await get2FAStatus(publicKey);
    const secret = await getDecryptedSecret(publicKey);

    if (!secret) {
      return res.status(400).json({ success: false, error: "2FA setup not initiated. Call /setup first." });
    }

    let backupCodes;

    if (setup || !status.totp_enabled) {
      const verified = speakeasy.totp.verify({
        secret,
        encoding: "base32",
        token: String(token),
        window: 1,
      });

      if (!verified) {
        return res.status(400).json({ success: false, error: "Invalid verification code" });
      }

      backupCodes = Array.from({ length: 10 }, () =>
        Math.random().toString(36).substring(2, 10).toUpperCase()
      );
      await enable2FA(publicKey, secret, backupCodes);
    } else {
      const result = await verify2FA(publicKey, String(token));
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }
    }

    const upgradedToken = issueAdminToken(publicKey, true);

    res.json({
      success: true,
      token: upgradedToken,
      data: {
        backupCodes,
        message: backupCodes
          ? "2FA enabled. Save your backup codes — they will not be shown again."
          : "2FA verified",
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/2fa/status
router.get("/status", verifyJWT, requireAdminWallet, async (req, res, next) => {
  try {
    const status = await get2FAStatus(req.user.publicKey);
    res.json({
      success: true,
      data: {
        ...status,
        verified: Boolean(req.user["2fa_verified"]),
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
