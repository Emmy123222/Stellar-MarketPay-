"use strict";

const express = require("express");
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

/**
 * GET /api/skills
 * Fetches skills for autocomplete based on a 'q' query parameter.
 * Returns up to 10 matching skills.
 */
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
