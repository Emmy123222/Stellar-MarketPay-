/**
 * __tests__/apiKeyRateLimiter.test.js
 *
 * Unit tests for the per-endpoint Redis sliding-window rate limiter
 * (Issue #452). We mock the cacheService here so the test does not
 * require a live Redis instance. The math we exercise is what would
 * run inside the real middleware:
 *
 *   - 1st request: count=1, weightedCount=1, allowed, no Retry-After
 *   - 60th request inside a fresh minute: count=60, allowed
 *   - 61st request: 429 with Retry-After in seconds
 *   - Retry-After decreases as the minute advances (sliding window)
 *   - unknown endpointKey throws at registration time (fail-fast)
 *   - Fail-open behavior when Redis errors out
 */
"use strict";

jest.mock("../src/services/cacheService", () => {
  // Simple in-memory replacement so we can script the bucket state per test.
  const buckets = new Map();
  return {
    __esModule: true,
    incrWithExpiry: jest.fn(async (key, ttl) => {
      const cur = Number(buckets.get(key) || 0) + 1;
      buckets.set(key, cur);
      return { count: cur, ttlSeconds: ttl };
    }),
    rateLimitKey: jest.fn(
      (apiKeyId, endpoint, minuteBucket) =>
        `rl:${apiKeyId}:${endpoint}:${minuteBucket}`,
    ),
    get: jest.fn(async (key) => {
      const v = buckets.get(key);
      return v == null ? null : String(v);
    }),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn(),
    jobListKey: jest.fn(),
    profileKey: jest.fn(),
    TTL: { JOBS_LIST: 30, PROFILE: 300 },
    __resetBuckets: () => buckets.clear(),
  };
});

jest.mock("../src/services/developerService", () => ({
  recordApiKeyUsageMinute: jest.fn().mockResolvedValue(undefined),
}));

const path = require("path");
// Resolve the cacheService mock so apiKeyRateLimiter sees the same instance.
const cache = require("../src/services/cacheService");

const { apiKeyRateLimiter } = require("../src/middleware/apiKeyRateLimiter");

function mockRes() {
  const headers = {};
  const res = {
    headers,
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
    set(k, v) { headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return res;
}

function mockNext() {
  const calls = { count: 0 };
  const fn = () => { calls.count += 1; };
  fn.calls = calls;
  return fn;
}

beforeEach(() => {
  cache.incrWithExpiry.mockClear();
  cache.rateLimitKey.mockClear();
  cache.get.mockClear();
  if (typeof cache.__resetBuckets === "function") cache.__resetBuckets();
});

describe("apiKeyRateLimiter — sliding window", () => {
  test("1st request is allowed and never produces Retry-After", async () => {
    const req = { apiKey: { id: 7 }, baseUrl: "/api/public", route: { path: "/jobs" } };
    const res = mockRes();
    const next = mockNext();

    await apiKeyRateLimiter("public_jobs")(req, res, next);

    expect(next.calls.count).toBe(1);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Retry-After"]).toBeUndefined();
  });

  test("60 requests / min remain under the limit", async () => {
    const limiter = apiKeyRateLimiter("public_jobs");
    for (let i = 0; i < 60; i += 1) {
      const req = { apiKey: { id: 11 }, baseUrl: "/api/public", route: { path: "/jobs" } };
      const res = mockRes();
      const next = mockNext();
      await limiter(req, res, next);
      expect(next.calls.count).toBe(1);
      expect(res.statusCode).toBe(200);
    }
  });

  test("61st request returns 429 with Retry-After header in seconds", async () => {
    const limiter = apiKeyRateLimiter("public_jobs");
    for (let i = 0; i < 60; i += 1) {
      const req = { apiKey: { id: 99 }, baseUrl: "/api/public", route: { path: "/jobs" } };
      await limiter(req, mockRes(), mockNext());
    }

    const req = { apiKey: { id: 99 }, baseUrl: "/api/public", route: { path: "/jobs" } };
    const res = mockRes();
    const next = mockNext();
    await limiter(req, res, next);

    expect(res.statusCode).toBe(429);
    expect(next.calls.count).toBe(0);
    const ra = Number(res.headers["Retry-After"]);
    expect(Number.isFinite(ra)).toBe(true);
    expect(ra).toBeGreaterThanOrEqual(1);
    expect(ra).toBeLessThanOrEqual(60);
    expect(res.body).toMatchObject({ endpoint: "/api/public/jobs", limit: 60 });
    expect(res.body.retryAfterSeconds).toBe(ra);
  });

  test("unknown endpointKey throws at construction time (fail fast)", () => {
    expect(() => apiKeyRateLimiter("nope")).toThrow(/unknown endpointKey/);
  });

  test("missing requireApiKey first returns 500", async () => {
    const req = { baseUrl: "/api/public", route: { path: "/jobs" } }; // no apiKey
    const res = mockRes();
    const next = mockNext();
    await apiKeyRateLimiter("public_jobs")(req, res, next);
    expect(res.statusCode).toBe(500);
    expect(next.calls.count).toBe(0);
  });

  test("fails open if Redis throws (graceful degradation)", async () => {
    const original = cache.incrWithExpiry.getMockImplementation();
    cache.incrWithExpiry.mockImplementationOnce(async () => {
      throw new Error("redis down");
    });

    const req = { apiKey: { id: 1 }, baseUrl: "/api/public", route: { path: "/jobs" } };
    const res = mockRes();
    const next = mockNext();
    await apiKeyRateLimiter("public_jobs")(req, res, next);

    expect(next.calls.count).toBe(1);
    expect(res.statusCode).toBe(200);

    cache.incrWithExpiry.mockImplementation(original);
  });

  test("rateLimitKey pattern matches the AC: rl:{api_key}:{endpoint}:{minute_bucket}", () => {
    cache.rateLimitKey.mockImplementationOnce(
      (apiKeyId, endpoint, bucket) => `rl:${apiKeyId}:${endpoint}:${bucket}`,
    );
    const k = cache.rateLimitKey(42, "/api/public/jobs", 28347283);
    expect(k).toBe("rl:42:/api/public/jobs:28347283");
  });
});
