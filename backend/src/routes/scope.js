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
const upsertRateLimiter = createRateLimiter(60, 1);

const MAX_CONTENT_LENGTH = 500_000;

router.use(express.json({ limit: "2mb" }));

/**
 * Upsert a scope drafting session in PostgreSQL.
 * Validates that content length does not exceed 500,000 characters (500 KB)
 * to prevent denial-of-service (DoS) storage exhaustion.
 *
 * @param {string} sessionId  Unique session identifier
 * @param {Object} patch      Session attributes to update
 * @param {string} [patch.content] Document content
 * @param {Object} [patch.cursors] Active collaborator cursors
 * @param {boolean} [patch.finalized] Finalized flag
 * @param {string|null} [patch.finalizedHash] SHA-256 hash of finalized content
 * @param {Object|null} [patch.finalizedPayload] Finalized metadata payload
 * @returns {Promise<Object>} The upserted scope session row
 */
async function upsertScopeSession(sessionId, patch = {}) {
  const content = typeof patch.content === "string" ? patch.content : "";
  if (content.length > MAX_CONTENT_LENGTH) {
    const err = new Error(
      `Payload Too Large: content length ${content.length} exceeds maximum limit of ${MAX_CONTENT_LENGTH} characters`,
    );
    err.status = 413;
    err.statusCode = 413;
    err.code = "PAYLOAD_TOO_LARGE";
    throw err;
  }

  const cursors =
    patch.cursors && typeof patch.cursors === "object" ? patch.cursors : {};
  const finalized = Boolean(patch.finalized);
  const finalizedHash = patch.finalizedHash || null;
  const finalizedPayload = patch.finalizedPayload || null;

  const { rows } = await pool.query(
    `INSERT INTO scope_sessions (session_id, content, cursors, finalized, finalized_hash, finalized_payload, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, NOW() + INTERVAL '24 hours', NOW(), NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       content = EXCLUDED.content,
       cursors = EXCLUDED.cursors,
       finalized = EXCLUDED.finalized,
       finalized_hash = EXCLUDED.finalized_hash,
       finalized_payload = EXCLUDED.finalized_payload,
       expires_at = NOW() + INTERVAL '24 hours',
       updated_at = NOW()
     RETURNING session_id, content, cursors, finalized, finalized_hash, finalized_payload, expires_at, updated_at`,
    [
      sessionId,
      content,
      JSON.stringify(cursors),
      finalized,
      finalizedHash,
      JSON.stringify(finalizedPayload),
    ],
  );
  return rows[0];
}

async function loadScopeSession(sessionId) {
  const { rows } = await pool.query(
    `SELECT session_id, content, cursors, finalized, finalized_hash, finalized_payload, expires_at, updated_at
     FROM scope_sessions
     WHERE session_id = $1 AND expires_at > NOW()`,
    [sessionId],
  );
  return rows[0] || null;
}

async function cleanupExpiredScopeSessions() {
  await pool.query("DELETE FROM scope_sessions WHERE expires_at <= NOW()");
}

/**
 * Route handler for upserting scope session content.
 * Enforces content.length <= 500_000 characters and returns 413 on violation.
 */
const handleUpsertScopeSession = async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId || req.body?.sessionId;
    if (!sessionId) {
      const e = new Error("Session ID is required");
      e.status = 400;
      throw e;
    }

    const { content, cursors, finalized, finalizedPayload, finalizedHash } =
      req.body || {};

    if (content !== undefined && content !== null) {
      if (typeof content !== "string") {
        const e = new Error("content must be a string");
        e.status = 400;
        throw e;
      }
      if (content.length > MAX_CONTENT_LENGTH) {
        const e = new Error(
          `Payload Too Large: content length ${content.length} exceeds maximum limit of ${MAX_CONTENT_LENGTH} characters`,
        );
        e.status = 413;
        e.statusCode = 413;
        e.code = "PAYLOAD_TOO_LARGE";
        throw e;
      }
    }

    const session = await upsertScopeSession(sessionId, {
      content,
      cursors,
      finalized,
      finalizedPayload,
      finalizedHash,
    });

    res.json({
      success: true,
      session,
    });
  } catch (e) {
    next(e);
  }
};

/**
 * @swagger
 * /api/scope/{sessionId}:
 *   post:
 *     summary: Upsert a scope session
 *     tags: [Scope]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *                 maxLength: 500000
 *               cursors:
 *                 type: object
 *               finalized:
 *                 type: boolean
 *               finalizedPayload:
 *                 type: object
 *     responses:
 *       200:
 *         description: Scope session upserted successfully
 *       400:
 *         description: Invalid input or missing sessionId
 *       413:
 *         description: Payload Too Large
 *   put:
 *     summary: Upsert a scope session
 *     tags: [Scope]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *                 maxLength: 500000
 *               cursors:
 *                 type: object
 *               finalized:
 *                 type: boolean
 *               finalizedPayload:
 *                 type: object
 *     responses:
 *       200:
 *         description: Scope session upserted successfully
 *       400:
 *         description: Invalid input or missing sessionId
 *       413:
 *         description: Payload Too Large
 *   get:
 *     summary: Retrieve an active scope session
 *     tags: [Scope]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Active scope session details
 *       404:
 *         description: Session not found or expired
 */
router.post("/:sessionId", upsertRateLimiter, handleUpsertScopeSession);
router.put("/:sessionId", upsertRateLimiter, handleUpsertScopeSession);
router.post("/", upsertRateLimiter, handleUpsertScopeSession);
router.put("/", upsertRateLimiter, handleUpsertScopeSession);

router.get("/:sessionId", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await loadScopeSession(sessionId);
    if (!session) {
      const e = new Error("Session not found or already expired");
      e.status = 404;
      throw e;
    }
    res.json({
      success: true,
      session,
    });
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
 *       413:
 *         description: Payload Too Large
 */
router.post("/:sessionId/renew", renewRateLimiter, async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (
      req.body &&
      req.body.content !== undefined &&
      req.body.content !== null
    ) {
      if (
        typeof req.body.content === "string" &&
        req.body.content.length > MAX_CONTENT_LENGTH
      ) {
        const e = new Error(
          `Payload Too Large: content length ${req.body.content.length} exceeds maximum limit of ${MAX_CONTENT_LENGTH} characters`,
        );
        e.status = 413;
        e.statusCode = 413;
        e.code = "PAYLOAD_TOO_LARGE";
        throw e;
      }
    }

    const { rows } = await pool.query(
      `UPDATE scope_sessions
       SET expires_at = NOW() + INTERVAL '24 hours',
           updated_at = NOW()
       WHERE session_id = $1 AND expires_at > NOW()
       RETURNING session_id, expires_at`,
      [sessionId],
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

router.upsertScopeSession = upsertScopeSession;
router.loadScopeSession = loadScopeSession;
router.cleanupExpiredScopeSessions = cleanupExpiredScopeSessions;
router.MAX_CONTENT_LENGTH = MAX_CONTENT_LENGTH;

module.exports = router;
module.exports.upsertScopeSession = upsertScopeSession;
module.exports.loadScopeSession = loadScopeSession;
module.exports.cleanupExpiredScopeSessions = cleanupExpiredScopeSessions;
module.exports.MAX_CONTENT_LENGTH = MAX_CONTENT_LENGTH;

