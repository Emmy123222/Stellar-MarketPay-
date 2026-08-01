/**
 * src/routes/invitations.js
 * Issue #342 — Job invitation endpoints for freelancers.
 *
 * @swagger
 * tags:
 *   name: Invitations
 *   description: Job invitation system
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
 * @swagger
 * /api/invitations:
 *   get:
 *     summary: List pending invitations for authenticated freelancer
 *     tags: [Invitations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending invitations
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
 * @swagger
 * /api/invitations/{id}/decline:
 *   patch:
 *     summary: Decline a job invitation
 *     tags: [Invitations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invitation declined
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
 * @swagger
 * /api/invitations/{id}/accept:
 *   post:
 *     summary: Accept a job invitation (auto-creates application)
 *     tags: [Invitations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - proposal
 *               - bidAmount
 *             properties:
 *               proposal:
 *                 type: string
 *               bidAmount:
 *                 type: number
 *     responses:
 *       201:
 *         description: Application created
 *       400:
 *         description: Missing proposal or bidAmount
 *       403:
 *         description: Not the invited freelancer
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
