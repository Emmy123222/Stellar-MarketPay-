/**
 * src/routes/scope.js
 * Scope session management routes
 *
 * @swagger
 * tags:
 *   name: Scope
 *   description: Collaborative scope session management
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

const renewRateLimiter = createRateLimiter(5, 1);

/**
 * @swagger
 * /api/scope/{sessionId}/renew:
 *   post:
 *     summary: Extend a scope session by 24 hours
 *     tags: [Scope]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session extended
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 sessionId:
 *                   type: string
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Session not found or expired
 */
router.post("/:sessionId/renew", renewRateLimiter, async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const { rows } = await pool.query(
      `UPDATE scope_sessions
       SET expires_at = NOW() + INTERVAL '24 hours',
           updated_at = NOW()
       WHERE session_id = $1 AND expires_at > NOW()
       RETURNING session_id, expires_at`,
      [sessionId]
    );

    if (!rows.length) {
      const e = new Error("Session not found or already expired");
      e.status = 404;
      throw e;
    }

    res.json({
      success: true,
      sessionId: rows[0].session_id,
      expiresAt: rows[0].expires_at,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
