/**
 * routes/talentPool.js
 * Talent pool — clients save and manage favourite freelancers (Issue #1550).
 *
 * GET    /api/talent-pools             — list saved freelancers for the authed client
 * POST   /api/talent-pools             — add a freelancer to the pool
 * DELETE /api/talent-pools/:id         — remove an entry
 * POST   /api/talent-pools/:id/invite  — invite a saved freelancer to a job
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { createInAppNotification, EVENT_TYPES } = require("../services/notificationService");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("talent-pool");
const readLimiter  = createRateLimiter(60, 1);
const writeLimiter = createRateLimiter(20, 1);

// Stellar public keys are always 56-char base32 starting with G
const STELLAR_KEY_RE = /^G[A-Z2-7]{55}$/;
// UUIDs v4 format
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTE_MAX_LEN = 500;

function isValidUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

function isValidStellarKey(v) {
  return typeof v === "string" && STELLAR_KEY_RE.test(v);
}

function sanitizeNote(v) {
  if (v == null) return null;
  // Strip any HTML/script tags and truncate
  return String(v).replace(/<[^>]*>/g, "").slice(0, NOTE_MAX_LEN);
}

// GET /api/talent-pools
router.get("/", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT tp.id, tp.freelancer_address, tp.note, tp.created_at,
              p.display_name, p.skills, p.rating, p.completed_jobs, p.availability, p.tier
       FROM talent_pool tp
       JOIN profiles p ON p.public_key = tp.freelancer_address
       WHERE tp.client_address = $1
       ORDER BY tp.created_at DESC`,
      [req.user.publicKey],
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/talent-pools
router.post("/", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const { freelancerId, note } = req.body;

    if (!isValidStellarKey(freelancerId)) {
      return res.status(400).json({ success: false, error: "Invalid freelancerId" });
    }

    // Prevent clients from adding themselves
    if (freelancerId === req.user.publicKey) {
      return res.status(400).json({ success: false, error: "Cannot add yourself to your talent pool" });
    }

    const cleanNote = sanitizeNote(note);

    // Verify the freelancer exists
    const { rows: profileRows } = await pool.query(
      "SELECT public_key, display_name FROM profiles WHERE public_key = $1",
      [freelancerId],
    );
    if (profileRows.length === 0) {
      return res.status(404).json({ success: false, error: "Freelancer not found" });
    }

    const { rows } = await pool.query(
      `INSERT INTO talent_pool (client_address, freelancer_address, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (client_address, freelancer_address) DO NOTHING
       RETURNING *`,
      [req.user.publicKey, freelancerId, cleanNote],
    );

    if (rows.length === 0) {
      // Already in the pool — return the existing entry
      const { rows: existing } = await pool.query(
        "SELECT * FROM talent_pool WHERE client_address = $1 AND freelancer_address = $2",
        [req.user.publicKey, freelancerId],
      );
      return res.json({ success: true, data: existing[0] });
    }

    logger.info({ clientId: req.user.publicKey, freelancerId }, "Added to talent pool");

    // Notify the freelancer (fire-and-forget — don't block the response)
    createInAppNotification({
      userAddress: freelancerId,
      type: EVENT_TYPES.TALENT_POOL_SAVED,
      title: "You were saved to a talent pool",
      body: "A client has added you to their talent pool and may reach out soon.",
      linkPath: "/dashboard",
    }).catch((err) => logger.error({ err }, "Failed to send talent pool notification"));

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/talent-pools/:id
router.delete("/:id", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid id" });
    }

    const result = await pool.query(
      "DELETE FROM talent_pool WHERE id = $1 AND client_address = $2",
      [req.params.id, req.user.publicKey],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Entry not found" });
    }

    logger.info({ clientId: req.user.publicKey, entryId: req.params.id }, "Removed from talent pool");
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/talent-pools/:id/invite
router.post("/:id/invite", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    if (!isValidUuid(req.params.id)) {
      return res.status(400).json({ success: false, error: "Invalid id" });
    }

    const { jobId } = req.body;

    if (!isValidUuid(jobId)) {
      return res.status(400).json({ success: false, error: "Invalid jobId" });
    }

    // Resolve talent pool entry → freelancer address
    const { rows: entryRows } = await pool.query(
      "SELECT freelancer_address FROM talent_pool WHERE id = $1 AND client_address = $2",
      [req.params.id, req.user.publicKey],
    );
    if (entryRows.length === 0) {
      return res.status(404).json({ success: false, error: "Entry not found" });
    }

    const { inviteFreelancerToJob } = require("../services/jobInvitationService");
    const invitation = await inviteFreelancerToJob({
      jobId,
      clientAddress: req.user.publicKey,
      freelancerAddress: entryRows[0].freelancer_address,
    });

    req.app.locals.broadcastRealtime?.("job:invited", {
      jobId,
      recipientAddress: invitation.freelancer_address,
      invitedAt: invitation.created_at,
    });

    res.status(201).json({ success: true, data: invitation });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
