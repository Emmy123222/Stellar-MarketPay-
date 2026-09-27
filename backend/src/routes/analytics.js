"use strict";

/**
 * src/routes/analytics.js
 *
 * GET /api/analytics/categories — marketplace stats per category
 * GET /api/analytics/overview   — platform totals and status overview
 *
 * @swagger
 * tags:
 *   name: Analytics
 *   description: Marketplace analytics and insights
 */

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  getCategoryAnalytics,
  getAnalyticsOverview,
} = require("../services/jobService");

const router = express.Router();
const analyticsRateLimiter = createRateLimiter(60, 1);

/**
 * @swagger
 * /api/analytics/categories:
 *   get:
 *     summary: Get marketplace statistics per job category
 *     tags: [Analytics]
 *     responses:
 *       200:
 *         description: List of category statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       category:
 *                         type: string
 *                       jobCount:
 *                         type: integer
 *                       avgBudgetXLM:
 *                         type: number
 *                       filledCount:
 *                         type: integer
 *                       avgDaysToFill:
 *                         type: number
 *                         nullable: true
 */
router.get("/categories", analyticsRateLimiter, async (req, res, next) => {
  try {
    const data = await getCategoryAnalytics();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/analytics/overview:
 *   get:
 *     summary: Get platform totals and status breakdown
 *     tags: [Analytics]
 *     responses:
 *       200:
 *         description: Platform-wide overview totals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalJobs:
 *                       type: integer
 *                     openJobs:
 *                       type: integer
 *                     inProgressJobs:
 *                       type: integer
 *                     completedJobs:
 *                       type: integer
 *                     cancelledJobs:
 *                       type: integer
 *                     totalVolumeXLM:
 *                       type: number
 *                     avgJobBudgetXLM:
 *                       type: number
 *                     avgDaysToFill:
 *                       type: number
 *                       nullable: true
 */
router.get("/overview", analyticsRateLimiter, async (req, res, next) => {
  try {
    const data = await getAnalyticsOverview();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
