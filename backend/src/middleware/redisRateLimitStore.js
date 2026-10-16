/**
 * middleware/redisRateLimitStore.js
 * Redis-backed store for express-rate-limit, used where a limit has to survive
 * process restarts and span multiple API instances (e.g. the faucet per-wallet
 * limit that must not be bypassed by rotating proxies).
 */
"use strict";

const Redis = require("ioredis");
const { createServiceLogger } = require("../utils/logger");

const rateLimitLogger = createServiceLogger("rate-limit-store");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let client = null;

/**
 * Lazily create the shared rate-limit Redis client.
 *
 * @returns {import("ioredis").Redis|null} `null` when the client cannot be created.
 */
function getRateLimitRedisClient() {
  if (client) return client;
  try {
    client = new Redis(REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    client.on("error", (err) => {
      rateLimitLogger.warn({ error: err.message }, "Rate limit Redis error");
    });
  } catch (err) {
    rateLimitLogger.warn({ error: err.message }, "Failed to create rate limit Redis client");
    client = null;
  }
  return client;
}

/**
 * Error raised when Redis cannot serve a rate-limit decision. Callers fail
 * closed with 503 so an unavailable store never silently removes the limit.
 *
 * @param {Error} cause
 * @returns {Error & {status: number, cause: Error}}
 */
function storeUnavailableError(cause) {
  const err = new Error("Rate limiting service unavailable");
  err.status = 503;
  err.cause = cause;
  return err;
}

/**
 * Minimal `express-rate-limit` v7 Store backed by Redis.
 *
 * Counters are stored as a Redis hash so each request is a single round trip:
 * `HINCRBY` bumps `totalHits` and `PEXPIRE` refreshes the window TTL.
 */
class RedisRateLimitStore {
  /**
   * @param {object} [options]
   * @param {string} [options.prefix] Key namespace, e.g. `"faucet:wallet:"`.
   * @param {number} [options.windowMs] Fallback window used when `init` is not called.
   * @param {string} [options.sendStatusAsHeader]
   */
  constructor(options = {}) {
    this.prefix = options.prefix || "ratelimit:";
    this.windowMs = Number(options.windowMs) || 0;
    this.localKeys = false;
    this.sendStatusAsHeader = options.sendStatusAsHeader;
  }

  /**
   * @param {{windowMs: number}} options Options handed over by express-rate-limit.
   * @returns {this}
   */
  init(options = {}) {
    this.windowMs = Number(options.windowMs) || this.windowMs;
    return this;
  }

  /**
   * @param {string} key
   * @returns {string}
   */
  fullKey(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * Increment the hit counter for `key`.
   *
   * @param {string} key
   * @returns {Promise<{totalHits: number, resetTime: Date}>}
   */
  async increment(key) {
    const redis = getRateLimitRedisClient();
    if (!redis) throw storeUnavailableError(new Error("Redis client unavailable"));

    const redisKey = this.fullKey(key);
    const totalHits = await redis.hincrby(redisKey, "totalHits", 1);
    if (totalHits === 1) {
      await redis.pexpire(redisKey, this.windowMs);
    }

    return { totalHits, resetTime: new Date(Date.now() + this.windowMs) };
  }

  /**
   * @param {string} key
   * @returns {Promise<void>}
   */
  async decrement(key) {
    const redis = getRateLimitRedisClient();
    if (!redis) return;
    try {
      await redis.hincrby(this.fullKey(key), "totalHits", -1);
    } catch (err) {
      rateLimitLogger.warn({ error: err.message }, "Rate limit decrement failed");
    }
  }

  /**
   * @param {string} key
   * @returns {Promise<void>}
   */
  async resetKey(key) {
    const redis = getRateLimitRedisClient();
    if (!redis) return;
    try {
      await redis.del(this.fullKey(key));
    } catch (err) {
      rateLimitLogger.warn({ error: err.message }, "Rate limit resetKey failed");
    }
  }

  /**
   * Not supported: keys are namespaced per limiter and cleared by TTL.
   *
   * @returns {Promise<void>}
   */
  async resetAll() {
    // Intentionally empty — see method docs.
  }
}

module.exports = { RedisRateLimitStore, getRateLimitRedisClient, storeUnavailableError };