/**
 * src/services/statsService.test.js
 *
 * Unit tests for statsService — Issue #232 perf (V57).
 *
 * Covers:
 *  - getStats()          → reads from platform_stats_mv; cold-start fallback
 *  - computeStats()      → issues REFRESH MATERIALIZED VIEW CONCURRENTLY
 *  - scheduleStatsRefresh() → sets up a recurring interval (unref-ed)
 *  - getJobTrends()      → passes correct parameterised query
 *  - getEscrowTrends()   → passes correct parameterised query
 *  - getTopCategories()  → passes correct limit parameter
 *
 * The DB pool is fully mocked so no real Postgres connection is needed.
 */
"use strict";

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

const pool = require("../db/pool");

// Load service under test AFTER mock is in place
const {
  computeStats,
  getStats,
  getJobTrends,
  getEscrowTrends,
  getTopCategories,
  scheduleStatsRefresh,
  STATS_REFRESH_INTERVAL_MS,
} = require("./statsService");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Canonical MV row returned by the DB mock. */
const MV_ROW = {
  total_jobs: "142",
  total_clients: "30",
  total_freelancers: "80",
  active_users: "95",
  total_escrow_xlm: "7500.0000000",
  avg_job_budget: "350.0000000",
  completion_rate: "72.50",
  refreshed_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── STATS_REFRESH_INTERVAL_MS ────────────────────────────────────────────────

describe("STATS_REFRESH_INTERVAL_MS", () => {
  it("is exactly 5 minutes", () => {
    expect(STATS_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});

// ── computeStats() ────────────────────────────────────────────────────────────

describe("computeStats()", () => {
  it("issues REFRESH MATERIALIZED VIEW CONCURRENTLY then reads the MV", async () => {
    // First call: REFRESH (returns no rows)
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      // Second call: SELECT * FROM platform_stats_mv
      .mockResolvedValueOnce({ rows: [MV_ROW] });

    const result = await computeStats();

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      "REFRESH MATERIALIZED VIEW CONCURRENTLY platform_stats_mv"
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      "SELECT * FROM platform_stats_mv LIMIT 1"
    );
    expect(result).toEqual(MV_ROW);
  });

  it("returns null when MV is empty after refresh", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })  // REFRESH
      .mockResolvedValueOnce({ rows: [] }); // SELECT (empty)

    const result = await computeStats();
    expect(result).toBeNull();
  });

  it("propagates DB errors", async () => {
    pool.query.mockRejectedValueOnce(new Error("DB down"));
    await expect(computeStats()).rejects.toThrow("DB down");
  });
});

// ── getStats() ────────────────────────────────────────────────────────────────

describe("getStats()", () => {
  it("returns MV data when the view has rows (hot path)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MV_ROW] });

    const result = await getStats();

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      "SELECT * FROM platform_stats_mv LIMIT 1"
    );
    expect(result).toEqual(MV_ROW);
  });

  it("falls back to computeStats() when MV is empty (cold start)", async () => {
    // First call: SELECT → empty (MV not yet populated)
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      // Inside computeStats — REFRESH
      .mockResolvedValueOnce({ rows: [] })
      // Inside computeStats — SELECT after refresh
      .mockResolvedValueOnce({ rows: [MV_ROW] });

    const result = await getStats();

    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(result).toEqual(MV_ROW);
  });

  it("propagates errors from the initial SELECT", async () => {
    pool.query.mockRejectedValueOnce(new Error("connection refused"));
    await expect(getStats()).rejects.toThrow("connection refused");
  });
});

// ── scheduleStatsRefresh() ────────────────────────────────────────────────────

describe("scheduleStatsRefresh()", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("returns a timer handle", () => {
    pool.query.mockResolvedValue({ rows: [] });
    const handle = scheduleStatsRefresh();
    expect(handle).toBeDefined();
    clearInterval(handle);
  });

  it("fires REFRESH after each interval", async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const handle = scheduleStatsRefresh();

    // No calls yet
    expect(pool.query).not.toHaveBeenCalled();

    // Advance time by one interval
    jest.advanceTimersByTime(STATS_REFRESH_INTERVAL_MS);
    // Let the microtask queue drain
    await Promise.resolve();

    expect(pool.query).toHaveBeenCalledWith(
      "REFRESH MATERIALIZED VIEW CONCURRENTLY platform_stats_mv"
    );

    clearInterval(handle);
  });

  it("does not crash the process when REFRESH fails", async () => {
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    pool.query.mockRejectedValue(new Error("timeout"));

    const handle = scheduleStatsRefresh();
    jest.advanceTimersByTime(STATS_REFRESH_INTERVAL_MS);
    await Promise.resolve();

    // Error is logged, not thrown
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[statsService]"),
      expect.stringContaining("timeout")
    );

    consoleErrorSpy.mockRestore();
    clearInterval(handle);
  });
});

// ── getJobTrends() ────────────────────────────────────────────────────────────

describe("getJobTrends()", () => {
  it("queries with the specified days interval and respects deleted_at filter", async () => {
    const rows = [{ date: "2026-09-22", jobs_posted: "5", avg_budget: "300" }];
    pool.query.mockResolvedValueOnce({ rows });

    const result = await getJobTrends(30);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(params).toEqual(["30 days"]);
    expect(result).toEqual(rows);
  });

  it("defaults to 90 days when no argument is supplied", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await getJobTrends();
    expect(pool.query.mock.calls[0][1]).toEqual(["90 days"]);
  });
});

// ── getEscrowTrends() ────────────────────────────────────────────────────────

describe("getEscrowTrends()", () => {
  it("queries escrows with the specified days interval", async () => {
    const rows = [{ date: "2026-09-22", escrow_count: "3", total_amount: "900" }];
    pool.query.mockResolvedValueOnce({ rows });

    const result = await getEscrowTrends(14);

    const [, params] = pool.query.mock.calls[0];
    expect(params).toEqual(["14 days"]);
    expect(result).toEqual(rows);
  });
});

// ── getTopCategories() ────────────────────────────────────────────────────────

describe("getTopCategories()", () => {
  it("passes the limit parameter and filters soft-deleted jobs", async () => {
    const rows = [{ category: "Smart Contracts", job_count: "42", avg_budget: "600" }];
    pool.query.mockResolvedValueOnce({ rows });

    const result = await getTopCategories(5);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(params).toEqual([5]);
    expect(result).toEqual(rows);
  });

  it("defaults to limit 10", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await getTopCategories();
    expect(pool.query.mock.calls[0][1]).toEqual([10]);
  });
});

// ── Index existence (migration V57 guard) ─────────────────────────────────────
// These are documentation-only checks that validate the service queries the
// right SQL names — the actual index creation is verified by running the
// migration against a live DB.

describe("Migration V57 SQL contracts", () => {
  it("MV name used in service matches migration", () => {
    // Inspect the module source to ensure the literal string matches
    const src = require("fs").readFileSync(__filename.replace(".test.js", ".js"), "utf8");
    expect(src).toContain("platform_stats_mv");
  });

  it("idx_jobs_status is created in the up migration", () => {
    const path = require("path");
    const upSql = require("fs").readFileSync(
      path.resolve(
        __dirname,
        "../db/migrations/V57__stats_indexes_and_mv.up.sql"
      ),
      "utf8"
    );
    expect(upSql).toContain("idx_jobs_status");
    expect(upSql).toContain("idx_applications_status");
    expect(upSql).toContain("idx_escrows_status");
    expect(upSql).toContain("platform_stats_mv");
    expect(upSql).toContain("platform_stats_mv_singleton_idx");
  });

  it("down migration drops all objects created in the up migration", () => {
    const path = require("path");
    const downSql = require("fs").readFileSync(
      path.resolve(
        __dirname,
        "../db/migrations/V57__stats_indexes_and_mv.down.sql"
      ),
      "utf8"
    );
    expect(downSql).toContain("DROP MATERIALIZED VIEW IF EXISTS platform_stats_mv");
    expect(downSql).toContain("idx_jobs_status");
    expect(downSql).toContain("idx_applications_status");
    expect(downSql).toContain("idx_escrows_status");
  });
});
