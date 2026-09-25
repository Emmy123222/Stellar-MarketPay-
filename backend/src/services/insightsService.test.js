"use strict";

const fs = require("fs");
const path = require("path");

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

const pool = require("../db/pool");
const insightsService = require("./insightsService");

describe("insightsService Suite (Issue #1450)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getFreelancerEarnings()", () => {
    const mockRows = [
      {
        freelancer_id: "GA111222333",
        month: "2026-08",
        released_at: "2026-08-15T12:00:00.000Z",
        earnings_count: "4",
      },
      {
        freelancer_id: "GA111222333",
        month: "2026-09",
        released_at: "2026-09-01T10:00:00.000Z",
        earnings_count: "6",
      },
    ];

    it("queries escrow_releases and maps monthly earnings breakdown with freelancerId", async () => {
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const results = await insightsService.getFreelancerEarnings("GA111222333", { months: 6 });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];

      // Query must target escrow_releases
      expect(sql).toContain("FROM escrow_releases");
      // Must include released_at in SELECT list for index-only scan (Issue #1450)
      expect(sql).toContain("released_at");
      expect(sql).toContain("freelancer_id");
      expect(sql).toContain("DATE_TRUNC('month', released_at)");
      expect(sql).toContain("GROUP BY freelancer_id, DATE_TRUNC('month', released_at), released_at");

      expect(params).toEqual(["GA111222333", 6]);

      expect(results).toEqual([
        {
          freelancerId: "GA111222333",
          month: "2026-08",
          releasedAt: "2026-08-15T12:00:00.000Z",
          earningsCount: 4,
        },
        {
          freelancerId: "GA111222333",
          month: "2026-09",
          releasedAt: "2026-09-01T10:00:00.000Z",
          earningsCount: 6,
        },
      ]);
    });

    it("defaults to 12 months when months is unspecified or invalid", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await insightsService.getFreelancerEarnings("GA111222333", { months: "invalid" });

      const [, params] = pool.query.mock.calls[0];
      expect(params).toEqual(["GA111222333", 12]);
    });

    it("queries across all freelancers when freelancerId is null/omitted", async () => {
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const results = await insightsService.getFreelancerEarnings();

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];

      expect(sql).toContain("FROM escrow_releases");
      expect(sql).toContain("released_at");
      expect(params).toEqual([null, 12]);
      expect(results.length).toBe(2);
    });

    it("exports FREELANCER_EARNINGS_QUERY with required index-only scan columns", () => {
      expect(typeof insightsService.FREELANCER_EARNINGS_QUERY).toBe("string");
      const q = insightsService.FREELANCER_EARNINGS_QUERY;
      expect(q).toContain("freelancer_id");
      expect(q).toContain("released_at");
      expect(q).toContain("escrow_releases");
      expect(q).toContain("GROUP BY freelancer_id, DATE_TRUNC('month', released_at), released_at");
    });
  });

  describe("Migration V58 Verification (Issue #1450)", () => {
    const migrationsDir = path.join(__dirname, "../db/migrations");
    const upFile = path.join(migrationsDir, "V58__idx_escrow_freelancer_date.up.sql");
    const downFile = path.join(migrationsDir, "V58__idx_escrow_freelancer_date.down.sql");
    const schemaFile = path.join(__dirname, "../db/schema.sql");

    it("has V58__idx_escrow_freelancer_date.up.sql creating the composite index", () => {
      expect(fs.existsSync(upFile)).toBe(true);
      const sql = fs.readFileSync(upFile, "utf8");

      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_escrow_freelancer_date");
      expect(sql).toContain("ON escrow_releases(freelancer_id, released_at)");
      expect(sql).toContain("ALTER TABLE escrow_releases");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS freelancer_id");
    });

    it("has V58__idx_escrow_freelancer_date.down.sql rolling back index and column", () => {
      expect(fs.existsSync(downFile)).toBe(true);
      const sql = fs.readFileSync(downFile, "utf8");

      expect(sql).toContain("DROP INDEX IF EXISTS idx_escrow_freelancer_date");
      expect(sql).toContain("ALTER TABLE escrow_releases DROP COLUMN IF EXISTS freelancer_id");
    });

    it("schema.sql includes escrow_releases table and idx_escrow_freelancer_date index", () => {
      expect(fs.existsSync(schemaFile)).toBe(true);
      const sql = fs.readFileSync(schemaFile, "utf8");

      expect(sql).toContain("CREATE TABLE IF NOT EXISTS escrow_releases");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_escrow_freelancer_date");
      expect(sql).toContain("ON escrow_releases(freelancer_id, released_at)");
    });
  });
});
