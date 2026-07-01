/**
 * src/middleware/csrf.js
 *
 * Cross-Site Request Forgery (CSRF) protection for state-mutating API endpoints.
 *
 * Strategy: double-submit cookie pattern.
 *   1. The client calls `GET /api/auth/csrf-token`.
 *   2. The server generates a fresh token, sets it as a non-HttpOnly cookie,
 *      and returns it in the JSON body.
 *   3. For every subsequent state-mutating request the client sends the token
 *      in the `X-CSRF-Token` header.
 *   4. `doubleCsrfProtection` verifies the HMAC-signed cookie matches the
 *      supplied header token before allowing the request through.
 *
 * Backed by the `csrf-csrf` package — the actively-maintained successor to
 * the deprecated `csurf`. Implementation follows OWASP guidance for SPA
 * architecture: token issued via a dedicated endpoint, sent as a header that
 * JavaScript reads (so the cookie may remain non-HttpOnly without weakening
 * cookie security elsewhere — see HttpOnly `token` and `refreshToken` cookies).
 */
"use strict";

const { doubleCsrf } = require("csrf-csrf");

const CSRF_COOKIE_NAME = "csrf-token";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_HEADER_PUBLIC = "X-CSRF-Token";

/**
 * Endpoints that bypass CSRF protection. These either:
 *   - carry no cookie-based credentials (API key auth via headers), or
 *   - are required to bootstrap the session / CSRF chain itself, or
 *   - are operational endpoints scraped by external systems (monitoring,
 *     health checks, API docs).
 */
function shouldSkipCsrf(req) {
  // Safe HTTP methods are never CSRF-checked per OWASP guidance.
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;

  const path = req.path;

  // Bootstrap path — clients must be able to fetch a CSRF token without
  // already having one.
  if (path.startsWith("/api/auth")) return true;

  // Operational endpoints — scraped by Prometheus / load balancers with
  // no browser context.
  if (path === "/health" || path.startsWith("/health/")) return true;
  if (path === "/metrics") return true;
  if (path.startsWith("/api/docs")) return true;

  // Developer / public API — authenticated via X-API-Key header, not cookies.
  // An attacker on a cross-origin page cannot read the API key, so CSRF is
  // not the right mitigation here. Rate limiting and IP allowlists apply.
  if (path.startsWith("/api/public/")) return true;
  if (path.startsWith("/api/developer/")) return true;

  return false;
}

/**
 * Resolve the secret used to HMAC-sign csrf-token cookies. We deliberately
 * refuse to silently fall back to a known/guessable string in production —
 * an attacker who knows the HMAC secret can forge tokens. In development
 * the lazy fallback keeps the local quick-start path friction-free, but
 * production deployments MUST set CSRF_SECRET.
 */
function getCsrfSecret() {
  const explicit = process.env.CSRF_SECRET;
  if (explicit) return explicit;

  if (isProd()) {
    throw new Error(
      "FATAL: CSRF_SECRET environment variable is required in production. " +
      "Refusing to start with a fallback secret to keep CSRF tokens unforgeable.",
    );
  }

  // Dev/CI only — CSRF_SECRET in jest.setup.js covers the test path.
  console.warn(
    "[csrf] CSRF_SECRET is not set; using JWT_SECRET as a development-only fallback. " +
    "Set CSRF_SECRET before deploying.",
  );
  return process.env.JWT_SECRET || "csrf-dev-secret-do-not-use-in-production";
}

function isProd() {
  return process.env.NODE_ENV === "production";
}

// Eager startup validation: misconfigured production deployments fail fast
// instead of silently running with an unsafe default.
try {
  getCsrfSecret();
} catch (err) {
  if (isProd()) {
    console.error(err.message);
    process.exit(1);
  }
}

const { doubleCsrfProtection: csrfProtect, generateCsrfToken: csrfGenerate } = doubleCsrf({
  getSecret: getCsrfSecret,
  cookieName: CSRF_COOKIE_NAME,
  cookieOptions: {
    secure: isProd(),
    sameSite: "strict",
    httpOnly: false, // Frontend reads the cookie via /api/auth/csrf-token body.
    path: "/",
  },
  getCsrfTokenFromRequest: (req) => {
    // Prefer the documented custom header; fall back to the legacy alias
    // so first-party tooling in flight during the rename still works.
    return (
      req.headers[CSRF_HEADER_NAME] ||
      req.headers["x-xsrf-token"] ||
      null
    );
  },
  size: 64,
});

function doubleCsrfProtection(req, res, next) {
  if (shouldSkipCsrf(req)) return next();
  return csrfProtect(req, res, next);
}

function generateCsrfToken(req, res) {
  return csrfGenerate(req, res);
}

module.exports = {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_HEADER_PUBLIC,
  doubleCsrfProtection,
  generateCsrfToken,
  getCsrfSecret,
  isProd,
  shouldSkipCsrf,
};
