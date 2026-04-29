/**
 * src/middleware/auth.js
 */
"use strict";
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_fallback_key";

async function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // Check if admin requires 2FA
    if (decoded.role === "admin") {
      const { rows } = await pool.query(
        "SELECT totp_enabled FROM admin_profiles WHERE id = $1",
        [decoded.publicKey]
      );
      if (rows[0] && rows[0].totp_enabled && !decoded.totpVerified) {
        return res.status(403).json({ error: "2FA required", requires2FA: true });
      }
    }

    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
}

module.exports = { verifyJWT, JWT_SECRET };
