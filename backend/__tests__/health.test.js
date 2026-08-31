/**
 * __tests__/health.test.js
 *
 * Unit tests for the health check endpoint.
 * Tests each dependency failure scenario and the all-healthy case.
 */
"use strict";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPoolQuery = jest.fn();
jest.mock("../src/db/pool", () => ({
  query: (...args) => mockPoolQuery(...args),
  getPoolStats: jest.fn(() => ({ total: 5, idle: 3, waiting: 0 })),
}));

const mockRedisPing = jest.fn();
jest.mock("../src/services/cacheService", () => ({
  ping: () => mockRedisPing(),
  get: jest.fn(),
  set: jest.fn(),
}));

// Mock fetch for Horizon checks
const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

afterAll(() => {
  delete global.fetch;
});

jest.mock("../src/middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

// ─── Test helpers ────────────────────────────────────────────────────────────

const request = require("supertest");
const express = require("express");

function createApp() {
  const app = express();
  const healthRoutes = require("../src/routes/health");
  app.use("/api/health", healthRoutes);
  return app;
}

function mockPostgresUp() {
  mockPoolQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
}

function mockPostgresDown() {
  mockPoolQuery.mockRejectedValue(new Error("connection refused"));
}

function mockRedisUp() {
  mockRedisPing.mockResolvedValue("up");
}

function mockRedisDown() {
  mockRedisPing.mockResolvedValue("down");
}

function mockHorizonUp() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      _embedded: { records: [{ sequence: 12345678 }] },
    }),
  });
}

function mockHorizonDown() {
  mockFetch.mockRejectedValue(new Error("Network error"));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("all healthy", () => {
    beforeEach(() => {
      mockPostgresUp();
      mockRedisUp();
      mockHorizonUp();
    });

    it("returns 200 with status healthy and all deps up", async () => {
      const app = createApp();
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: "healthy",
        database: "up",
        redis: "up",
        stellar: "up",
      });
      expect(res.body).toHaveProperty("uptime_seconds");
      expect(res.body).toHaveProperty("version");
    });
  });

  describe("postgres down", () => {
    beforeEach(() => {
      mockPostgresDown();
      mockRedisUp();
      mockHorizonUp();
    });

    it("returns 503 with status degraded and database down", async () => {
      const app = createApp();
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        status: "degraded",
        database: "down",
        redis: "up",
        stellar: "up",
      });
    });
  });

  describe("redis down", () => {
    beforeEach(() => {
      mockPostgresUp();
      mockRedisDown();
      mockHorizonUp();
    });

    it("returns 503 with status degraded and redis down", async () => {
      const app = createApp();
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        status: "degraded",
        database: "up",
        redis: "down",
        stellar: "up",
      });
    });
  });

  describe("horizon down", () => {
    beforeEach(() => {
      mockPostgresUp();
      mockRedisUp();
      mockHorizonDown();
    });

    it("returns 503 with status degraded and stellar down", async () => {
      const app = createApp();
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        status: "degraded",
        database: "up",
        redis: "up",
        stellar: "down",
      });
    });
  });

  describe("multiple deps down", () => {
    beforeEach(() => {
      mockPostgresDown();
      mockRedisDown();
      mockHorizonUp();
    });

    it("returns 503 with status degraded and correct deps marked down", async () => {
      const app = createApp();
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        status: "degraded",
        database: "down",
        redis: "down",
        stellar: "up",
      });
    });
  });
});
