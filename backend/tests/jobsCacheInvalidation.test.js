/**
 * backend/tests/jobsCacheInvalidation.test.js
 *
 * Issue #852: after POST /api/jobs succeeds, the GET /api/jobs list cache
 * must be invalidated so the new job shows up on the next listing request
 * instead of a stale cached page.
 *
 * Mounts the real jobs router in a minimal Express app (rather than booting
 * the full server) so the test stays focused on the route behavior and
 * doesn't depend on unrelated subsystems (WebSocket, GraphQL, indexer, ...).
 */
"use strict";

jest.mock("../src/db/pool", () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  const mockPool = {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    }),
  };
  // jobService destructures `{ readPool, writePool }` from this module.
  mockPool.readPool = mockPool;
  mockPool.writePool = mockPool;
  return mockPool;
});

// In-memory stand-in for the Redis-backed cache so the test can observe real
// hit/miss/invalidate behavior without needing a live Redis instance.
// jobs.js imports this directly (not services/cacheService, which now just
// delegates to it — see #774/#973), so this is the module that must be mocked.
jest.mock("../src/utils/cache", () => {
  const store = new Map();
  const actual = jest.requireActual("../src/utils/cache");
  return {
    __store: store,
    jobListKey: actual.jobListKey,
    TTL: actual.TTL,
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key) => {
      store.delete(key);
    }),
    delPattern: jest.fn(async (pattern) => {
      const prefix = pattern.replace(/\*$/, "");
      for (const key of Array.from(store.keys())) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    }),
    invalidateJobListCache: jest.fn(async () => {
      const prefix = "jobs:list:";
      for (const key of Array.from(store.keys())) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    }),
  };
});

// ─── Imports ─────────────────────────────────────────────────────────────────

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const { structuredErrorHandler } = require("../src/utils/errors");
const jobRoutes = require("../src/routes/jobs");
const pool = require("../src/db/pool");
const cache = require("../src/utils/cache");

const app = express();
app.use(express.json());
app.use("/api/jobs", jobRoutes);
app.use(structuredErrorHandler);

// ─── Test constants ───────────────────────────────────────────────────────────

const FAKE_CLIENT_KEY = "G" + "B".repeat(55);
const FAKE_JOB_ID = "11111111-1111-1111-1111-111111111111";

function buildJobRow(overrides = {}) {
  return {
    id: FAKE_JOB_ID,
    title: "Build a Smart Contract on Stellar Network",
    description:
      "Looking for an experienced developer to build a dApp on Stellar with Soroban contracts.",
    budget: 500,
    currency: "XLM",
    category: "Smart Contracts",
    skills: [],
    status: "open",
    client_address: FAKE_CLIENT_KEY,
    freelancer_address: null,
    escrow_contract_id: null,
    applicant_count: 0,
    share_count: 0,
    boosted: false,
    boosted_until: null,
    deadline: null,
    timezone: null,
    screening_questions: [],
    milestones: [],
    visibility: "public",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const VALID_TOKEN = jwt.sign(
  { publicKey: FAKE_CLIENT_KEY },
  process.env.JWT_SECRET,
  { expiresIn: "1h" }
);

const VALID_JOB_BODY = {
  clientAddress: FAKE_CLIENT_KEY,
  title: "Build a Soroban Smart Contract",
  description:
    "Looking for an experienced Stellar developer to build Soroban contracts for a DeFi project.",
  budget: 500,
  currency: "XLM",
  category: "Smart Contracts",
};

describe("Job list cache invalidation on create (#852)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.__store.clear();
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes("INSERT INTO jobs")) {
        return { rows: [buildJobRow()] };
      }
      if (sql.includes("FROM jobs") && sql.includes("ORDER BY")) {
        return { rows: [buildJobRow()] };
      }
      return { rows: [] };
    });
  });

  it("serves the second identical GET /api/jobs from cache", async () => {
    const first = await request(app).get("/api/jobs");
    expect(first.status).toBe(200);
    expect(first.headers["x-cache"]).toBe("MISS");

    const second = await request(app).get("/api/jobs");
    expect(second.status).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
  });

  it("invalidates the jobs list cache after a successful POST /api/jobs", async () => {
    // Warm the cache.
    const warm = await request(app).get("/api/jobs");
    expect(warm.headers["x-cache"]).toBe("MISS");
    const cached = await request(app).get("/api/jobs");
    expect(cached.headers["x-cache"]).toBe("HIT");

    const created = await request(app)
      .post("/api/jobs")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send(VALID_JOB_BODY);

    expect(created.status).toBe(201);
    expect(cache.delPattern).toHaveBeenCalledWith("jobs:list:*");

    // The next listing request must miss the (now-cleared) cache and hit the
    // DB again, which is what makes the newly created job show up.
    const afterCreate = await request(app).get("/api/jobs");
    expect(afterCreate.status).toBe(200);
    expect(afterCreate.headers["x-cache"]).toBe("MISS");
  });

  it("does not invalidate the cache when job creation fails", async () => {
    const warm = await request(app).get("/api/jobs");
    expect(warm.headers["x-cache"]).toBe("MISS");
    await request(app).get("/api/jobs");

    const rejected = await request(app)
      .post("/api/jobs")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ ...VALID_JOB_BODY, title: "Short" }); // < 10 chars → 400

    expect(rejected.status).toBe(400);
    expect(cache.delPattern).not.toHaveBeenCalled();

    const stillCached = await request(app).get("/api/jobs");
    expect(stillCached.headers["x-cache"]).toBe("HIT");
  });
});
