"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const { generateCsrfToken } = require("../middleware/csrf");

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

function issueTokenPair(payload) {
  const accessToken = signAccessToken(payload);
  const refreshToken = createRefreshToken(payload);
  return { accessToken, refreshToken };
}

function rotateRefreshToken(token) {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = refreshSessions.get(tokenHash);
  refreshSessions.delete(tokenHash);

  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }

  // Rotate the access/refresh pair along with the CSRF token so a stale
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

/**
 * Set the authentication cookie pair and a freshly minted CSRF token.
 *
 * The CSRF token is produced by the SAME csrf-csrf machinery that validates it
 * in middleware/csrf.js, so the value we write to the `csrf-token` cookie is
 * immediately acceptable to `doubleCsrfProtection` — no separate raw
 * `createCsrfToken()` implementation that the middleware would reject
 * (issue #1129).
 *
 * Because the token's HMAC is bound to the session identifier (the refresh
 * token, see getSessionIdentifier), we stamp the NEW refresh token into
 * `req.cookies` before minting. That ensures the issued token is keyed to the
 * session created by this login/refresh, not the anonymous or pre-rotation
 * session. `overwrite: true` guarantees a genuinely fresh token even when a
 * valid (but now stale) pre-login cookie exists.
 *
 * Returns the minted CSRF token so callers can echo it in the JSON body.
 */
function setAuthCookies(req, res, accessToken, refreshToken) {
  res.cookie("token", accessToken, getCookieOptions(15 * 60 * 1000));
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions(REFRESH_TOKEN_TTL_MS));

  // Bind the CSRF token to the refresh token we're about to set, even though
  // the request's own cookies still carry the old (or absent) one.
  req.cookies = { ...(req.cookies || {}), [REFRESH_COOKIE_NAME]: refreshToken };

  const csrfToken = generateCsrfToken(req, res, {
    overwrite: true,
    cookieOptions: getCsrfCookieOptions(REFRESH_TOKEN_TTL_MS),
  });

  return csrfToken;
}

function clearAuthCookies(res) {
  res.clearCookie("token", getCookieOptions(0));
  res.clearCookie(REFRESH_COOKIE_NAME, getCookieOptions(0));
  res.clearCookie("csrf-token", getCsrfCookieOptions(0));
}

module.exports = {
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_COOKIE_NAME,
  clearAuthCookies,
  getRefreshTokenFromRequest,
  issueTokenPair,
  refreshSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  setAuthCookies,
  signAccessToken,
};
