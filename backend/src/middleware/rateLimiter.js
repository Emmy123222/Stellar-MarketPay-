"use strict";

const rateLimit = require("express-rate-limit");
const { getClientIp } = require("../utils/clientIp");

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
const createRateLimiter = (maxRequests, windowMinutes) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: scaleMaxRequests(maxRequests),
    standardHeaders: true,
    legacyHeaders: true,
    keyGenerator: (req) => getClientIp(req),
    handler: (req, res) => {
      res.set("Retry-After", Math.ceil(windowMinutes * 60));
      return res.status(429).json({
        message: "Too many requests — please wait before trying again",
      });
    },
  });
};

module.exports = { createRateLimiter, getRateLimitScale, scaleMaxRequests };
