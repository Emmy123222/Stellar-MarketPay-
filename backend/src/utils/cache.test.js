"use strict";

/**
 * Cache key namespacing (issue #1399): a job and a profile that share the same
 * numeric ID must not overwrite each other in the cache.
 *
 * Runs the real utils/cache.js against an in-memory stand-in for Redis.
 */

jest.mock("ioredis", () => {
  const store = new Map();
  class FakeRedis {
    on() {}
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    }
    async setex(key, ttl, value) {
      store.set(key, value);
    }
    async del(...keys) {
      keys.forEach((k) => store.delete(k));
    }
    async scan(cursor, _match, pattern) {
      const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      return ["0", [...store.keys()].filter((k) => re.test(k))];
    }
  }
  FakeRedis.__store = store;
  return FakeRedis;
});

const Redis = require("ioredis");
const cache = require("./cache");
const cacheService = require("../services/cacheService");

beforeEach(() => {
  Redis.__store.clear();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("entity cache keys", () => {
  it("prefixes keys with the entity type", () => {
    expect(cache.jobKey(42)).toBe("job:42");
    expect(cache.profileKey(42)).toBe("profile:42");
    expect(cache.escrowKey("ABC")).toBe("escrow:ABC");
    expect(cache.entityKey("job", "42")).toBe("job:42");
  });

  it("keeps the existing profile:<publicKey> format", () => {
    expect(cacheService.profileKey("GABC123")).toBe("profile:GABC123");
  });

  it("is exposed through cacheService as well", () => {
    expect(cacheService.jobKey(7)).toBe("job:7");
    expect(cacheService.escrowKey("XYZ")).toBe("escrow:XYZ");
  });

  it("rejects unknown entity types and empty ids", () => {
    expect(() => cache.entityKey("widget", 1)).toThrow(TypeError);
    expect(() => cache.jobKey(undefined)).toThrow(TypeError);
    expect(() => cache.profileKey("")).toThrow(TypeError);
    expect(() => cache.escrowKey(null)).toThrow(TypeError);
  });
});

describe("job 42 and profile 42 do not collide", () => {
  it("stores and returns both independently", async () => {
    await cache.set(cache.jobKey(42), { kind: "job", title: "Build a site" }, 60);
    await cache.set(cache.profileKey(42), { kind: "profile", name: "Ada" }, 60);

    expect(await cache.get(cache.jobKey(42))).toEqual({ kind: "job", title: "Build a site" });
    expect(await cache.get(cache.profileKey(42))).toEqual({ kind: "profile", name: "Ada" });
  });

  it("deleting one leaves the other in place", async () => {
    await cache.set(cache.jobKey(42), { kind: "job" }, 60);
    await cache.set(cache.profileKey(42), { kind: "profile" }, 60);

    await cache.del(cache.jobKey(42));

    expect(await cache.get(cache.jobKey(42))).toBeNull();
    expect(await cache.get(cache.profileKey(42))).toEqual({ kind: "profile" });
  });

  it("works the same through cacheService", async () => {
    await cacheService.set(cacheService.jobKey(42), { kind: "job" }, 60);
    await cacheService.set(cacheService.escrowKey(42), { kind: "escrow" }, 60);

    expect(await cacheService.get(cacheService.jobKey(42))).toEqual({ kind: "job" });
    expect(await cacheService.get(cacheService.escrowKey(42))).toEqual({ kind: "escrow" });
  });
});

describe("bare keys are refused", () => {
  it.each([[42], ["42"], [""], [null], [undefined]])("ignores set/get/del with key %p", async (key) => {
    await cache.set(key, { leaked: true }, 60);

    expect(Redis.__store.size).toBe(0);
    expect(await cache.get(key)).toBeNull();
    await expect(cache.del(key)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("does not write the rejected key into the log", async () => {
    const secretLooking = "sk_live_abc123secret";

    await cache.set(secretLooking, 1, 60);
    await cache.get(secretLooking);
    await cache.del(secretLooking);

    expect(console.warn).toHaveBeenCalledTimes(3);
    for (const call of console.warn.mock.calls) {
      expect(call.join(" ")).not.toContain(secretLooking);
    }
  });

  it("still accepts the existing namespaced keys", async () => {
    const keys = [
      "stats:overview",
      "xlm:price:usd",
      "soroban:fee:estimate",
      "recs:GABC:10",
      cache.jobListKey({ category: "dev" }),
    ];
    for (const key of keys) {
      await cache.set(key, { ok: key }, 60);
      expect(await cache.get(key)).toEqual({ ok: key });
    }
  });

  it("job list invalidation does not touch entity keys", async () => {
    await cache.set(cache.jobKey(42), { kind: "job" }, 60);
    await cache.set(cache.jobListKey({ page: 1 }), { list: true }, 60);

    await cache.invalidateJobListCache();

    expect(await cache.get(cache.jobListKey({ page: 1 }))).toBeNull();
    expect(await cache.get(cache.jobKey(42))).toEqual({ kind: "job" });
  });
});
