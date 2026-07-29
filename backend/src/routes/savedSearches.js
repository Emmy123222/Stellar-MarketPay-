/**
 * routes/savedSearches.js
 * CRUD endpoints for saved job search alerts (Issue #284).
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { verifyJWT } = require("../middleware/auth");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("saved-searches");
const MAX_SAVED_SEARCHES = 10;

/**
 * GET /api/saved-searches
 * List the authenticated user's saved searches.
 */
router.get("/", verifyJWT, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, user_address, query_params, notify_in_app, notify_email, last_notified_at, created_at, updated_at
       FROM saved_searches
       WHERE user_address = $1
       ORDER BY created_at DESC`,
      [req.user.publicKey]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/saved-searches
 * Save a new search query. Enforces a 10-search limit per user.
 */
router.post("/", verifyJWT, async (req, res, next) => {
  try {
    const { query_params, notify_in_app, notify_email } = req.body;

    if (!query_params || typeof query_params !== "object") {
      return res.status(400).json({ success: false, error: "query_params is required and must be an object" });
    }

    // Check limit
    const countResult = await pool.query(
      "SELECT COUNT(*) AS cnt FROM saved_searches WHERE user_address = $1",
      [req.user.publicKey]
    );
    if (Number(countResult.rows[0].cnt) >= MAX_SAVED_SEARCHES) {
      return res.status(400).json({
        success: false,
        error: `You can save up to ${MAX_SAVED_SEARCHES} searches. Please delete one first.`,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO saved_searches (user_address, query_params, notify_in_app, notify_email)
       VALUES ($1, $2::jsonb, $3, $4)
       RETURNING id, user_address, query_params, notify_in_app, notify_email, last_notified_at, created_at, updated_at`,
      [
        req.user.publicKey,
        JSON.stringify(query_params),
        notify_in_app !== false,
        Boolean(notify_email),
      ]
    );

    logger.info({ userId: req.user.publicKey, searchId: rows[0].id }, "Saved search created");
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/saved-searches/:id
 * Update notification preferences for a saved search.
 */
router.patch("/:id", verifyJWT, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notify_in_app, notify_email } = req.body;

    const { rows } = await pool.query(
      `UPDATE saved_searches
       SET notify_in_app = COALESCE($1, notify_in_app),
           notify_email = COALESCE($2, notify_email),
           updated_at = NOW()
       WHERE id = $3 AND user_address = $4
       RETURNING id, user_address, query_params, notify_in_app, notify_email, last_notified_at, created_at, updated_at`,
      [notify_in_app, notify_email, id, req.user.publicKey]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "Saved search not found" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/saved-searches/:id
 * Remove a saved search.
 */
router.delete("/:id", verifyJWT, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM saved_searches WHERE id = $1 AND user_address = $2",
      [id, req.user.publicKey]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Saved search not found" });
    }

    logger.info({ userId: req.user.publicKey, searchId: id }, "Saved search deleted");
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
