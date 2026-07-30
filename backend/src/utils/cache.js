/**
 * src/utils/cache.js
 * Redis cache wrapper module wrapping the ioredis client with graceful degradation (#774).
 *
 * All public methods fail open/fall through silently on Redis errors so the API
 * never returns 5xx because Redis is down or misconfigured.
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
function jobListKey(queryParams = {}) {
  const sorted = Object.entries(queryParams)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return `jobs:list:${new URLSearchParams(sorted).toString()}`;
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
 * Delete all keys matching a glob pattern.
 *
 * @param {string} pattern e.g. "jobs:list:*"
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
 * Invalidate job list cache entries.
 */
async function invalidateJobListCache() {
  await delPattern("jobs:list:*");
}

module.exports = {
  getClient,
  get,
  set,
  del,
  delPattern,
  jobListKey,
  invalidateJobListCache,
  TTL: {
    JOBS_LIST: 30, // 30 seconds
    STATS: 60,     // 60 seconds
    PROFILE: 300,  // 5 minutes
  },
};
