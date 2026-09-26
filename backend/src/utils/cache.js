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
 * Entity types that may be cached by ID. Every entity key is "<type>:<id>" so
 * a job with ID 42 and a profile with ID 42 can never share a cache entry
 * (issue #1399).
 */
const ENTITY_TYPES = Object.freeze(["job", "profile", "escrow"]);

/**
 * Build an entity-scoped cache key, e.g. entityKey("job", 42) -> "job:42".
 *
 * @param {"job"|"profile"|"escrow"} type
 * @param {string|number} id
 * @returns {string}
 */
function entityKey(type, id) {
  if (!ENTITY_TYPES.includes(type)) {
    throw new TypeError(
      `Unknown cache entity type "${type}" (expected one of: ${ENTITY_TYPES.join(", ")})`,
    );
  }
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    String(id).length === 0
  ) {
    throw new TypeError(`Cache key for "${type}" needs a non-empty id`);
  }
  return `${type}:${id}`;
}

const jobKey = (id) => entityKey("job", id);
const profileKey = (id) => entityKey("profile", id);
const escrowKey = (id) => entityKey("escrow", id);

/**
 * A usable cache key is a string that starts with a namespace, like "job:42"
 * or "jobs:list:...". Bare keys such as 42 or "42" are rejected because they
 * can collide across entity types.
 *
 * @param {any} key
 * @returns {boolean}
 */
function isNamespacedKey(key) {
  return typeof key === "string" && /^[a-z][a-z0-9_-]*:.+/i.test(key);
}

// Never log the key itself: some keys embed identifiers such as API key ids
// (e.g. rate-limit keys), so only the operation and the key's type are shown.
function rejectBareKey(op, key) {
  console.warn(
    `[cache] ${op} ignored: key (${typeof key}) has no entity prefix (use job:<id>, profile:<id>, escrow:<id>)`,
  );
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
  if (!isNamespacedKey(key)) {
    rejectBareKey("get", key);
    return null;
  }
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
  if (!isNamespacedKey(key)) {
    rejectBareKey("set", key);
    return;
  }
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
  if (!isNamespacedKey(key)) {
    rejectBareKey("del", key);
    return;
  }
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
  ENTITY_TYPES,
  entityKey,
  jobKey,
  profileKey,
  escrowKey,
  isNamespacedKey,
  TTL: {
    JOBS_LIST: 30, // 30 seconds
    STATS: 60,     // 60 seconds
    PROFILE: 300,  // 5 minutes
  },
};
