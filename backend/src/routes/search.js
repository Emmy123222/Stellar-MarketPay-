"use strict";

const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { searchAll } = require("../services/unifiedSearchService");

const searchRateLimiter = createRateLimiter(120, 1);

/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: Platform-wide unified search across jobs, freelancers, and DAO proposals
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query term
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *         description: Max results per entity type (1-20)
 *     responses:
 *       200:
 *         description: Unified search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobs:
 *                   type: array
 *                 freelancers:
 *                   type: array
 *                 proposals:
 *                   type: array
 */
router.get("/", searchRateLimiter, async (req, res, next) => {
  try {
    const query = req.query.q || req.query.search || "";
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 5;

    const results = await searchAll(query, limit);
    return res.json(results);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
