/**
 * src/routes/health.js
 *
 * Health check endpoint for readiness probes (Docker / Kubernetes).
 *
 * GET /health
 *   - Checks PostgreSQL (SELECT 1, 2 s timeout)
 *   - Checks Redis (PING, 2 s timeout)
 *   - Checks Stellar Horizon (/ledgers?limit=1, 2 s timeout)
 *   - Returns 200 when all dependencies are healthy
 *   - Returns 503 when any dependency is down
 *
 * Response shape:
 *   {
 *     "status": "ok" | "degraded",
 *     "postgres": "up" | "down",
 *     "redis": "up" | "down",
 *     "horizon": "up" | "down"
 *   }
 */
"use strict";

const express = require("express");
const pool = require("../db/pool");
const { getPoolStats } = require("../db/pool");
const cacheService = require("../services/cacheService");
const { createRateLimiter } = require("../middleware/rateLimiter");

const router = express.Router();
const healthRateLimiter = createRateLimiter(120, 1);

const CHECK_TIMEOUT_MS = 2000;

/**
 * Run SELECT 1 against PostgreSQL with a hard timeout.
 * @returns {Promise<'up'|'down'>}
 */
async function checkPostgres() {
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Postgres check timed out")), CHECK_TIMEOUT_MS),
      ),
    ]);
    return "up";
  } catch {
    return "down";
  }
}

/**
 * Ping Redis with a hard timeout.
 * @returns {Promise<'up'|'down'>}
 */
async function checkRedis() {
  try {
    const result = await Promise.race([
      cacheService.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Redis check timed out")), CHECK_TIMEOUT_MS),
      ),
    ]);
    return result; // already "up" or "down" from cacheService.ping()
  } catch {
    return "down";
  }
}

/**
 * Ping Stellar Horizon /ledgers?limit=1 with a hard timeout.
 * @returns {Promise<'up'|'down'>}
 */
async function checkHorizon() {
  const horizonUrl =
    process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(`${horizonUrl}/ledgers?limit=1&order=desc`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return "down";

    const data = await res.json();
    const ledger = data?._embedded?.records?.[0]?.sequence ?? null;
    return ledger != null ? "up" : "down";
  } catch {
    return "down";
  }
}

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     description: >
 *       Checks PostgreSQL, Redis, and Stellar Horizon connectivity.
 *       Returns 200 when all deps are healthy, 503 when any is down.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: All dependencies healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 postgres:
 *                   type: string
 *                   example: up
 *                 redis:
 *                   type: string
 *                   example: up
 *                 horizon:
 *                   type: string
 *                   example: up
 *       503:
 *         description: One or more dependencies are down
 */
router.get("/", healthRateLimiter, async (req, res) => {
  const [postgres, redis, horizon] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkHorizon(),
  ]);

  const allUp = postgres === "up" && redis === "up" && horizon === "up";

  const body = {
    status: allUp ? "ok" : "degraded",
    postgres,
    redis,
    horizon,
  };

  res.status(allUp ? 200 : 503).json(body);
});

// GET /health/db — pool connection stats for monitoring
router.get("/db", healthRateLimiter, async (req, res) => {
  const stats = getPoolStats();
  res.json({
    status: "ok",
    pool: stats,
    pool_size: parseInt(process.env.DATABASE_POOL_SIZE, 10) || 10,
  });
});

module.exports = router;
