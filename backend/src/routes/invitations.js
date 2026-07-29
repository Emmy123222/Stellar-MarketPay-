/**
 * src/routes/invitations.js
 * Issue #342 — Job invitation endpoints for freelancers.
 *
 * GET  /api/invitations              — list pending invitations for the authed freelancer
 * PATCH /api/invitations/:id/decline — decline an invitation
 * POST  /api/invitations/:id/accept  — accept (auto-creates application)
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  getInvitationsForFreelancer,
  declineInvitation,
} = require("../services/jobInvitationService");
const { submitApplication } = require("../services/applicationService");

const readLimiter  = createRateLimiter(60, 1);
const writeLimiter = createRateLimiter(20, 1);

/**
 * GET /api/invitations
 * Returns all pending invitations for the authenticated freelancer.
 */
router.get("/", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const invitations = await getInvitationsForFreelancer(req.user.publicKey);
    res.json({ success: true, data: invitations });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/invitations/:id/decline
 * Freelancer declines an invitation.
 */
router.patch("/:id/decline", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const invitation = await declineInvitation(req.params.id, req.user.publicKey);
    res.json({ success: true, data: invitation });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/invitations/:id/accept
 * Freelancer accepts an invitation — auto-creates a pending application.
 * Body: { proposal, bidAmount }
 */
router.post("/:id/accept", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const pool = require("../db/pool");
    const { rows } = await pool.query(
      "SELECT * FROM job_invitations WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) {
      const e = new Error("Invitation not found");
      e.status = 404;
      throw e;
    }
    const inv = rows[0];
    if (inv.freelancer_address !== req.user.publicKey) {
      const e = new Error("Only the invited freelancer can accept");
      e.status = 403;
      throw e;
    }

    const { proposal, bidAmount } = req.body;
    if (!proposal || !bidAmount) {
      const e = new Error("proposal and bidAmount are required");
      e.status = 400;
      throw e;
    }

    const application = await submitApplication({
      jobId: inv.job_id,
      freelancerAddress: req.user.publicKey,
      proposal,
      bidAmount,
    });

    // Mark invitation as accepted
    await pool.query(
      "UPDATE job_invitations SET status = 'accepted' WHERE id = $1",
      [req.params.id]
    );

    res.status(201).json({ success: true, data: application });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
