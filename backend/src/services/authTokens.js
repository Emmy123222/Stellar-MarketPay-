"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const { CSRF_COOKIE_NAME } = require("../middleware/csrf");

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_NAME = "refreshToken";
const JWT_RESERVED_CLAIMS = new Set(["iat", "exp", "nbf", "jti"]);

const refreshSessions = new Map();

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizePayload(payload) {
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([claim]) => !JWT_RESERVED_CLAIMS.has(claim)),
  );
}

function signAccessToken(payload) {
  return jwt.sign(normalizePayload(payload), JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

function createRefreshToken(payload) {
  const token = crypto.randomBytes(48).toString("base64url");
  refreshSessions.set(hashToken(token), {
    payload: normalizePayload(payload),
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });
  return token;
}

/**
 * Generate a fresh CSRF token. The cookie-bound counterpart is set by the
 * `csrf-csrf` middleware via the `/api/auth/csrf-token` endpoint; this raw
 * token is returned so it can be issued alongside auth cookies during login
 * and refresh so first-page-render mutations work without an extra round trip.
 */
function createCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function issueTokenPair(payload) {
  const accessToken = signAccessToken(payload);
  const refreshToken = createRefreshToken(payload);
  const csrfToken = createCsrfToken();
  return { accessToken, refreshToken, csrfToken };
}

function rotateRefreshToken(token) {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = refreshSessions.get(tokenHash);
  refreshSessions.delete(tokenHash);

  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }

  // Rotate the CSRF token along with the access/refresh pair so a stale
  // pre-refresh token cannot be replayed.
  return { ...issueTokenPair(session.payload) };
}

function revokeRefreshToken(token) {
  if (token) {
    refreshSessions.delete(hashToken(token));
  }
}

function parseCookieHeader(header) {
  return String(header || "")
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

function getRefreshTokenFromRequest(req) {
  return parseCookieHeader(req.headers.cookie)[REFRESH_COOKIE_NAME] || null;
}

function getCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge,
  };
}

function getCsrfCookieOptions(maxAge) {
  return {
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge,
    httpOnly: false,
  };
}

function setAuthCookies(res, accessToken, refreshToken, csrfToken) {
  res.cookie("token", accessToken, getCookieOptions(15 * 60 * 1000));
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions(REFRESH_TOKEN_TTL_MS));
  if (csrfToken) {
    res.cookie(CSRF_COOKIE_NAME, csrfToken, getCsrfCookieOptions(REFRESH_TOKEN_TTL_MS));
  }
}

function clearAuthCookies(res) {
  res.clearCookie("token", getCookieOptions(0));
  res.clearCookie(REFRESH_COOKIE_NAME, getCookieOptions(0));
  res.clearCookie(CSRF_COOKIE_NAME, getCsrfCookieOptions(0));
}

module.exports = {
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  clearAuthCookies,
  createCsrfToken,
  getRefreshTokenFromRequest,
  issueTokenPair,
  refreshSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  setAuthCookies,
  signAccessToken,
};
