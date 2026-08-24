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
 *     "status": "healthy" | "degraded",
 *     "database": { "status": "ok", "latency_ms": 12 }
 *                | { "status": "error", "message": "..." },
 *     "stellar":  { "status": "ok", "network": "testnet", "ledger": 12345678 }
 *                | { "status": "error", "message": "..." },
 *     "uptime_seconds": 3600,
 *     "version": "1.0.0",
 *     "migrationVersion": 21
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

// Process start time and build version, reported by GET /api/health.
const SERVER_START = Date.now();
const VERSION = require("../../package.json").version;

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
 *                   example: healthy
 *                 database:
 *                   type: object
 *                   properties:
 *                     status: { type: string, example: ok }
 *                     latency_ms: { type: number, example: 12 }
 *                 stellar:
 *                   type: object
 *                   properties:
 *                     status: { type: string, example: ok }
 *                     network: { type: string, example: testnet }
 *                     ledger: { type: number, example: 12345678 }
 *                 uptime_seconds: { type: number, example: 3600 }
 *                 version: { type: string, example: "1.0.0" }
 *                 migrationVersion:
 *                   type: integer
 *                   nullable: true
 *                   example: 21
 *                   description: Current schema_migrations version from the database
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
    status: allUp ? "healthy" : "degraded",
    database: postgres,
    redis,
    stellar: horizon,
    uptime_seconds: Math.floor((Date.now() - SERVER_START) / 1000),
    version: VERSION,
    indexer: req.app.locals.indexerService
      ? req.app.locals.indexerService.getHealth()
      : null,
    migrationVersion: req.app.locals.migrationVersion ?? null,
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
