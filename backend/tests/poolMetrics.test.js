"use strict";

/**
 * backend/tests/poolMetrics.test.js
 *
 * Verifies that `src/db/pool.js` instruments every query with
 * `pool_query_duration_ms` without changing the pg Pool contract.
 *
 * The underlying `pg` driver is mocked so the suite runs with no database.
 */

const metrics = require("../src/metrics");

// ── Mock pg so no real connection is ever opened ─────────────────────────────
jest.mock("pg", () => {
  /** Minimal stand-in for pg.Pool. */
  class FakePool {
    constructor(options) {
      this.options = options;
      this.totalCount = 3;
      this.idleCount = 2;
      this.waitingCount = 0;
      this.listeners = {};
      this.calls = [];
    }

    on(event, handler) {
      this.listeners[event] = handler;
    }

    query(...args) {
      this.calls.push(args);
      const last = args[args.length - 1];
      const text = typeof args[0] === "string" ? args[0] : (args[0] && args[0].text) || "";

      if (text.includes("BOOM")) {
        const err = new Error("query failed");
        if (typeof last === "function") return last(err);
        return Promise.reject(err);
      }

      const result = { rows: [{ ok: 1 }], rowCount: 1 };
      if (typeof last === "function") return last(null, result);
      return Promise.resolve(result);
    }
  }
  return { Pool: FakePool };
});

const pool = require("../src/db/pool");

/**
 * Read the observed count for a pool_query_duration_ms label set.
 *
 * @param {string} operation SQL verb label
 * @param {string} status    "success" | "error"
 * @returns {Promise<number>} number of observations
 */
async function queryCount(operation, status) {
  const data = await metrics.poolQueryDurationMs.get();
  const sample = data.values.find(
    (v) =>
      v.metricName === "pool_query_duration_ms_count" &&
      v.labels.operation === operation &&
      v.labels.status === status
  );
  return sample ? sample.value : 0;
}

describe("pool query instrumentation (pool_query_duration_ms)", () => {
  it("still returns query results unchanged", async () => {
    const res = await pool.query("SELECT 1");
    expect(res.rows[0].ok).toBe(1);
    expect(res.rowCount).toBe(1);
  });

  it("records a successful SELECT under operation=select,status=success", async () => {
    const before = await queryCount("select", "success");
    await pool.query("SELECT * FROM jobs WHERE id = $1", [1]);
    const after = await queryCount("select", "success");
    expect(after).toBe(before + 1);
  });

  it("labels the SQL verb, not the full statement", async () => {
    await pool.query("UPDATE jobs SET title = $1 WHERE id = $2", ["x", 1]);
    const data = await metrics.poolQueryDurationMs.get();
    const labels = data.values.map((v) => v.labels.operation);
    expect(labels).toContain("update");
    expect(labels.every((l) => !String(l).includes("jobs"))).toBe(true);
  });

  it("records failures under status=error and still rejects", async () => {
    const before = await queryCount("select", "error");
    await expect(pool.query("SELECT BOOM")).rejects.toThrow("query failed");
    const after = await queryCount("select", "error");
    expect(after).toBe(before + 1);
  });

  it("supports the pg query-config object form", async () => {
    const before = await queryCount("insert", "success");
    await pool.query({ text: "INSERT INTO jobs (title) VALUES ($1)", values: ["t"] });
    const after = await queryCount("insert", "success");
    expect(after).toBe(before + 1);
  });

  it("supports the callback form", (done) => {
    queryCount("delete", "success").then((before) => {
      pool.query("DELETE FROM jobs WHERE id = $1", [1], (err, result) => {
        expect(err).toBeNull();
        expect(result.rowCount).toBe(1);
        queryCount("delete", "success").then((after) => {
          expect(after).toBe(before + 1);
          done();
        });
      });
    });
  });

  it("records a duration greater than zero", async () => {
    await pool.query("SELECT 1");
    const data = await metrics.poolQueryDurationMs.get();
    const sum = data.values.find((v) => v.metricName === "pool_query_duration_ms_sum");
    expect(sum.value).toBeGreaterThan(0);
  });

  it("keeps getPoolStats working", () => {
    const stats = pool.getPoolStats();
    expect(stats).toEqual({ total: 3, idle: 2, waiting: 0 });
  });

  it("populates the pool saturation gauges at scrape time", async () => {
    const output = await metrics.renderMetrics();
    expect(output).toContain("pg_pool_total 3");
    expect(output).toContain("pg_pool_idle 2");
    expect(output).toContain('marketpay_db_connections{state="total"} 3');
  });
});
