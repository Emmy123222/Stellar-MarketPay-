/**
 * src/middleware/auth.js
 */
"use strict";
const jwt = require("jsonwebtoken");

function requireJwtSecret() {
  if (!process.env.JWT_SECRET) {
    const message = "FATAL: JWT_SECRET environment variable is required";
    console.error(message);
    process.exit(1);
  }

  return process.env.JWT_SECRET;
}

const JWT_SECRET = requireJwtSecret();
const pool = require("../db/pool");

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const name = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

async function verifyJWT(req, res, next) {
  let token = null;

  // 1. Read from cookie
  if (req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies.token;
  }

  // 2. Fallback to Authorization header
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
}

function requireAdminRole(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }

  return next();
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

module.exports = { verifyJWT, requireAdminRole, requireAdmin2FA, JWT_SECRET, requireJwtSecret };
