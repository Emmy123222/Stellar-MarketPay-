/**
 * src/services/cacheService.js
 * Redis-backed cache with graceful degradation (#290).
 *
 * All public methods silently fall through to the caller on Redis errors so
 * the API never returns 5xx because Redis is down or misconfigured.
 *
 * TTLs:
 *   job listings  — 30 s  (jobs change frequently)
 *   profiles      — 300 s (5 min)
 */
"use strict";

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let client = null;

function getClient() {
  if (client) return client;
  try {
    client = new Redis(REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    client.on("error", (err) => {
      // Log but don't crash — graceful degradation
      console.warn("[cache] Redis error:", err.message);
    });
  } catch (err) {
    console.warn("[cache] Failed to create Redis client:", err.message);
    client = null;
  }
  return client;
}

/**
 * Build a deterministic cache key for job list queries.
 * Sorts params alphabetically so key is stable regardless of insertion order.
 *
 * @param {Record<string, string|undefined>} queryParams
 * @returns {string}
 */
function jobListKey(queryParams) {
  const sorted = Object.entries(queryParams)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return `jobs:list:${new URLSearchParams(sorted).toString()}`;
}

/**
 * Build the profile cache key for a given public key.
 *
 * @param {string} publicKey
 * @returns {string}
 */
function profileKey(publicKey) {
  return `profile:${publicKey}`;
}

/**
 * Get a cached value. Returns null on miss or error.
 *
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function get(key) {
  const redis = getClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Set a cached value with a TTL in seconds.
 *
 * @param {string} key
 * @param {any} value
 * @param {number} ttlSeconds
 */
async function set(key, value, ttlSeconds) {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // Swallow — graceful degradation
  }
}

/**
 * Increment a per-minute counter and return the new value together with the
 * remaining TTL of the bucket. Used by the API key sliding-window rate
 * limiter (issue #452).
 *
 * Resets every minute via EXPIRE so we never keep stale buckets around.
 * Returns `{ count, ttlSeconds }` (or `{ count: 0, ttlSeconds: 60 }` on
 * Redis failure so the rate limiter can fail-open).
 *
 * @param {string} key  e.g. "rl:42:/api/jobs:1700000000"
 * @param {number} ttlSeconds  bucket lifetime (typically 60 for a minute)
 * @returns {Promise<{ count: number, ttlSeconds: number }>}
 */
async function incrWithExpiry(key, ttlSeconds) {
  const redis = getClient();
  if (!redis) return { count: 0, ttlSeconds };
  try {
    // Atomic INCR + conditional EXPIRE via Lua. The conditional matters:
    // we only set EXPIRE on the FIRST increment so subsequent hits don't
    // reset the bucket's TTL — otherwise the bucket would never roll
    // over within an active minute. Atomicity prevents the failure mode
    // where INCR succeeds but EXPIRE doesn't (which would create an
    // infinite-lived bucket defeating the limiter).
    const script =
      "local c = redis.call('INCR', KEYS[1])\n" +
      "if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end\n" +
      "local t = redis.call('TTL', KEYS[1])\n" +
      "return {c, t}";
    const result = await redis.eval(script, 1, key, ttlSeconds);
    if (!Array.isArray(result)) return { count: 0, ttlSeconds };
    const count = Number(result[0]) || 0;
    const ttl = Number(result[1]);
    return {
      count,
      // If TTL came back negative (key expired between INCR and TTL),
      // fall back to the requested ttl so the rate limiter can compute
      // a sensible Retry-After.
      ttlSeconds: ttl > 0 ? ttl : ttlSeconds,
    };
  } catch (err) {
    // Swallow but record so the leak path is observable in logs.
    // eslint-disable-next-line no-console
    console.warn("[cache] incrWithExpiry Lua eval failed:", err.message);
    return { count: 0, ttlSeconds };
  }
}

/**
 * Build a sliding-window Redis key for an API key + endpoint at a given
 * minute bucket. Matches the pattern mandated by the AC for issue #452:
 * `rl:{api_key}:{endpoint}:{minute_bucket}` where the minute bucket is
 * `floor(now_seconds / 60)`.
 *
 * @param {string|number} apiKeyId
 * @param {string} endpoint  normalized route key, e.g. "/api/jobs"
 * @param {number} minuteBucket  `Math.floor(Date.now()/1000/60)`
 */
function rateLimitKey(apiKeyId, endpoint, minuteBucket) {
  return `rl:${apiKeyId}:${endpoint}:${minuteBucket}`;
}

/**
 * Delete all keys matching a glob pattern.
 * Used to invalidate job list cache on write operations.
 *
 * @param {string} pattern  e.g. "jobs:list:*"
 */
async function delPattern(pattern) {
  const redis = getClient();
  if (!redis) return;
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    // Swallow — graceful degradation
  }
}

/**
 * Delete a single key.
 *
 * @param {string} key
 */
async function del(key) {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // Swallow — graceful degradation
  }
}

module.exports = {
  get,
  set,
  del,
  delPattern,
  jobListKey,
  profileKey,
  incrWithExpiry,
  rateLimitKey,
};

// TTL constants exported so callers don't hard-code numbers.
module.exports.TTL = {
  JOBS_LIST: 30,   // 30 s — jobs change frequently
  PROFILE: 300,    // 5 min
};
