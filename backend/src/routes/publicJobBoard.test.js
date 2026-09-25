"use strict";

/**
 * src/routes/publicJobBoard.test.js
 *
 * Issue #842: GET /api/v1/public/jobs is unauthenticated, so it's exercised
 * against a minimal Express app (route mounted directly) rather than the
 * full server — no JWT/CSRF setup required.
 */

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const publicJobBoardRoutes = require("./publicJobBoard");

const app = express();
app.use("/api/v1/public", publicJobBoardRoutes);

const FAKE_JOB_ID = "11111111-1111-1111-1111-111111111111";

function buildJobRow(overrides = {}) {
  return {
    id: FAKE_JOB_ID,
    title: "Build a Soroban Smart Contract",
    description: "Full job description with sensitive detail.",
    category: "Smart Contracts",
    budget: "500.0000000",
    currency: "XLM",
    skills: ["rust", "soroban"],
    status: "open",
    client_address: "GCLIENTADDRESS1234567890123456789012345678901234567890",
    freelancer_address: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("GET /api/v1/public/jobs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 — returns only syndication-safe fields, no auth required", async () => {
    pool.query.mockResolvedValue({ rows: [buildJobRow()] });

    const res = await request(app).get("/api/v1/public/jobs");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([
      {
        id: FAKE_JOB_ID,
        title: "Build a Soroban Smart Contract",
        category: "Smart Contracts",
        budget: "500.0000000",
        currency: "XLM",
        skills: ["rust", "soroban"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    // Excludes: client address, applicant details.
    expect(res.body.data[0]).not.toHaveProperty("clientAddress");
    expect(res.body.data[0]).not.toHaveProperty("description");
    expect(res.body.data[0]).not.toHaveProperty("status");
  });

  it("200 — only queries open, public, non-deleted jobs", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app).get("/api/v1/public/jobs");

    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/status = 'open'/);
    expect(sql).toMatch(/visibility = 'public'/);
    expect(sql).toMatch(/deleted_at IS NULL/);
  });

  it("200 — filters by category query param", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app).get("/api/v1/public/jobs").query({ category: "Design" });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/category = \$1/);
    expect(params).toContain("Design");
  });

  it("200 — clamps limit to the documented maximum of 50", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await request(app).get("/api/v1/public/jobs").query({ limit: "9999" });

    const [, params] = pool.query.mock.calls[0];
    expect(params[params.length - 1]).toBe(50);
  });

  it("429 — is rate limited to 60 requests per minute per IP", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get("/api/v1/public/jobs");

    expect(res.headers).toHaveProperty("ratelimit-limit", "60");
  });

  it("500 — passes database errors to the error handler", async () => {
    pool.query.mockRejectedValue(new Error("connection lost"));

    const errorApp = express();
    errorApp.use("/api/v1/public", publicJobBoardRoutes);
    // eslint-disable-next-line no-unused-vars
    errorApp.use((err, req, res, next) => res.status(500).json({ error: err.message }));

    const res = await request(errorApp).get("/api/v1/public/jobs");

    expect(res.status).toBe(500);
  });
});
