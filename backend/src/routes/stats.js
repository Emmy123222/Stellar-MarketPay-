/**
 * Platform statistics routes for Issue #232: analytics dashboard
 *
 * @swagger
 * tags:
 *   name: Stats
 *   description: Platform statistics
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const statsService = require("../services/statsService");
const { getXlmUsd7dHistory, PRICE_HISTORY_TTL_SECONDS } = require("../services/xlmPriceService");

const statsRateLimiter = createRateLimiter(30, 1); // 30 requests per minute

/**
 * @swagger
 * /api/stats:
 *   get:
 *     summary: Get platform-wide metrics
 *     tags: [Stats]
 *     responses:
 *       200:
 *         description: Platform metrics
 */
router.get("/", statsRateLimiter, async (req, res, next) => {
  try {
    const stats = await statsService.getStats();
    res.json({ success: true, data: stats });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/stats/trends/jobs:
 *   get:
 *     summary: Get job posting trends
 *     tags: [Stats]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 90
 *           maximum: 365
 *     responses:
 *       200:
 *         description: Job trends
 */
router.get("/trends/jobs", statsRateLimiter, async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);
    const trends = await statsService.getJobTrends(days);
    res.json({ success: true, data: trends });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/stats/trends/escrow:
 *   get:
 *     summary: Get escrow volume trends
 *     tags: [Stats]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 90
 *           maximum: 365
 *     responses:
 *       200:
 *         description: Escrow trends
 */
router.get("/trends/escrow", statsRateLimiter, async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);
    const trends = await statsService.getEscrowTrends(days);
    res.json({ success: true, data: trends });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/stats/categories:
 *   get:
 *     summary: Get top job categories
 *     tags: [Stats]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Top categories
 */
router.get("/categories", statsRateLimiter, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const categories = await statsService.getTopCategories(limit);
    res.json({ success: true, data: categories });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/stats/xlm-price-history:
 *   get:
 *     summary: Get 7-day XLM/USD price history
 *     tags: [Stats]
 *     responses:
 *       200:
 *         description: Price history data
 *         headers:
 *           Cache-Control:
 *             schema:
 *               type: string
 */
router.get("/xlm-price-history", statsRateLimiter, async (req, res, next) => {
  try {
    const data = await getXlmUsd7dHistory();
    res.set("Cache-Control", `public, max-age=${PRICE_HISTORY_TTL_SECONDS}`);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
