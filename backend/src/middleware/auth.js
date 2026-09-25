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
    const { totp_enabled } = rows[0] || {};

    // 2FA not configured for this admin — let them through
    if (!totp_enabled) return next();

    // Option 1: JWT already carries a verified 2FA claim (session-based)
    if (req.user["2fa_verified"]) return next();

    // Option 2: per-request X-2FA-Token header (stateless, preferred for API clients)
    const headerToken = req.headers["x-2fa-token"];
    if (headerToken) {
      const { verify2FA } = require("../services/twoFactorService");
      const result = await verify2FA(req.user.publicKey, String(headerToken));
      if (result.success) return next();
      return res.status(403).json({ error: result.error, requires2FA: true });
    }

    return res.status(403).json({ error: "2FA required", requires2FA: true });
  } catch {
    return res.status(500).json({ error: "Failed to verify 2FA status" });
  }
}

module.exports = { verifyJWT, requireAdminRole, requireAdmin2FA, JWT_SECRET, requireJwtSecret };
