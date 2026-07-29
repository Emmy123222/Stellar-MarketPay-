/**
 * src/services/cacheService.js
 * Redis-backed cache with graceful degradation (#290).
 *
 * Delegates core Redis operations to src/utils/cache.js (#774).
 */
"use strict";

const cacheUtil = require("../utils/cache");

function getClient() {
  return cacheUtil.getClient();
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
 * Increment a per-minute counter and return the new value together with the
 * remaining TTL of the bucket. Used by the API key sliding-window rate
 * limiter (issue #452).
 *
 * @param {string} key  e.g. "rl:42:/api/jobs:1700000000"
 * @param {number} ttlSeconds  bucket lifetime (typically 60 for a minute)
 * @returns {Promise<{ count: number, ttlSeconds: number }>}
 */
async function incrWithExpiry(key, ttlSeconds) {
  const redis = getClient();
  if (!redis) return { count: 0, ttlSeconds };
  try {
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
      ttlSeconds: ttl > 0 ? ttl : ttlSeconds,
    };
  } catch (err) {
    console.warn("[cache] incrWithExpiry Lua eval failed:", err.message);
    return { count: 0, ttlSeconds };
  }
}

/**
 * Build a sliding-window Redis key for an API key + endpoint at a given minute bucket.
 *
 * @param {string|number} apiKeyId
 * @param {string} endpoint
 * @param {number} minuteBucket
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

/**
 * Ping Redis to verify connectivity. Returns 'up' or 'down'.
 * Used by the health check endpoint.
 * @returns {Promise<'up'|'down'>}
 */
async function ping() {
  const redis = getClient();
  if (!redis) return "down";
  try {
    await redis.ping();
    return "up";
  } catch {
    return "down";
  }
}

module.exports = {
  getClient,
  get: cacheUtil.get,
  set: cacheUtil.set,
  del: cacheUtil.del,
  delPattern: cacheUtil.delPattern,
  jobListKey: cacheUtil.jobListKey,
  invalidateJobListCache: cacheUtil.invalidateJobListCache,
  profileKey,
  incrWithExpiry,
  rateLimitKey,
  ping,
};

