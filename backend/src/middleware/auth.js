/**
 * src/middleware/auth.js
 */
"use strict";
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { requireEnv } = require("../config/env");

const JWT_SECRET = requireEnv("JWT_SECRET");

async function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
}

async function requireAdmin2FA(req, res, next) {
  if (req.user?.role !== "admin") return next();

  try {
    const { rows } = await pool.query(
      "SELECT totp_enabled FROM admin_profiles WHERE id = $1",
      [req.user.publicKey]
    );
    if (rows[0]?.totp_enabled && !req.user["2fa_verified"]) {
      return res.status(403).json({ error: "2FA required", requires2FA: true });
    }
    next();
  } catch {
    return res.status(500).json({ error: "Failed to verify 2FA status" });
  }
}

module.exports = { verifyJWT, requireAdmin2FA, JWT_SECRET };
