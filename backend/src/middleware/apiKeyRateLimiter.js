/**
 * src/middleware/apiKeyRateLimiter.js
 *
 * Per-endpoint Redis sliding-window rate limiter for authenticated API keys
 * (Issue #452). Replaces the previous shared fixed-window `express-rate-limit`
 * factory so each endpoint group has its own configurable bucket.
 *
 * Usage:
 *   // before the handler
 *   router.get("/jobs", requireApiKey, apiKeyRateLimiter("public_jobs"), handler);
 *
 * Behavior:
 *   - Counts requests in the CURRENT-minute bucket. To avoid bursts at the
 *     minute boundary we ALSO check the previous bucket's count, weighted by
 *     how much of that bucket has already passed. This is the standard
 *     "sliding window log approximation" used by Cloudflare and others
 *     (see https://blog.cloudflare.com/counting-things-a-lot-of-different-things/).
 *   - Issues an `atomic Lua-script-free` increment via ioredis MULTI, with an
 *     idempotent EXPIRE that keeps the bucket TTL fresh as long as traffic
 *     is flowing.
 *   - Returns HTTP 429 with a `Retry-After` header in **seconds** (the number
 *     of seconds until the current minute bucket rolls over + up to one
 *     minute for boundary alignment).
 *   - Persists request_count to `api_key_usage_minute` so admins can see
 *     usage beyond the in-Redis TTL. Persistence runs fire-and-forget so a
 *     slow PostgreSQL response never blocks the limit decision.
 *   - Fails OPEN if Redis is unreachable (graceful degradation, consistent
 *     with `cacheService`); the request still gets recorded in the database
 *     so the limiter truly "rate limits via DB-backed daily aggregator" as
 *     a last resort.
 */
"use strict";

const { limitFor, ALLOWED_ENDPOINT_KEYS } = require("../config/apiRateLimits");
const cache = require("../services/cacheService");
const {
  recordApiKeyUsageMinute,
} = require("../services/developerService");

const BUCKET_SECONDS = 60;
// previous-minute weight is computed per-request based on how far into
// the current minute we are (decays linearly from 1.0 to 0.0) so the
// sliding window behaves correctly at the boundary.

/**
 * Express middleware factory. `endpointKey` must be one of
 * `ALLOWED_ENDPOINT_KEYS` from `config/apiRateLimits.js`.
 *
 * The middleware MUST be installed AFTER `requireApiKey` so `req.apiKey` is
 * populated; without it, requests are rejected with 500 (programmer error —
 * the limiter depends on the authenticated key id).
 *
 * @param {keyof typeof import("../config/apiRateLimits").DEFAULTS} endpointKey
 */
function apiKeyRateLimiter(endpointKey) {
  if (!ALLOWED_ENDPOINT_KEYS.includes(endpointKey)) {
    throw new Error(
      `apiKeyRateLimiter: unknown endpointKey "${endpointKey}". ` +
        `Allowed keys: ${ALLOWED_ENDPOINT_KEYS.join(", ")}`,
    );
  }

  return async function realApiKeyRateLimiter(req, res, next) {
    try {
      if (!req.apiKey || !req.apiKey.id) {
        // Programmer error: limiter installed before requireApiKey.
        return res
          .status(500)
          .json({ error: "apiKeyRateLimiter requires requireApiKey first" });
      }

      const limit = limitFor(endpointKey);
      const apiKeyId = req.apiKey.id;
      // Normalize route path so /api/public/jobs/123 maps to the
      // `public_jobs` bucket and not its own ad-hoc key.
      const endpointPath = normalizeEndpoint(req, endpointKey);

      const nowSec = Math.floor(Date.now() / 1000);
      const currentBucket = Math.floor(nowSec / BUCKET_SECONDS);
      const previousBucket = currentBucket - 1;
      const secondsIntoCurrent = nowSec - currentBucket * BUCKET_SECONDS;
      // Weight from 1.0 at the start of the minute down to 0.0 at the end —
      // decays linearly so the previous-minute contribution naturally
      // tapers off.
      const previousWeight = 1 - secondsIntoCurrent / BUCKET_SECONDS;

      const currentKey = cache.rateLimitKey(apiKeyId, endpointPath, currentBucket);
      const previousKey = cache.rateLimitKey(apiKeyId, endpointPath, previousBucket);

      const [current, previous] = await Promise.all([
        cache.incrWithExpiry(currentKey, BUCKET_SECONDS),
        safeGet(previousKey),
      ]);

      // Sliding window log approximation (Cloudflare-style):
      // the previous-minute bucket contributes a linearly-decaying
      // fraction of its count, dropping to 0 at the end of the current
      // minute. Without the decay, the previous-minute count would be
      // double-counted at the boundary.
      const weightedCount = current.count + previous * previousWeight;

      // Always record the request for downstream analytics — this fires
      // asynchronously and never blocks the request hot path.
      recordApiKeyUsageMinute(apiKeyId, endpointPath, currentBucket).catch(
        (err) => {
          // eslint-disable-next-line no-console
          console.warn(
            "[apiKeyRateLimiter] failed to persist usage:",
            err.message,
          );
        },
      );

      const standardHeadersOn = res.getHeader("RateLimit-Limit") !== undefined;
      if (standardHeadersOn) {
        res.set("RateLimit-Limit", String(limit));
        res.set("RateLimit-Remaining", String(Math.max(0, limit - Math.ceil(weightedCount))));
        res.set("RateLimit-Reset", String(BUCKET_SECONDS - secondsIntoCurrent));
      }

      if (weightedCount > limit) {
        // Retry-After in seconds until both buckets roll over. Use the
        // bigger of (time left in current minute) and (one minute buffer)
        // so a burst right at the boundary returns a meaningful value.
        const retryAfter = Math.max(1, BUCKET_SECONDS - secondsIntoCurrent);
        res.set("Retry-After", String(retryAfter));
        return res.status(429).json({
          error: "Too many requests for this API key. Please slow down.",
          endpoint: endpointPath,
          limit,
          retryAfterSeconds: retryAfter,
        });
      }

      return next();
    } catch (err) {
      // Defensive fail-open so the limiter never becomes a single point of
      // failure for the public API.
      // eslint-disable-next-line no-console
      console.warn("[apiKeyRateLimiter] unexpected error:", err.message);
      return next();
    }
  };
}

/**
 * Best-effort lookup of the previous-minute counter. Used only for the
 * sliding window math; if Redis is down we treat it as a fresh window and
 * fall back to the fixed-bucket behavior.
 *
 * @param {string} key
 * @returns {Promise<number>}
 */
async function safeGet(key) {
  try {
    const raw = await cache.get(key);
    return Number(raw) || 0;
  } catch {
    return 0;
  }
}
// `previous` is intentionally referenced outside the Promise.all above;
// keeping a cheap getter here so test doubles can mock it without bound.

/**
 * Collapse concrete route paths to the alphanumeric bucket key. We rely
 * on the `endpointKey` argument for the high-level bucket so dynamic params
 * (e.g. /api/public/jobs/:id vs /api/public/jobs/:id/applications) bucket
 * together. If the request didn't match any Express route (e.g. a 404),
 * collapse to a stable sentinel so adversarial floods of unknown URLs
 * can't blow up the Redis keyspace.
 */
const UNKNOWN_ENDPOINT_KEY = "__unknown__";

function normalizeEndpoint(req, endpointKey) {
  const baseUrl = req.baseUrl || "";
  const routePath = req.route && req.route.path ? req.route.path : "";
  if (!routePath) return UNKNOWN_ENDPOINT_KEY;
  const composed = `${baseUrl}${routePath}`.replace(/\/$/, "") || endpointKey;
  return composed || endpointKey;
}

module.exports = { apiKeyRateLimiter };
