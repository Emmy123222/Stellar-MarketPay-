"use strict";

const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const pool = require("../db/pool");
const { getClientIp } = require("../utils/clientIp");
const { createServiceLogger } = require("../utils/logger");

const rateLimitLogger = createServiceLogger("rate-limiter");

const MAX_OPEN_DISPUTES = 3;
const MAX_DISPUTES_30_DAYS = 10;

/**
 * Environment-driven multiplier applied to every rate-limit `max` value.
 *
 * Defaults to `1` (production behaviour is unchanged). In dedicated load-test
 * or staging environments it can be raised (e.g. `RATE_LIMIT_SCALE=1000`) so
 * that application-level throttling does not mask the API's true throughput
 * under synthetic load. The value is read lazily so tests that mutate
 * `process.env` between requests still behave deterministically.
 *
 * @returns {number} A positive integer multiplier (>= 1).
 */
function getRateLimitScale() {
  const raw = Number(process.env.RATE_LIMIT_SCALE);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return 1;
}

/**
 * Apply the environment rate-limit scale to a raw request ceiling.
 *
 * @param {number} maxRequests - Unscaled maximum requests for the window.
 * @returns {number} Scaled maximum (always >= 1).
 */
function scaleMaxRequests(maxRequests) {
  return Math.max(1, Math.floor(maxRequests * getRateLimitScale()));
}

/**
 * Factory function to create reusable rate limiters
 */
const createRateLimiter = (maxRequests, windowMinutes, options = {}) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: scaleMaxRequests(maxRequests),
    standardHeaders: true,
    legacyHeaders: true,
    keyGenerator: (req) => req.ip,
    handler: (req, res) => {
      const retryAfter = Math.ceil(windowMinutes * 60);
      res.set("Retry-After", String(retryAfter));
      res.set("Cache-Control", "no-store");
      rateLimitLogger.warn({
        endpoint: options.name || req.originalUrl,
        ip: getClientIp(req),
        method: req.method,
        path: req.path,
        userId: req.user?.publicKey,
        retryAfter,
        requestId: req.requestId,
      }, "Rate limit exceeded");
      return res.status(429).json({
        error: "Too many requests — please wait before trying again",
        message: "Too many requests — please wait before trying again",
      });
    },
    ...options,
  });
};

/**
 * Hash a rate-limit identifier so raw IPs, wallet addresses and API key ids are
 * never used as (or embedded in) limiter keys.
 *
 * @param {string} scope Bucket namespace, e.g. `"faucet"` or `"wallet"`.
 * @param {unknown} value Raw identifier.
 * @returns {string} `"<scope>:<32 hex chars>"`.
 */
function hashRateLimitIdentifier(scope, value) {
  const raw = value === undefined || value === null ? "" : String(value);
  const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
  return `${scope}:${digest}`;
}

/**
 * Build a pair of limiters for abuse-sensitive endpoints: one keyed by client
 * IP and one keyed by a caller-supplied principal (wallet address, API key,
 * user id, …). Running both means rotating proxies cannot lift the limit, while
 * the principal bucket also caps a single account behind many IPs.
 *
 * Identifiers are hashed by `hashRateLimitIdentifier`, and a request without a
 * principal falls back to its IP so missing input never funnels every caller
 * into one shared bucket.
 *
 * @param {object} options
 * @param {string} options.namespace Bucket namespace used for limiter names.
 * @param {number} options.windowMinutes Window length in minutes.
 * @param {number} options.maxRequestsPerIp Per-IP ceiling.
 * @param {number} options.maxRequestsPerPrincipal Per-principal ceiling.
 * @param {(req: import("express").Request) => string|undefined} options.principalKeyGenerator
 * @param {object} [options.store] Optional `express-rate-limit` store (e.g. Redis).
 * @returns {[import("express").RequestHandler, import("express").RequestHandler]}
 *          `[ipLimiter, principalLimiter]`.
 */
function createSensitiveRateLimiters({
  namespace,
  windowMinutes,
  maxRequestsPerIp,
  maxRequestsPerPrincipal,
  principalKeyGenerator,
  store,
} = {}) {
  const ipStore = store ? { store, keyPrefix: `rl:${namespace}:ip:` } : { keyPrefix: `rl:${namespace}:ip:` };

  const ipLimiter = createRateLimiter(maxRequestsPerIp, windowMinutes, {
    ...ipStore,
    name: `${namespace}:ip`,
    keyGenerator: (req) => hashRateLimitIdentifier("ip", getClientIp(req)),
  });

  const principalStore = store
    ? { store, keyPrefix: `rl:${namespace}:principal:` }
    : { keyPrefix: `rl:${namespace}:principal:` };

  const principalLimiter = createRateLimiter(maxRequestsPerPrincipal, windowMinutes, {
    ...principalStore,
    name: `${namespace}:principal`,
    keyGenerator: (req) => {
      const principal = principalKeyGenerator ? principalKeyGenerator(req) : undefined;
      if (principal === undefined || principal === null || principal === "") {
        return hashRateLimitIdentifier("ip", getClientIp(req));
      }
      return hashRateLimitIdentifier(namespace, principal);
    },
  });

  return [ipLimiter, principalLimiter];
}

/**
 * Dispute-specific rate limiter.
 * Checks two limits before allowing a dispute to be created:
 *   1. Max 3 open disputes per user at any time.
 *   2. Max 10 disputes opened per 30-day rolling window per user.
 *
 * Admin users (from ADMIN_WALLET_ADDRESSES or role "admin") are exempt.
 * Returns 429 with a Retry-After header when a limit is exceeded.
 */
async function createDisputeRateLimiter(req, res, next) {
  try {
    const userKey = req.user?.publicKey;
    if (!userKey) return next();

    const adminAddresses = (process.env.ADMIN_WALLET_ADDRESSES || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const isAdmin =
      adminAddresses.includes(userKey) || req.user?.role === "admin";
    if (isAdmin) return next();

    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'disputed') AS open_count,
         COUNT(*) FILTER (WHERE disputed_at > NOW() - INTERVAL '30 days') AS recent_count
       FROM jobs
       WHERE disputed_by = $1`,
      [userKey],
    );

    const { open_count, recent_count } = rows[0];
    const openCount = parseInt(open_count, 10);
    const recentCount = parseInt(recent_count, 10);

    if (openCount >= MAX_OPEN_DISPUTES) {
      res.set("Retry-After", "3600");
      return res.status(429).json({
        error: `You already have ${openCount} open ${openCount === 1 ? "dispute" : "disputes"}. Maximum is ${MAX_OPEN_DISPUTES}. Resolve existing disputes before opening new ones.`,
        code: "RATE_LIMITED",
      });
    }

    if (recentCount >= MAX_DISPUTES_30_DAYS) {
      res.set("Retry-After", "86400");
      return res.status(429).json({
        error: `You have opened ${recentCount} ${recentCount === 1 ? "dispute" : "disputes"} in the last 30 days. Maximum is ${MAX_DISPUTES_30_DAYS}. Please wait before opening more.`,
        code: "RATE_LIMITED",
      });
    }

    next();
  } catch (err) {
    console.error("[disputeRateLimiter] Error:", err.message);
    next();
  }
}

module.exports = {
  createRateLimiter,
  createDisputeRateLimiter,
  createSensitiveRateLimiters,
  getRateLimitScale,
  scaleMaxRequests,
  hashRateLimitIdentifier,
  rateLimitLogger,
};
