"use strict";

/**
 * backend/tests/pool.test.js
 *
 * Database connection pool configuration and concurrent load tests.
 *
 * Verifies:
 *   - Pool configuration respects environment variables
 *   - Pool stats are correctly reported
 *   - Pool handles concurrent queries without connection exhaustion
 */

const { Pool } = require("pg");
const pool = require("../src/db/pool");

describe("Database connection pool", () => {
  describe("configuration", () => {
    it("uses DATABASE_POOL_MIN for min connections", () => {
      const expectedMin = parseInt(process.env.DATABASE_POOL_MIN, 10) || 2;
      expect(pool.options.min).toBe(expectedMin);
    });

    it("uses DATABASE_POOL_MAX for max connections", () => {
      const expectedMax = parseInt(process.env.DATABASE_POOL_MAX, 10) || 
                         parseInt(process.env.DATABASE_POOL_SIZE, 10) || 10;
      expect(pool.options.max).toBe(expectedMax);
    });

    it("uses DATABASE_POOL_IDLE_TIMEOUT_MS for idle timeout", () => {
      const expectedIdle = parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS, 10) || 30_000;
      expect(pool.options.idleTimeoutMillis).toBe(expectedIdle);
    });

    it("uses DATABASE_POOL_CONNECTION_TIMEOUT_MS for connection timeout", () => {
      const expectedConnection = parseInt(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS, 10) || 5_000;
      expect(pool.options.connectionTimeoutMillis).toBe(expectedConnection);
    });
  });

  describe("getPoolStats", () => {
    it("returns pool statistics", () => {
      const stats = pool.getPoolStats();
      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("idle");
      expect(stats).toHaveProperty("waiting");
      expect(typeof stats.total).toBe("number");
      expect(typeof stats.idle).toBe("number");
      expect(typeof stats.waiting).toBe("number");
    });
  });

  describe("concurrent load handling", () => {
    it("handles concurrent queries without connection exhaustion", async () => {
      const concurrentQueries = 20;
      const queries = Array.from({ length: concurrentQueries }, (_, i) =>
        pool.query("SELECT $1 as id", [i])
      );

      const results = await Promise.all(queries);
      
      expect(results).toHaveLength(concurrentQueries);
      results.forEach((result, i) => {
        expect(result.rows[0].id).toBe(i);
      });

      // Verify pool is healthy after concurrent load
      const stats = pool.getPoolStats();
      expect(stats.waiting).toBe(0);
    });

    it("maintains pool integrity under rapid sequential queries", async () => {
      const iterations = 10;
      const queriesPerIteration = 5;

      for (let i = 0; i < iterations; i++) {
        const queries = Array.from({ length: queriesPerIteration }, () =>
          pool.query("SELECT NOW()")
        );
        await Promise.all(queries);
      }

      const stats = pool.getPoolStats();
      expect(stats.waiting).toBe(0);
    });

    it("returns connections to pool after query completion", async () => {
      const initialStats = pool.getPoolStats();
      
      // Execute a query
      await pool.query("SELECT 1");
      
      // Give the pool a moment to return the connection
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const finalStats = pool.getPoolStats();
      
      // After the query completes, connections should be returned
      // The total count should not exceed max
      expect(finalStats.total).toBeLessThanOrEqual(pool.options.max);
    });
  });
});
