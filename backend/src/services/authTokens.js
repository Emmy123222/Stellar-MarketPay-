"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");

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
  return {
    accessToken: signAccessToken(payload),
    refreshToken: createRefreshToken(payload),
  };
}

function rotateRefreshToken(token) {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = refreshSessions.get(tokenHash);
  refreshSessions.delete(tokenHash);

  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }

  return issueTokenPair(session.payload);
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

function setAuthCookies(res, accessToken, refreshToken) {
  const csrfToken = crypto.randomBytes(32).toString("hex");
  res.cookie("token", accessToken, getCookieOptions(15 * 60 * 1000));
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions(REFRESH_TOKEN_TTL_MS));
  res.cookie("XSRF-TOKEN", csrfToken, {
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: REFRESH_TOKEN_TTL_MS,
    httpOnly: false,
  });
}

function clearAuthCookies(res) {
  res.clearCookie("token", getCookieOptions(0));
  res.clearCookie(REFRESH_COOKIE_NAME, getCookieOptions(0));
  res.clearCookie("XSRF-TOKEN", {
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    httpOnly: false,
  });
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
