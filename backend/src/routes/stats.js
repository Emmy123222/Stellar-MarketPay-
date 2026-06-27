/**
 * Platform statistics routes for Issue #232: analytics dashboard
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const statsService = require("../services/statsService");
const { getXlmUsd7dHistory, PRICE_HISTORY_TTL_SECONDS } = require("../services/xlmPriceService");

const statsRateLimiter = createRateLimiter(30, 1); // 30 requests per minute

// GET /api/stats — get platform-wide metrics
router.get("/", statsRateLimiter, async (req, res, next) => {
  try {
    const stats = await statsService.getStats();
    res.json({ success: true, data: stats });
  } catch (e) { next(e); }
});

// GET /api/stats/trends/jobs — job posting trends over time
router.get("/trends/jobs", statsRateLimiter, async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);
    const trends = await statsService.getJobTrends(days);
    res.json({ success: true, data: trends });
  } catch (e) { next(e); }
});

// GET /api/stats/trends/escrow — escrow volume trends
router.get("/trends/escrow", statsRateLimiter, async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);
    const trends = await statsService.getEscrowTrends(days);
    res.json({ success: true, data: trends });
  } catch (e) { next(e); }
});

// GET /api/stats/categories — top job categories
router.get("/categories", statsRateLimiter, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const categories = await statsService.getTopCategories(limit);
    res.json({ success: true, data: categories });
  } catch (e) { next(e); }
});

// GET /api/stats/xlm-price-history — 7-day XLM/USD history for dashboard widget
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
