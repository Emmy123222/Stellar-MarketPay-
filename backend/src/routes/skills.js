/**
 * @swagger
 * tags:
 *   name: Skills
 *   description: Skill autocomplete
 *
 * /api/skills:
 *   get:
 *     summary: Search skills for autocomplete
 *     tags: [Skills]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query for skill name
 *     responses:
 *       200:
 *         description: Matching skills (up to 10)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 */
"use strict";

const express = require("express");
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

router.get("/", createRateLimiter(60, 1), async (req, res, next) => {
  try {
    const q = req.query.q;
    if (!q || typeof q !== "string") {
      return res.json([]);
    }

    const likePattern = `%${q.trim()}%`;
    const { rows } = await pool.query(
      `SELECT display_name AS skill FROM skills WHERE display_name ILIKE $1 ORDER BY display_name LIMIT 10`,
      [likePattern]
    );

    res.json(rows.map((r) => r.skill));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
