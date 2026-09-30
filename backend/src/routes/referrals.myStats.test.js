"use strict";

/**
 * src/routes/referrals.myStats.test.js — Issue #1559
 * GET /api/referrals/my-stats
 */

jest.mock("../db/pool", () => ({ query: jest.fn(), connect: jest.fn() }));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");
const referralRoutes = require("./referrals");

const app = express();
app.use(express.json());
app.use("/api/referrals", referralRoutes);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const USER = "G" + "A".repeat(55);
const REFEREE = "G" + "B".repeat(55);
const token = jwt.sign({ publicKey: USER, role: "user" }, JWT_SECRET, { expiresIn: "1h" });

const summaryRow = {
  total_referred: "3",
  registered: "1",
  first_job_completed: "1",
  credit_paid: "1",
  paid_credits_xlm: "2.0000000",
  pending_credits_xlm: "3.5000000",
};

function pipelineRow(overrides = {}) {
  return {
    id: "ref-1",
    referee_address: REFEREE,
    referee_display_name: "Bob",
    status: "pending",
    payout_amount: null,
    paid_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    paid_job_title: null,
    first_job_id: "job-1",
    first_job_title: "Logo design",
    first_released_xlm: "100.0000000",
    first_job_completed_at: "2026-02-01T00:00:00.000Z",
    active_escrow_xlm: null,
    pipeline_status: "first_job_completed",
    ...overrides,
  };
}

describe("GET /api/referrals/my-stats", () => {
  beforeEach(() => jest.clearAllMocks());

  it("401 — requires authentication", async () => {
    const res = await request(app).get("/api/referrals/my-stats");
    expect(res.status).toBe(401);
  });

  it("200 — returns totals, credits, link and a paginated referee table", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [summaryRow] })
      .mockResolvedValueOnce({ rows: [pipelineRow()] });

    const res = await request(app)
      .get("/api/referrals/my-stats?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.totalReferred).toBe(3);
    expect(d.pendingCreditsXlm).toBe("3.5000000");
    expect(d.paidCreditsXlm).toBe("2.0000000");
    expect(d.referralLink).toMatch(new RegExp(`\\?ref=${USER}$`));
    expect(d.pipeline).toEqual({ registered: 1, firstJobCompleted: 1, creditPaid: 1 });
    expect(d.pagination).toEqual({ page: 1, limit: 10, total: 3, totalPages: 1 });
    expect(d.referees[0]).toMatchObject({
      refereeAddress: REFEREE,
      status: "first_job_completed",
      firstJobTitle: "Logo design",
      creditXlm: "2.0000000", // 2% of 100 XLM
    });

    // The caller's key comes from the JWT, never from the query string
    expect(pool.query.mock.calls[0][1][0]).toBe(USER);
  });

  it("filters by pipeline status and paginates with LIMIT/OFFSET", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [summaryRow] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get("/api/referrals/my-stats?page=2&limit=5&status=credit_paid")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/WHERE pipeline_status = \$2/);
    expect(params).toEqual([USER, "credit_paid", 5, 5]);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it("caps the page size at 50", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [summaryRow] })
      .mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get("/api/referrals/my-stats?limit=500")
      .set("Authorization", `Bearer ${token}`);

    expect(pool.query.mock.calls[1][1]).toEqual([USER, 50, 0]);
  });

  it("400 — rejects unknown status filters", async () => {
    const res = await request(app)
      .get("/api/referrals/my-stats?status=bogus")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
