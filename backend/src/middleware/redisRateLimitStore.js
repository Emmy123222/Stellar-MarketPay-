"use strict";

const Redis = require("ioredis");

class RedisRateLimitStore {
  constructor({ prefix = "", redisClient } = {}) {
    this.prefix = prefix;
    this.windowMs = 60 * 1000;
    this.localStore = new Map();

    if (redisClient) {
      this.client = redisClient;
    } else if (process.env.REDIS_URL) {
      try {
        this.client = new Redis(process.env.REDIS_URL, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
      } catch {
        this.client = null;
      }
    } else {
      this.client = null;
    }
  }

  init(options) {
    this.windowMs = Number(options?.windowMs) || this.windowMs;
  }

  async increment(key) {
    const fullKey = `${this.prefix}${key}`;
    const ttlSeconds = Math.ceil(this.windowMs / 1000);

    if (this.client && this.client.status === "ready") {
      try {
        const results = await this.client
          .multi()
          .incr(fullKey)
          .expire(fullKey, ttlSeconds, "NX")
          .ttl(fullKey)
          .exec();

        const totalHits = results[0][1];
        const remainingTtl = results[2][1] > 0 ? results[2][1] : ttlSeconds;
        return {
          totalHits,
          resetTime: new Date(Date.now() + remainingTtl * 1000),
        };
      } catch {
        // Fall back to memory store on redis failure
      }
    }

    const now = Date.now();
    let record = this.localStore.get(fullKey);
    if (!record || record.expiresAt <= now) {
      record = { totalHits: 0, expiresAt: now + this.windowMs };
    }
    record.totalHits += 1;
    this.localStore.set(fullKey, record);

    return {
      totalHits: record.totalHits,
      resetTime: new Date(record.expiresAt),
    };
  }

  async decrement(key) {
    const fullKey = `${this.prefix}${key}`;
    if (this.client && this.client.status === "ready") {
      try {
        await this.client.decr(fullKey);
        return;
      } catch {
        // Fall back
      }
    }

    const record = this.localStore.get(fullKey);
    if (!record) return;
    if (record.totalHits <= 1) {
      this.localStore.delete(fullKey);
    } else {
      record.totalHits -= 1;
      this.localStore.set(fullKey, record);
    }
  }

  async resetKey(key) {
    const fullKey = `${this.prefix}${key}`;
    if (this.client && this.client.status === "ready") {
      try {
        await this.client.del(fullKey);
      } catch {
        // Fall back
      }
    }
    this.localStore.delete(fullKey);
  }
}

module.exports = { RedisRateLimitStore };
