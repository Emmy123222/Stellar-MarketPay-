/**
 * backend/src/config/apiRateLimits.js
 *
 * Per-endpoint rate-limit configuration for the Stellar MarketPay developer
 * API key sliding-window rate limiter (Issue #452).
 *
 * Each endpoint key is an opaque identifier matching the route module that
 * applies it via `apiKeyRateLimiter("<key>")`. The same key is recorded in
 * the new `api_key_usage_minute` table so the admin dashboard can break down
 * traffic per endpoint without inspecting the Redis keyspace.
 *
 * Resolution order: explicit per-endpoint constant → API_RATE_LIMITS_JSON env
 * override (a JSON object with the same shape) → DEFAULT_LIMIT.
 *
 * `ALLOWED_ENDPOINT_KEYS` is exported so invalid keys (typos) fail loudly.
 */

const DEFAULTS = Object.freeze({
  // Public developer endpoints mounted under /api/public/*
  public_jobs:                 60,   // 60 req/min/key for /api/public/jobs
  public_job:                  60,   // /api/public/jobs/:id
  public_freelancer:           60,   // /api/public/freelancers/:publicKey
  // Internal developer portal endpoints
  dev_keys_list:               30,   // GET    /api/developer/keys (slug is raw route path)
  dev_keys_create:             10,   // POST   /api/developer/keys
  dev_key_revoke:              10,   // DELETE /api/developer/keys/:id
  dev_key_rotate:               5,   // POST   /api/developer/keys/:id/rotate
  // Catch-all so unknown endpoints aren't unbounded
  default:                     30,
});

let overrides = {};
try {
  if (process.env.API_RATE_LIMITS_JSON) {
    overrides = JSON.parse(process.env.API_RATE_LIMITS_JSON);
    if (!overrides || typeof overrides !== "object") overrides = {};
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn("[apiRateLimits] failed to parse API_RATE_LIMITS_JSON:", err.message);
  overrides = {};
}

/**
 * Resolve the per-minute request ceiling for `endpointKey`.
 *
 * @param {string} endpointKey
 * @returns {number} a positive integer ceiling
 */
function limitFor(endpointKey) {
  const overridden = Number(overrides[endpointKey]);
  if (Number.isFinite(overridden) && overridden >= 1) return Math.floor(overridden);
  const fromDefaults = Number(DEFAULTS[endpointKey]);
  if (Number.isFinite(fromDefaults) && fromDefaults >= 1) return Math.floor(fromDefaults);
  return Math.max(1, Math.floor(Number(DEFAULTS.default) || 30));
}

const ALLOWED_ENDPOINT_KEYS = Object.freeze(Object.keys(DEFAULTS));

module.exports = {
  limitFor,
  ALLOWED_ENDPOINT_KEYS,
  DEFAULTS,
};
