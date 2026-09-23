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

const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

const createSessionRateLimiter = createRateLimiter(5, 1);
const renewRateLimiter = createRateLimiter(5, 1);
const finalizeRateLimiter = createRateLimiter(10, 1);

/**
 * Notify every WebSocket client currently attached to a scope session that
 * the document has been locked/finalized. The server exposes the shared
 * `scopeSessionClients` map and the `sendJson` helper on `app.locals` so this
 * route can fan out without owning the WebSocket server.
 */
function broadcastScopeFinalized(req, sessionId, payload) {
  try {
    const clients = req.app && req.app.locals && req.app.locals.scopeSessionClients;
    const send = req.app && req.app.locals && req.app.locals.sendJson;
    if (!clients || typeof send !== "function") return;
    const sockets = clients.get(sessionId);
    if (!sockets) return;
    for (const ws of sockets) send(ws, "scope:finalized", payload);
  } catch {
    /* realtime fan-out is best-effort */
  }
}

/**
 * @swagger
 * /api/scope:
 *   post:
 *     summary: Create a collaborative scope session for a co-written proposal
 *     tags: [Scope]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jobId:
 *                 type: string
 *               content:
 *                 type: string
 *               createdBy:
 *                 type: string
 *     responses:
 *       201:
 *         description: Session created
 *       500:
 *         description: Database error
 */
router.post("/", createSessionRateLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const jobId = typeof body.jobId === "string" ? body.jobId : null;
    const createdBy =
      typeof body.createdBy === "string" ? body.createdBy : null;
    const content = typeof body.content === "string" ? body.content : "";

    // The session id is generated server-side so a client cannot collide with
    // (or guess) another team's session.
    const sessionId = crypto.randomUUID();
    const metadata = { jobId, createdBy };

    const { rows } = await pool.query(
      `INSERT INTO scope_sessions (session_id, content, cursors, finalized, finalized_payload, expires_at, created_at, updated_at)
       VALUES ($1, $2, '{}'::jsonb, false, $3::jsonb, NOW() + INTERVAL '24 hours', NOW(), NOW())
       RETURNING session_id, content, finalized, finalized_payload, expires_at`,
      [sessionId, content, JSON.stringify(metadata)],
    );

    res.status(201).json({
      success: true,
      sessionId: rows[0].session_id,
      sharePath: `/scope/${rows[0].session_id}`,
      expiresAt: rows[0].expires_at,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/scope/{sessionId}/finalize:
 *   post:
 *     summary: Lock a scope session (called when the proposal is submitted)
 *     tags: [Scope]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *               finalizedHash:
 *                 type: string
 *               payload:
 *                 type: object
 *     responses:
 *       200:
 *         description: Session locked
 *       404:
 *         description: Session not found or expired
 */
router.post("/:sessionId/finalize", finalizeRateLimiter, async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const body = req.body || {};
    const content = typeof body.content === "string" ? body.content : null;
    const payload = body.payload && typeof body.payload === "object" ? body.payload : null;

    // Deterministic content hash so the locked scope can be verified later.
    const finalizedHash =
      typeof body.finalizedHash === "string" && body.finalizedHash
        ? body.finalizedHash
        : content !== null
          ? crypto.createHash("sha256").update(content).digest("hex")
          : null;

    const { rows } = await pool.query(
      `UPDATE scope_sessions
       SET finalized = true,
           content = COALESCE($2, content),
           finalized_hash = COALESCE($3, finalized_hash),
           finalized_payload = COALESCE($4::jsonb, finalized_payload),
           updated_at = NOW()
       WHERE session_id = $1 AND expires_at > NOW()
       RETURNING session_id, content, finalized, finalized_hash, finalized_payload, expires_at`,
      [
        sessionId,
        content,
        finalizedHash,
        payload ? JSON.stringify(payload) : null,
      ],
    );

    if (!rows.length) {
      const e = new Error("Session not found or already expired");
      e.status = 404;
      throw e;
    }

    const lockedPayload = {
      sessionId: rows[0].session_id,
      content: rows[0].content,
      finalizedHash: rows[0].finalized_hash || finalizedHash,
      payload: rows[0].finalized_payload || payload,
      finalized: true,
      expiresAt: rows[0].expires_at,
    };

    // Push the lock to every collaborator still connected so their editors
    // become read-only immediately.
    broadcastScopeFinalized(req, sessionId, lockedPayload);

    res.json({ success: true, ...lockedPayload });
  } catch (e) {
    next(e);
  }
});

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
