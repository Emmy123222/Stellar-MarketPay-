/**
 * src/routes/health.js
 *
 * Enhanced health check endpoint for readiness probes (Kubernetes / Docker).
 *
 * GET /health
 *   - Runs SELECT 1 against the database (timeout: 2 s)
 *   - Pings Stellar Horizon /ledgers?limit=1 (timeout: 2 s)
 *   - Returns 200 when all dependencies are healthy
 *   - Returns 503 when any critical dependency is down
 *
 * Response shape:
 *   {
 *     "status": "healthy" | "degraded",
 *     "database": { "status": "ok", "latency_ms": 12 }
 *                | { "status": "error", "message": "..." },
 *     "stellar":  { "status": "ok", "network": "testnet", "ledger": 12345678 }
 *                | { "status": "error", "message": "..." },
 *     "uptime_seconds": 3600,
 *     "version": "1.0.0"
 *   }
 */
"use strict";

const express = require("express");
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const ipfsService = require("../services/ipfsService");

const router = express.Router();
// Generous limit — probes hit this frequently
const healthRateLimiter = createRateLimiter(120, 1);
const subscribeRateLimiter = createRateLimiter(5, 1);

const SERVER_START = Date.now();
const VERSION = process.env.npm_package_version || "1.0.0";
const CHECK_TIMEOUT_MS = 2000;

/**
 * Run a SELECT 1 against the pool with a hard timeout.
 * @returns {{ status: "ok", latency_ms: number } | { status: "error", message: string }}
 */
async function checkDatabase() {
  const start = Date.now();
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Database check timed out")),
          CHECK_TIMEOUT_MS,
        ),
      ),
    ]);
    return { status: "ok", latency_ms: Date.now() - start };
  } catch (err) {
    return { status: "error", message: err.message };
  }
}

/**
 * Ping Stellar Horizon /ledgers?limit=1 with a hard timeout.
 * @returns {{ status: "ok", network: string, ledger: number } | { status: "error", message: string }}
 */
async function checkStellar() {
  const horizonUrl =
    process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  const network = process.env.STELLAR_NETWORK || "testnet";

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

    if (!res.ok) {
      return {
        status: "error",
        message: `Horizon returned HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    const ledger = data?._embedded?.records?.[0]?.sequence ?? null;
    return { status: "ok", network, ledger };
  } catch (err) {
    const message =
      err.name === "AbortError"
        ? "Stellar Horizon check timed out"
        : err.message;
    return { status: "error", message };
  }
}

/**
 * Check IPFS/Pinata configuration status.
 * @returns {{ status: "ok" | "not_configured" }}
 */
function checkIpfs() {
  return { status: ipfsService.isConfigured() ? "ok" : "not_configured" };
}

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Enhanced health check
 *     description: >
 *       Checks database connectivity (SELECT 1) and Stellar Horizon reachability.
 *       Returns 200 when healthy, 503 when any critical dependency is down.
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
 *       503:
 *         description: One or more dependencies are down
 */
router.get("/", healthRateLimiter, async (req, res) => {
  const [database, stellar] = await Promise.all([
    checkDatabase(),
    checkStellar(),
  ]);
  const ipfs = checkIpfs();

  const healthy = database.status === "ok" && stellar.status === "ok";

  const body = {
    status: healthy ? "healthy" : "degraded",
    database,
    stellar,
    ipfs,
    uptime_seconds: Math.floor((Date.now() - SERVER_START) / 1000),
    version: VERSION,
    indexer: req.app.locals.indexerService
      ? req.app.locals.indexerService.getHealth()
      : null,
  };

  // Fire-and-forget: persist check results (failure is non-fatal)
  const now = new Date().toISOString();
  [
    { service: "database", status: database.status },
    { service: "stellar",  status: stellar.status },
    { service: "ipfs",     status: ipfs.status },
  ].forEach(({ service, status }) => {
    pool
      .query(
        `INSERT INTO health_checks (service, status, checked_at) VALUES ($1, $2, $3)`,
        [service, status, now],
      )
      .catch((err) =>
        console.warn("[health] health_checks insert failed:", err.message),
      );
  });

  res.status(healthy ? 200 : 503).json(body);
});

// GET /history — last 90 entries per service
router.get("/history", healthRateLimiter, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT service, status, checked_at
       FROM health_checks
       ORDER BY checked_at DESC
       LIMIT 270`,
    );

    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.service]) grouped[row.service] = [];
      if (grouped[row.service].length < 90) {
        grouped[row.service].push({
          status: row.status,
          checkedAt: row.checked_at,
        });
      }
    }

    res.json({ success: true, data: grouped });
  } catch (err) {
    next(err);
  }
});

// POST /subscribe — email subscription for status alerts
router.post("/subscribe", subscribeRateLimiter, async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: "Valid email required" });
    }

    await pool.query(
      `INSERT INTO status_subscriptions (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [email.trim().toLowerCase()],
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
