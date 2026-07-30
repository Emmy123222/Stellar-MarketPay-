/**
 * src/tests/integration/cacheIntegration.test.js
 *
 * Integration tests for Redis caching on hot read endpoints (Issue #774).
 *
 * Verifies:
 *  - GET /api/jobs returns X-Cache: MISS on first request and X-Cache: HIT on second request.
 *  - Different query params produce separate cache keys (both MISS).
 *  - GET /api/stats returns X-Cache: MISS then X-Cache: HIT.
 *  - POST /api/jobs invalidates the job list cache.
 *  - PATCH /api/jobs/:id invalidates the job list cache.
 *
 * Uses jest.mock to mock cacheService so no live Redis is required.
 */
"use strict";

// ─── Mock the cache utility so tests don't need a live Redis ─────────────────
const store = new Map();

jest.mock("../../utils/cache", () => {
  const store = new Map();
  return {
    get: jest.fn(async (key) => store.get(key) ?? null),
    set: jest.fn(async (key, value) => { store.set(key, value); }),
    del: jest.fn(async (key) => { store.delete(key); }),
    delPattern: jest.fn(async (pattern) => {
      const prefix = pattern.replace("*", "");
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) store.delete(k);
      }
    }),
    jobListKey: jest.fn((params = {}) => {
      const sorted = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .sort(([a], [b]) => a.localeCompare(b));
      return `jobs:list:${new URLSearchParams(sorted).toString()}`;
    }),
    invalidateJobListCache: jest.fn(async () => {
      const prefix = "jobs:list:";
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) store.delete(k);
      }
    }),
    TTL: { JOBS_LIST: 30, STATS: 60, PROFILE: 300 },
    getClient: jest.fn(() => null),
    __store: store,
  };
});

// ─── Mock heavy service dependencies ─────────────────────────────────────────

jest.mock("../../services/statsService", () => ({
  getStats: jest.fn(async () => ({
    totalJobs: 42,
    openJobs: 10,
    completedJobs: 30,
  })),
  getJobTrends: jest.fn(async () => []),
  getEscrowTrends: jest.fn(async () => []),
  getTopCategories: jest.fn(async () => []),
}));

jest.mock("../../services/xlmPriceService", () => ({
  getXlmUsd7dHistory: jest.fn(async () => []),
  PRICE_HISTORY_TTL_SECONDS: 300,
}));

jest.mock("../../services/jobService", () => ({
  listJobs: jest.fn(async () => ({ jobs: [], nextCursor: null })),
  createJob: jest.fn(async (data) => ({ id: "job-123", ...data })),
  getJob: jest.fn(async (id) => ({ id })),
  updateJobStatus: jest.fn(async (id, status) => ({ id, status })),
  listJobsByClient: jest.fn(async () => []),
  updateJobEscrowId: jest.fn(async (id) => ({ id })),
  boostJob: jest.fn(async (id) => ({ id })),
  extendJobExpiry: jest.fn(async (id) => ({ id })),
  deleteJob: jest.fn(async () => undefined),
  raiseDispute: jest.fn(async (id) => ({ id })),
  resolveDispute: jest.fn(async (id) => ({ id })),
  getRecommendedJobs: jest.fn(async () => []),
  incrementViewCount: jest.fn(async () => 1),
  incrementShareCount: jest.fn(async () => undefined),
  getSuggestions: jest.fn(async () => []),
  getJobAnalytics: jest.fn(async (id) => ({ id })),
  bulkCancelJobs: jest.fn(async () => []),
  bulkExtendJobs: jest.fn(async () => []),
  bulkBoostJobs: jest.fn(async () => []),
  getCategoryAnalytics: jest.fn(async () => []),
  getAnalyticsOverview: jest.fn(async () => ({})),
}));

jest.mock("../../services/profileService", () => ({
  getClientReputation: jest.fn(async () => ({ score: 5 })),
}));

jest.mock("../../middleware/auth", () => ({
  verifyJWT: (req, _res, next) => {
    req.user = { publicKey: "G" + "A".repeat(55) };
    next();
  },
}));

jest.mock("../../services/jobDraftService", () => ({
  saveDraft: jest.fn(async (key, body) => ({ id: "draft-1", ...body })),
  listDrafts: jest.fn(async () => []),
  getDraft: jest.fn(async () => null),
  deleteDraft: jest.fn(async () => undefined),
}));

jest.mock("../../services/recommendationService", () => ({
  getRecommendations: jest.fn(async () => []),
  buildJobTfIdfVector: jest.fn(async () => ({})),
  updateVocabularyAndIdf: jest.fn(async () => undefined),
}));

jest.mock("../../services/contractAuditService", () => ({
  logContractInteraction: jest.fn(async () => undefined),
}));

jest.mock("../../services/notificationService", () => ({
  createJobNotification: jest.fn(async () => undefined),
  EVENT_TYPES: { DISPUTE_OPENED: "dispute_opened" },
}));

jest.mock("../../services/developerService", () => ({
  recordApiKeyUsageMinute: jest.fn(async () => undefined),
}));

jest.mock("../../middleware/jsonbValidator", () => ({
  validateJsonb: () => (_req, _res, next) => next(),
}));

jest.mock("../../schemas/milestones.schema", () => ({}));

jest.mock("../../services/cacheService", () => require("../../utils/cache"));

// ─── Now load the app ─────────────────────────────────────────────────────────
const request = require("supertest");

let app;
let cache;

beforeAll(() => {
  app = require("../../server");
  cache = require("../../utils/cache");
});

beforeEach(() => {
  jest.clearAllMocks();
  // Reset mock store between tests
  if (cache.__store) cache.__store.clear();
});

// =============================================================================
// GET /api/jobs — cache HIT / MISS
// =============================================================================
describe("GET /api/jobs — Redis caching", () => {
  it("returns X-Cache: MISS on first request and X-Cache: HIT on second request", async () => {
    // First request — should be a MISS
    const first = await request(app).get("/api/jobs");
    expect(first.status).toBe(200);
    expect(first.headers["x-cache"]).toBe("MISS");

    // Second request — same params, should be a HIT
    const second = await request(app).get("/api/jobs");
    expect(second.status).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
  });

  it("returns X-Cache: MISS for different query parameters (distinct cache keys)", async () => {
    const first = await request(app).get("/api/jobs?category=DevOps");
    expect(first.status).toBe(200);
    expect(first.headers["x-cache"]).toBe("MISS");

    const second = await request(app).get("/api/jobs?category=Frontend+Development");
    expect(second.status).toBe(200);
    expect(second.headers["x-cache"]).toBe("MISS");
  });

  it("caches using deterministic key regardless of query param order", async () => {
    const first = await request(app).get("/api/jobs?status=open&limit=10");
    expect(first.headers["x-cache"]).toBe("MISS");

    const second = await request(app).get("/api/jobs?limit=10&status=open");
    expect(second.headers["x-cache"]).toBe("HIT");
  });
});

// =============================================================================
// GET /api/stats — cache HIT / MISS
// =============================================================================
describe("GET /api/stats — Redis caching", () => {
  it("returns X-Cache: MISS on first request and X-Cache: HIT on second request", async () => {
    const first = await request(app).get("/api/stats");
    expect(first.status).toBe(200);
    expect(first.headers["x-cache"]).toBe("MISS");

    const second = await request(app).get("/api/stats");
    expect(second.status).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
  });

  it("returns stats data in the response body", async () => {
    const res = await request(app).get("/api/stats");
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

// =============================================================================
// POST /api/jobs — cache invalidation
// =============================================================================
describe("POST /api/jobs — cache invalidation", () => {
  const CLIENT_KEY = "G" + "A".repeat(55);

  it("invalidates the job list cache after creating a job", async () => {
    // Warm the cache
    const warm = await request(app).get("/api/jobs");
    expect(warm.headers["x-cache"]).toBe("MISS");

    const warmHit = await request(app).get("/api/jobs");
    expect(warmHit.headers["x-cache"]).toBe("HIT");

    // Create a job — should trigger invalidation
    const create = await request(app)
      .post("/api/jobs")
      .set("Authorization", `Bearer test-token`)
      .send({
        title: "Test Job For Cache Invalidation",
        description: "Testing that POST /api/jobs clears the cache",
        budget: 100,
        category: "Backend Development",
        clientAddress: CLIENT_KEY,
      });
    expect(create.status).toBe(201);
    expect(cache.invalidateJobListCache).toHaveBeenCalledTimes(1);

    // Next GET should be a MISS again (cache was cleared)
    const afterCreate = await request(app).get("/api/jobs");
    expect(afterCreate.headers["x-cache"]).toBe("MISS");
  });
});

// =============================================================================
// PATCH /api/jobs/:id — cache invalidation
// =============================================================================
describe("PATCH /api/jobs/:id — cache invalidation", () => {
  it("invalidates the job list cache when updating a job", async () => {
    // Warm cache
    const warm = await request(app).get("/api/jobs");
    expect(warm.headers["x-cache"]).toBe("MISS");

    const warmHit = await request(app).get("/api/jobs");
    expect(warmHit.headers["x-cache"]).toBe("HIT");

    // Update job — should invalidate
    const patch = await request(app)
      .patch("/api/jobs/job-123")
      .set("Authorization", "Bearer test-token")
      .send({ status: "in_progress" });
    expect(patch.status).toBe(200);
    expect(cache.invalidateJobListCache).toHaveBeenCalledTimes(1);

    // Cache should be cleared
    const afterPatch = await request(app).get("/api/jobs");
    expect(afterPatch.headers["x-cache"]).toBe("MISS");
  });
});
