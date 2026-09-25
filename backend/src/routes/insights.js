/**
 * @swagger
 * tags:
 *   name: Insights
 *   description: Platform analytics and insights
 */
"use strict";

const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const insightsService = require("../services/insightsService");

const insightsRateLimiter = createRateLimiter(30, 1);

/**
 * @swagger
 * /api/insights:
 *   get:
 *     summary: Get platform-wide analytics summary
 *     tags: [Insights]
 *     responses:
 *       200:
 *         description: Analytics summary (cached 1 hour)
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
 *                     totalXlmTransacted:
 *                       type: number
 *                     activeFreelancers:
 *                       type: integer
 *                     avgTimeToHire:
 *                       type: number
 */
router.get("/", insightsRateLimiter, async (_req, res, next) => {
  try {
    const summary = await insightsService.getPlatformSummary();
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/insights/categories:
 *   get:
 *     summary: Get category insights
 *     tags: [Insights]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Category insights with client mix
 */
router.get("/categories", insightsRateLimiter, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const [categories, clientMix] = await Promise.all([
      insightsService.getCategoryInsights(limit),
      insightsService.getClientMix(),
    ]);

    res.json({
      success: true,
      data: {
        categories,
        clientMix,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/insights/skills:
 *   get:
 *     summary: Get skill demand insights
 *     tags: [Insights]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Skill insights
 */
router.get("/skills", insightsRateLimiter, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const skills = await insightsService.getSkillInsights(limit);
    res.json({ success: true, data: skills });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/insights/competitive:
 *   get:
 *     summary: Get competitive job listings
 *     tags: [Insights]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Competitive job listings
 */
router.get("/competitive", insightsRateLimiter, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const jobs = await insightsService.getCompetitiveJobs(limit);
    res.json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/insights/trends/pay:
 *   get:
 *     summary: Get pay trends over time
 *     tags: [Insights]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *           maximum: 90
 *     responses:
 *       200:
 *         description: Pay trend data
 */
router.get("/trends/pay", insightsRateLimiter, async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const trends = await insightsService.getPayTrends(days);
    res.json({ success: true, data: trends });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
