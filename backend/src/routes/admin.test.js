"use strict";

/**
 * src/routes/admin.test.js
 *
 * Route-level test suite for the admin API key usage endpoint (Issue #1186).
 *
 * Regression guard: `getApiKeyUsageStats` from developerService was imported
 * by src/routes/admin.js but never wired to a route, so the admin "API Key
 * Usage" dashboard (AdminApiKeyUsage.tsx, calls GET /api/admin/api-keys/usage)
 * 404'd. This suite asserts the endpoint is mounted and delegates to the
 * service — it fails if the route is disconnected again.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../middleware/auth", () => ({
  verifyJWT: jest.fn((req, res, next) => {
    req.user = { publicKey: "GADMIN", role: "admin" };
    next();
  }),
  requireAdminRole: jest.fn((req, res, next) => next()),
  requireAdmin2FA: jest.fn((req, res, next) => next()),
}));

jest.mock("../services/jobService", () => ({
  updateJobStatus: jest.fn(),
  listJobs: jest.fn(),
}));

jest.mock("../services/contractAuditService", () => ({
  logContractInteraction: jest.fn(),
}));

jest.mock("../services/auditLogService", () => ({
  listAuditLogs: jest.fn(),
}));

jest.mock("../services/developerService", () => ({
  getApiKeyUsageStats: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const adminRoutes = require("./admin");
const { getApiKeyUsageStats } = require("../services/developerService");

const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

function usageStats(overrides = {}) {
  return {
    lookbackDays: 7,
    keys: [
      {
        id: 1,
        label: "staging-bot",
        key_prefix: "mk_live_ab12",
        requests_today: 42,
        requests_last_hour: 7,
        endpoint_breakdown: [
          {
            endpoint: "/api/public/jobs",
            requests: 7,
            lastMinute: "2026-08-26T10:00:00.000Z",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("Admin Route Suite (/api/admin/api-keys/usage)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getApiKeyUsageStats.mockResolvedValue(usageStats());
  });

  it("200 — returns per-key usage stats from the developerService", async () => {
    const res = await request(app).get("/api/admin/api-keys/usage");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(getApiKeyUsageStats).toHaveBeenCalledWith(7);
    expect(res.body.data).toMatchObject({
      lookbackDays: 7,
      keys: [
        {
          id: 1,
          label: "staging-bot",
          requests_today: 42,
          requests_last_hour: 7,
        },
      ],
    });
  });

  it("200 — honors the days lookback query parameter", async () => {
    const res = await request(app).get("/api/admin/api-keys/usage?days=30");

    expect(res.status).toBe(200);
    expect(getApiKeyUsageStats).toHaveBeenCalledWith(30);
  });

  it("500 — forwards service errors to the error handler", async () => {
    getApiKeyUsageStats.mockRejectedValue(new Error("usage stats exploded"));

    const res = await request(app).get("/api/admin/api-keys/usage");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "usage stats exploded",
      code: "INTERNAL_ERROR",
    });
  });
});
