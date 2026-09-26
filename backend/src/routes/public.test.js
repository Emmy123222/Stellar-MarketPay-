"use strict";

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("../middleware/apiKey", () => ({
  requireApiKey: (req, res, next) => next(),
}));

jest.mock("../middleware/apiKeyRateLimiter", () => ({
  apiKeyRateLimiter: () => (req, res, next) => next(),
}));

const express = require("express");
const request = require("supertest");
const pool = require("../db/pool");
const publicRoutes = require("./public");

const app = express();
app.use("/api/public", publicRoutes);

describe("GET /api/public/jobs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("200 — excludes application metadata and client PII from the public listing", async () => {
    const job = {
      id: "job-public-1",
      title: "Build a Soroban marketplace",
      description: "Need an experienced Soroban developer.",
      category: "Smart Contracts",
      budget: "2500.0000000",
      currency: "XLM",
      skills: ["rust", "soroban"],
      status: "open",
      deadline: "2026-12-31T00:00:00.000Z",
      timezone: "UTC",
      applications: [
        { freelancerName: "Alice", proposal: "I can build this quickly." },
      ],
      client_email: "client@example.com",
      client_wallet: "GCLIENTWALLET123",
      client_address: "GCLIENTADDRESS123",
      freelancer_address: "GFREELANCER123",
      created_at: "2026-01-10T00:00:00.000Z",
      updated_at: "2026-01-11T00:00:00.000Z",
    };
    pool.query.mockResolvedValue({ rows: [job] });

    const res = await request(app).get("/api/public/jobs");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [
        {
          id: "job-public-1",
          title: "Build a Soroban marketplace",
          description: "Need an experienced Soroban developer.",
          budget: "2500.0000000",
          currency: "XLM",
          category: "Smart Contracts",
          skills: ["rust", "soroban"],
          status: "open",
          deadline: "2026-12-31T00:00:00.000Z",
          timezone: "UTC",
          created_at: job.created_at,
          updated_at: job.updated_at,
        },
      ],
    });

    expect(res.body.data[0]).not.toHaveProperty("applications");
    expect(res.body.data[0]).not.toHaveProperty("client_email");
    expect(res.body.data[0]).not.toHaveProperty("client_wallet");
    expect(res.body.data[0]).not.toHaveProperty("client_address");
    expect(res.body.data[0]).not.toHaveProperty("freelancer_address");

    const [sql] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/\bapplications\b/i);
    expect(sql).not.toMatch(/\bclient_email\b/i);
    expect(sql).not.toMatch(/\bclient_wallet\b/i);
    expect(sql).not.toMatch(/\bclient_address\b/i);
    expect(sql).not.toMatch(/\bfreelancer_address\b/i);
  });
});
