"use strict";

/**
 * src/routes/insights.test.js
 *
 * Route-level test suite for /api/insights endpoints (Issue #1144).
 * Covers, per endpoint:
 *   - Happy path with a valid payload (GET routes; the endpoints accept no
 *     request body, so "valid payload" means valid query parameters)
 *   - Query-parameter validation / sanitisation: limit is clamped to 50,
 *     days is clamped to 90, non-numeric values fall back to the defaults
 *   - Guard behaviour: the endpoints are public (no JWT guard), so the rate
 *     limiter is the only guard — verified via the rate-limit response
 *     headers and a real 429 block on a burst of requests
 *   - Not-found path for unknown sub-routes (the routes take no ids)
 *
 * The DB pool is replaced with the shared pgMock (required transitively by
 * the rate-limiter middleware); the insights service is mocked at module
 * level so each endpoint's wiring is asserted deterministically.
 */

process.env.RATE_LIMIT_SCALE = process.env.RATE_LIMIT_SCALE || "1000";

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/insightsService", () => ({
  getPlatformSummary: jest.fn(),
  getCategoryInsights: jest.fn(),
  getClientMix: jest.fn(),
  getSkillInsights: jest.fn(),
  getCompetitiveJobs: jest.fn(),
  getPayTrends: jest.fn(),
}));

const pool = require("../db/pool");
const insightsService = require("../services/insightsService");
const express = require("express");
const request = require("supertest");
const insightsRoutes = require("./insights");

// Minimal Express test application
const app = express();
app.use("/api/insights", insightsRoutes);

// Structured error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

describe("Insights Route Suite (/api/insights)", () => {
  const originalRateLimitScale = process.env.RATE_LIMIT_SCALE;

  afterAll(() => {
    // Restore any env override so it never leaks into suites sharing this worker.
    if (originalRateLimitScale === undefined) {
      delete process.env.RATE_LIMIT_SCALE;
    } else {
      process.env.RATE_LIMIT_SCALE = originalRateLimitScale;
    }
  });

  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // GET /api/insights — platform analytics summary
  // =========================================================================
  describe("GET /api/insights", () => {
    it("200 — returns the platform analytics summary", async () => {
      const summary = {
        totalJobs: 42,
        totalTransacted: "1234.0000000",
        activeFreelancers: 7,
        avgDaysToHire: 3.5,
        byCategory: [{ category: "Smart Contracts", count: 10 }],
        byCurrency: [{ currency: "XLM", count: 42, total: "1234.0000000" }],
        byMonth: [{ month: "2026-08", count: 5 }],
      };
      insightsService.getPlatformSummary.mockResolvedValue(summary);

      const res = await request(app).get("/api/insights");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(summary);
      expect(insightsService.getPlatformSummary).toHaveBeenCalledTimes(1);
    });

    it("200 — is public (no auth required) but guarded by the rate limiter headers", async () => {
      insightsService.getPlatformSummary.mockResolvedValue({});

      const res = await request(app).get("/api/insights");

      expect(res.status).toBe(200);
      expect(Number(res.headers["ratelimit-limit"])).toBeGreaterThanOrEqual(30);
    });
  });

  // =========================================================================
  // GET /api/insights/categories — category insights + client mix
  // =========================================================================
  describe("GET /api/insights/categories", () => {
    it("200 — returns category insights and client mix", async () => {
      insightsService.getCategoryInsights.mockResolvedValue([
        { category: "Smart Contracts", totalJobs: 10, avgBudget: 500 },
      ]);
      insightsService.getClientMix.mockResolvedValue({
        newClients: 2,
        returningClients: 3,
        totalClients: 5,
      });

      const res = await request(app).get("/api/insights/categories");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.categories).toEqual([
        { category: "Smart Contracts", totalJobs: 10, avgBudget: 500 },
      ]);
      expect(res.body.data.clientMix).toEqual({
        newClients: 2,
        returningClients: 3,
        totalClients: 5,
      });
      expect(insightsService.getCategoryInsights).toHaveBeenCalledWith(20);
      expect(insightsService.getClientMix).toHaveBeenCalledTimes(1);
    });

    it("200 — clamps a large limit down to the documented maximum of 50", async () => {
      insightsService.getCategoryInsights.mockResolvedValue([]);
      insightsService.getClientMix.mockResolvedValue({});

      const res = await request(app)
        .get("/api/insights/categories")
        .query({ limit: "9999" });

      expect(res.status).toBe(200);
      expect(insightsService.getCategoryInsights).toHaveBeenCalledWith(50);
    });

    it("200 — falls back to the default limit for a non-numeric limit", async () => {
      insightsService.getCategoryInsights.mockResolvedValue([]);
      insightsService.getClientMix.mockResolvedValue({});

      const res = await request(app)
        .get("/api/insights/categories")
        .query({ limit: "abc" });

      expect(res.status).toBe(200);
      expect(insightsService.getCategoryInsights).toHaveBeenCalledWith(20);
    });
  });

  // =========================================================================
  // GET /api/insights/skills — skill demand insights
  // =========================================================================
  describe("GET /api/insights/skills", () => {
    it("200 — returns skill insights", async () => {
      insightsService.getSkillInsights.mockResolvedValue([
        { skill: "Rust", demandCount: 12, avgApplicationsPerJob: 3.4 },
      ]);

      const res = await request(app).get("/api/insights/skills");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([
        { skill: "Rust", demandCount: 12, avgApplicationsPerJob: 3.4 },
      ]);
      expect(insightsService.getSkillInsights).toHaveBeenCalledWith(20);
    });

    it("200 — clamps a large limit down to 50", async () => {
      insightsService.getSkillInsights.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/insights/skills")
        .query({ limit: "500" });

      expect(res.status).toBe(200);
      expect(insightsService.getSkillInsights).toHaveBeenCalledWith(50);
    });
  });

  // =========================================================================
  // GET /api/insights/competitive — competitive job listings
  // =========================================================================
  describe("GET /api/insights/competitive", () => {
    it("200 — returns competitive job listings", async () => {
      insightsService.getCompetitiveJobs.mockResolvedValue([
        {
          id: "job-1",
          title: "Soroban Auditor",
          competitionLevel: "light",
          applicationCount: 2,
        },
      ]);

      const res = await request(app).get("/api/insights/competitive");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([
        {
          id: "job-1",
          title: "Soroban Auditor",
          competitionLevel: "light",
          applicationCount: 2,
        },
      ]);
      expect(insightsService.getCompetitiveJobs).toHaveBeenCalledWith(20);
    });
  });

  // =========================================================================
  // GET /api/insights/trends/pay — pay trends over time
  // =========================================================================
  describe("GET /api/insights/trends/pay", () => {
    it("200 — returns pay trend data", async () => {
      insightsService.getPayTrends.mockResolvedValue([
        { date: "2026-08-01", category: "Smart Contracts", avgBudget: 500 },
      ]);

      const res = await request(app).get("/api/insights/trends/pay");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([
        { date: "2026-08-01", category: "Smart Contracts", avgBudget: 500 },
      ]);
      expect(insightsService.getPayTrends).toHaveBeenCalledWith(30);
    });

    it("200 — clamps a large days window down to 90", async () => {
      insightsService.getPayTrends.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/insights/trends/pay")
        .query({ days: "999" });

      expect(res.status).toBe(200);
      expect(insightsService.getPayTrends).toHaveBeenCalledWith(90);
    });

    it("200 — falls back to the default window for a non-numeric days value", async () => {
      insightsService.getPayTrends.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/insights/trends/pay")
        .query({ days: "abc" });

      expect(res.status).toBe(200);
      expect(insightsService.getPayTrends).toHaveBeenCalledWith(30);
    });
  });

  // =========================================================================
  // Guard: the insights rate limiter (the endpoints are otherwise public)
  // =========================================================================
  describe("Rate-limit guard", () => {
    it("429 — blocks a burst of requests via the shared insights rate limiter", async () => {
      const originalScale = process.env.RATE_LIMIT_SCALE;
      process.env.RATE_LIMIT_SCALE = "1";

      // Re-require the route module so a fresh limiter instance is created
      // with the unscaled 30 req/min ceiling, scoped to this test only.
      jest.resetModules();
      const freshInsightsRoutes = require("./insights");

      const limitedApp = express();
      limitedApp.use("/api/insights", freshInsightsRoutes);
      // eslint-disable-next-line no-unused-vars
      limitedApp.use((err, req, res, next) => {
        const status = err.statusCode || err.status || 500;
        res.status(status).json({ error: err.message });
      });

      let last;
      for (let i = 0; i < 31; i += 1) {
        last = await request(limitedApp).get("/api/insights");
      }

      expect(last.status).toBe(429);
      expect(last.body.message).toMatch(/Too many requests/i);

      process.env.RATE_LIMIT_SCALE = originalScale;
    });
  });

  // =========================================================================
  // Error passthrough + not-found paths
  // =========================================================================
  describe("Error handling", () => {
    it("500 — passes service errors to the error handler", async () => {
      insightsService.getPlatformSummary.mockRejectedValue(
        new Error("analytics backend unavailable"),
      );

      const res = await request(app).get("/api/insights");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("analytics backend unavailable");
    });

    it("404 — unknown sub-route under /api/insights", async () => {
      const res = await request(app).get("/api/insights/does-not-exist");

      expect(res.status).toBe(404);
    });
  });
});
