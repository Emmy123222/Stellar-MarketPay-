/**
 * @swagger
 * tags:
 *   name: Categories
 *   description: Job category tree
 *
 * /api/categories:
 *   get:
 *     summary: Get the full category tree
 *     tags: [Categories]
 *     responses:
 *       200:
 *         description: Category tree with nested children
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
 *                       id:
 *                         type: integer
 *                       slug:
 *                         type: string
 *                       name:
 *                         type: string
 *                       children:
 *                         type: array
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

const listRateLimiter = createRateLimiter(120, 1);

router.get("/", listRateLimiter, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, slug, name, parent_id FROM categories ORDER BY parent_id NULLS FIRST, name ASC"
    );

    // Build tree: parents first, then attach children
    const byId = {};
    const roots = [];

    for (const row of rows) {
      byId[row.id] = { id: row.id, slug: row.slug, name: row.name, children: [] };
    }

    for (const row of rows) {
      if (row.parent_id === null) {
        roots.push(byId[row.id]);
      } else if (byId[row.parent_id]) {
        byId[row.parent_id].children.push(byId[row.id]);
      }
    }

    res.json({ success: true, data: roots });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
