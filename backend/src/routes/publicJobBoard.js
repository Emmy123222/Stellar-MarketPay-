"use strict";

/**
 * GET /api/v1/public/jobs
 *
 * Unauthenticated, read-only job board feed for third-party syndication
 * (job boards, aggregators, etc). Rate-limited per IP rather than gated by
 * API key — see src/routes/public.js for the authenticated developer API.
 *
 * Issue #842: only syndication-safe fields are returned; client address and
 * applicant details are intentionally excluded.
 */

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

const publicJobsRateLimiter = createRateLimiter(60, 1); // 60 req/min per IP

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * @swagger
 * /api/v1/public/jobs:
 *   get:
 *     summary: List public job listings (no auth required)
 *     description: >
 *       Read-only feed of open, publicly-visible job listings intended for
 *       third-party job board syndication. Rate-limited to 60 requests per
 *       minute per IP address. Excludes client address and applicant details.
 *     tags: [Public]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by job category
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Maximum number of jobs to return
 *     responses:
 *       200:
 *         description: Public job listings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PublicJob'
 *       429:
 *         description: Too many requests — rate limit exceeded
 */
router.get("/jobs", publicJobsRateLimiter, async (req, res, next) => {
  try {
    const safeLimit = Math.max(
      1,
      Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT),
    );

    const conditions = [
      "status = 'open'",
      "visibility = 'public'",
      "deleted_at IS NULL",
    ];
    const params = [];

    if (req.query.category) {
      params.push(req.query.category);
      conditions.push(`category = $${params.length}`);
    }

    params.push(safeLimit);

    const { rows } = await pool.query(
      `SELECT id, title, category, budget, currency, skills, created_at
         FROM jobs
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params,
    );

    const data = rows.map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      budget: row.budget,
      currency: row.currency,
      skills: row.skills,
      createdAt: row.created_at,
    }));

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
