/**
 * Unit tests for GET /api/contributors — Issue #844
 *
 * Tests: score computation, badge assignment, caching, empty states,
 *        GitHub-to-profile matching via github_username and display_name,
 *        rate limiting, edge cases.
 */
"use strict";

const request = require("supertest");

// ─── Mocks must be hoisted before requiring the server ─────────────────────
jest.mock("../db/pool", () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  return {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    }),
  };
});

// Mock axios so tests control GitHub API responses.
jest.mock("axios", () => ({
  default: { create: jest.fn() },
  get: jest.fn(),
}));
const axios = require("axios");

// Mock stellar-sdk to avoid its axios dependency chain and network calls.
jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: jest.fn(),
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  Keypair: { fromSecret: jest.fn(), fromPublicKey: jest.fn() },
  TransactionBuilder: jest.fn(),
  Account: jest.fn(),
  Contract: jest.fn(),
  nativeToScVal: jest.fn(),
  scValToNative: jest.fn(),
  Address: jest.fn(),
  rpc: { Server: jest.fn() },
  xdr: {},
  Utils: { readChallengeTx: jest.fn(), verifyChallengeTxSigners: jest.fn() },
  SorobanRpc: { Server: jest.fn() },
}));

jest.mock("../services/indexerService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() })),
);
jest.mock("../services/priceAlertService", () => ({
  PriceAlertService: jest.fn().mockImplementation(() => ({ start: jest.fn() })),
}));
jest.mock("../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../routes/notifications", () => {
  const { Router } = require("express");
  const router = Router();
  router.get("/", (req, res) => res.json({ success: true }));
  return router;
});

const pool = require("../db/pool");
const { fetchCsrf, applyCsrf } = require("../testUtils/csrfTestHelpers");
const app = require("../server");

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Factory for mock GitHub API response records */
function ghUser(overrides = {}) {
  return {
    login: overrides.login || "testuser",
    avatar_url:
      overrides.avatar_url || "https://avatars.githubusercontent.com/u/1",
    html_url: `https://github.com/${overrides.login || "testuser"}`,
    contributions: overrides.contributions ?? 5,
    id: overrides.id ?? 1,
    ...overrides,
  };
}

/** Factory for mock DB profile rows */
function profile(overrides = {}) {
  return {
    public_key:
      overrides.public_key ||
      "GABCDEF1234567890123456789012345678901234567890123",
    display_name: overrides.display_name || null,
    github_username: overrides.github_username || null,
    completed_jobs: overrides.completed_jobs ?? 0,
    total_earned_xlm: overrides.total_earned_xlm ?? "0.0000000",
    ...overrides,
  };
}

/** Utility: score = (jobs × 10) + floor(xlm / 100) + (prs × 5) */
function computeScore(jobs, xlm, prs) {
  return jobs * 10 + Math.floor(Number(xlm) / 100) + prs * 5;
}

// ─── Suite ─────────────────────────────────────────────────────────────────

describe("GET /api/contributors", () => {
  // Monotonically advance fake time by 25 h each test so the module-scoped
  // contributorCache (1 h TTL) and GitHub sub-cache (24 h TTL) are always
  // stale at the start of every test.  Within a single test Date.now()
  // returns the same value, so the caching-behaviour test still works.
  let fakeTime;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeTime = (fakeTime ?? Date.now()) + 25 * 60 * 60 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(fakeTime);
    pool.query.mockResolvedValue({ rows: [] });
    pool.connect.mockResolvedValue({
      query: pool.query,
      release: jest.fn(),
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    axios.get.mockResolvedValue({ data: [] });
    pool.query.mockResolvedValue({ rows: [] });
    await applyCsrf(
      request(app).post("/api/contributors/refresh"),
      await fetchCsrf(app),
    );
  });

  // ── Score computation ─────────────────────────────────────────────────

  describe("score computation", () => {
    it("computes the correct contribution score for a mixed profile", async () => {
      axios.get.mockResolvedValue({
        data: [ghUser({ login: "alice", contributions: 10 })],
      });
      pool.query.mockResolvedValue({
        rows: [
          profile({
            public_key: "GALICE...",
            display_name: "alice",
            completed_jobs: 3,
            total_earned_xlm: "5000.0000000",
          }),
        ],
      });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);

      const expectedScore = computeScore(3, 5000, 10); // 30 + 50 + 50 = 130
      expect(res.body.data[0].score).toBe(expectedScore);
      expect(res.body.data[0].name).toBe("alice");
      expect(res.body.data[0].jobs_completed).toBe(3);
      expect(res.body.data[0].xlm_transacted).toBe(5000);
      expect(res.body.data[0].github_prs).toBe(10);
    });

    it("handles zero jobs and zero XLM for GitHub-only contributor", async () => {
      axios.get.mockResolvedValue({
        data: [ghUser({ login: "octocat", contributions: 20, id: 99 })],
      });
      pool.query.mockResolvedValue({ rows: [] });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);

      // Only PRs contribute: 20 × 5 = 100
      const entry = res.body.data.find((c) => c.name === "octocat");
      expect(entry).toBeDefined();
      expect(entry.score).toBe(100);
      expect(entry.jobs_completed).toBe(0);
      expect(entry.xlm_transacted).toBe(0);
      expect(entry.github_prs).toBe(20);
      expect(entry.public_key).toBeNull();
    });

    it("filters out profiles with zero total score", async () => {
      axios.get.mockResolvedValue({ data: [] });
      pool.query.mockResolvedValue({
        rows: [
          profile({
            public_key: "GZERO...",
            display_name: "zero",
            completed_jobs: 0,
            total_earned_xlm: "0.0000000",
          }),
        ],
      });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ── Badge assignment ──────────────────────────────────────────────────

  describe("badge assignment", () => {
    it("assigns Gold to top 3, Silver to 4-10, Bronze to 11-50", async () => {
      // Create 12 mock GitHub users + matching profiles with descending scores
      const ghUsers = [];
      const dbProfiles = [];
      for (let i = 1; i <= 12; i++) {
        const login = `user${i}`;
        ghUsers.push(ghUser({ login, contributions: 13 - i, id: i }));
        dbProfiles.push(
          profile({
            public_key: `G${login.toUpperCase()}....`,
            display_name: login,
            completed_jobs: 13 - i,
            total_earned_xlm: "0.0000000",
          }),
        );
      }

      axios.get.mockResolvedValue({ data: ghUsers });
      pool.query.mockResolvedValue({ rows: dbProfiles });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);

      expect(res.body.data[0].badge).toBe("Gold");
      expect(res.body.data[1].badge).toBe("Gold");
      expect(res.body.data[2].badge).toBe("Gold");
      expect(res.body.data[3].badge).toBe("Silver");
      expect(res.body.data[4].badge).toBe("Silver");
      expect(res.body.data[9].badge).toBe("Silver");
      expect(res.body.data[10].badge).toBe("Bronze");
      expect(res.body.data[11].badge).toBe("Bronze");
    });

    it("returns correct rank numbers", async () => {
      axios.get.mockResolvedValue({
        data: [ghUser({ login: "first", contributions: 10, id: 1 })],
      });
      pool.query.mockResolvedValue({
        rows: [
          profile({
            public_key: "GFIRST...",
            display_name: "first",
            completed_jobs: 10,
            total_earned_xlm: "0.0000000",
          }),
        ],
      });

      const res = await request(app).get("/api/contributors");
      expect(res.body.data[0].rank).toBe(1);
    });
  });

  // ── Matching (github_username vs display_name) ────────────────────────

  describe("GitHub-to-profile matching", () => {
    it("prefers github_username over display_name for matching", async () => {
      axios.get.mockResolvedValue({
        data: [ghUser({ login: "github-dev", contributions: 15, id: 42 })],
      });
      pool.query.mockResolvedValue({
        rows: [
          profile({
            public_key: "GMATCHED...",
            display_name: "Different Name",
            github_username: "github-dev",
            completed_jobs: 5,
            total_earned_xlm: "1000.0000000",
          }),
        ],
      });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);
      const entry = res.body.data[0];
      expect(entry.name).toBe("Different Name");
      expect(entry.github_prs).toBe(15);
      expect(entry.score).toBe(computeScore(5, 1000, 15)); // 50 + 10 + 75 = 135
    });

    it("falls back to display_name when github_username is null", async () => {
      axios.get.mockResolvedValue({
        data: [ghUser({ login: "bob-dev", contributions: 8, id: 7 })],
      });
      pool.query.mockResolvedValue({
        rows: [
          profile({
            public_key: "GBOB...",
            display_name: "bob-dev",
            github_username: null,
            completed_jobs: 2,
            total_earned_xlm: "200.0000000",
          }),
        ],
      });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);
      const entry = res.body.data[0];
      expect(entry.github_prs).toBe(8);
      expect(entry.score).toBe(computeScore(2, 200, 8)); // 20 + 2 + 40 = 62
    });

    it("does not double-count a GitHub user matched by both username and display_name", async () => {
      axios.get.mockResolvedValue({
        data: [ghUser({ login: "unique-dev", contributions: 10, id: 1 })],
      });
      pool.query.mockResolvedValue({
        rows: [
          profile({
            public_key: "GUNIQUE...",
            display_name: "unique-dev",
            github_username: "unique-dev",
            completed_jobs: 1,
            total_earned_xlm: "0.0000000",
          }),
        ],
      });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);
      // Should only appear once
      const matches = res.body.data.filter((c) => c.name === "unique-dev");
      expect(matches).toHaveLength(1);
    });
  });

  // ── Caching ───────────────────────────────────────────────────────────

  describe("caching behaviour", () => {
    it("returns cached data on subsequent calls within TTL", async () => {
      axios.get.mockResolvedValue({
        data: [ghUser({ login: "cached-user", contributions: 3, id: 1 })],
      });
      pool.query.mockResolvedValue({
        rows: [
          profile({
            public_key: "GCACHED...",
            display_name: "cached-user",
            completed_jobs: 1,
            total_earned_xlm: "0.0000000",
          }),
        ],
      });

      // First call populates cache
      const first = await request(app).get("/api/contributors");
      expect(first.status).toBe(200);
      const firstCallCount = axios.get.mock.calls.length;

      // Second call should hit cache (no additional GitHub/DB calls)
      const second = await request(app).get("/api/contributors");
      expect(second.status).toBe(200);
      expect(axios.get.mock.calls.length).toBe(firstCallCount); // no new GitHub calls
      expect(second.body.data).toEqual(first.body.data);
    });
  });

  // ── Empty states ──────────────────────────────────────────────────────

  describe("empty states", () => {
    it("returns empty array when no GitHub contributors and no profiles", async () => {
      axios.get.mockResolvedValue({ data: [] });
      pool.query.mockResolvedValue({ rows: [] });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("returns empty array when all profiles have zero score", async () => {
      axios.get.mockResolvedValue({ data: [] });
      pool.query.mockResolvedValue({
        rows: [
          profile({
            public_key: "GLOW...",
            display_name: "low",
            completed_jobs: 0,
            total_earned_xlm: "50.0000000",
          }),
        ],
      });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns the correct JSON envelope and fields for each contributor", async () => {
      axios.get.mockResolvedValue({
        data: [ghUser({ login: "alice", contributions: 7, id: 1 })],
      });
      pool.query.mockResolvedValue({
        rows: [
          profile({
            public_key: "GALICE...",
            display_name: "alice",
            completed_jobs: 4,
            total_earned_xlm: "3000.0000000",
          }),
        ],
      });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: expect.any(Array),
      });

      const entry = res.body.data[0];
      expect(entry).toMatchObject({
        public_key: "GALICE...",
        name: "alice",
        avatar_url: expect.any(String),
        profile_url: expect.any(String),
        score: expect.any(Number),
        jobs_completed: 4,
        xlm_transacted: 3000,
        github_prs: 7,
        badge: "Gold",
        rank: 1,
      });
    });
  });

  // ── Error handling ───────────────────────────────────────────────────

  describe("error handling", () => {
    it("handles GitHub API failure gracefully (falls back to cache or empty)", async () => {
      axios.get.mockRejectedValue(new Error("GitHub API down"));
      pool.query.mockResolvedValue({
        rows: [
          profile({
            public_key: "GERR...",
            display_name: "offline",
            completed_jobs: 2,
            total_earned_xlm: "0.0000000",
          }),
        ],
      });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);
      // Should still include platform-only contributor
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].github_prs).toBe(0);
    });

    it("handles database failure gracefully", async () => {
      axios.get.mockResolvedValue({ data: [] });
      pool.query.mockRejectedValue(new Error("DB connection failed"));

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(500);
    });
  });

  // ── Top 50 limit ──────────────────────────────────────────────────────

  describe("top 50 limit", () => {
    it("returns at most 50 contributors", async () => {
      const ghUsers = [];
      const dbProfiles = [];
      for (let i = 1; i <= 60; i++) {
        const login = `contrib${i}`;
        ghUsers.push(ghUser({ login, contributions: 1, id: i }));
        dbProfiles.push(
          profile({
            public_key: `GCONTRIB${i}....`,
            display_name: login,
            completed_jobs: 1,
            total_earned_xlm: "0.0000000",
          }),
        );
      }

      axios.get.mockResolvedValue({ data: ghUsers });
      pool.query.mockResolvedValue({ rows: dbProfiles });

      const res = await request(app).get("/api/contributors");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(50);
    });
  });
});

describe("POST /api/contributors/refresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    pool.connect.mockResolvedValue({
      query: pool.query,
      release: jest.fn(),
    });
  });

  it("refreshes cache and returns fresh data", async () => {
    axios.get.mockResolvedValue({
      data: [ghUser({ login: "refreshed", contributions: 5, id: 1 })],
    });
    pool.query.mockResolvedValue({
      rows: [
        profile({
          public_key: "GREFRESH...",
          display_name: "refreshed",
          completed_jobs: 2,
          total_earned_xlm: "0.0000000",
        }),
      ],
    });

    const res = await applyCsrf(request(app).post("/api/contributors/refresh"), await fetchCsrf(app));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Cache refreshed");
    expect(res.body.data).toHaveLength(1);
  });
});
