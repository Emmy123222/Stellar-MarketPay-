/**
 * @swagger
 * tags:
 *   name: DAO
 *   description: DAO governance (proposals, voting, treasury, arbitrators)
 */
"use strict";

const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT, requireAdminRole } = require("../middleware/auth");
const daoService = require("../services/daoService");

const daoRateLimiter = createRateLimiter(60, 1);

/**
 * @swagger
 * /api/dao/proposals:
 *   get:
 *     summary: List DAO proposals
 *     tags: [DAO]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, passed, rejected, executed, expired]
 *     responses:
 *       200:
 *         description: Proposal list
 *   post:
 *     summary: Create a DAO proposal
 *     tags: [DAO]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *               - type
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [funding, parameter_change, arbitrator_election]
 *               amount:
 *                 type: number
 *               recipient:
 *                 type: string
 *               votingDays:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Proposal created
 */
router.get("/proposals", daoRateLimiter, async (req, res, next) => {
  try {
    await daoService.finalizeExpiredProposals();
    const proposals = await daoService.listProposals({
      status: req.query.status,
    });
    res.json({ success: true, data: proposals });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/proposals/{id}:
 *   get:
 *     summary: Get proposal details
 *     tags: [DAO]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Proposal details
 */
router.get("/proposals/:id", daoRateLimiter, async (req, res, next) => {
  try {
    const proposal = await daoService.getProposal(req.params.id);
    res.json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

router.post("/proposals", verifyJWT, daoRateLimiter, async (req, res, next) => {
  try {
    const { title, description, type, amount, recipient, votingDays } = req.body;
    const proposal = await daoService.createProposal({
      title,
      description,
      type,
      proposer: req.user.publicKey,
      amount,
      recipient,
      votingDays,
    });
    res.status(201).json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/proposals/{id}/vote:
 *   post:
 *     summary: Cast a vote on a proposal
 *     tags: [DAO]
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
 *             properties:
 *               support:
 *                 type: boolean
 *               weight:
 *                 type: number
 *               txHash:
 *                 type: string
 *     responses:
 *       200:
 *         description: Vote cast
 */
router.post("/proposals/:id/vote", verifyJWT, daoRateLimiter, async (req, res, next) => {
  try {
    const { support, weight, txHash } = req.body;
    const proposal = await daoService.castVote({
      proposalId: req.params.id,
      voter: req.user.publicKey,
      support: Boolean(support),
      weight,
      txHash,
    });
    res.json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/treasury:
 *   get:
 *     summary: Get DAO treasury summary
 *     tags: [DAO]
 *     responses:
 *       200:
 *         description: Treasury summary
 */
router.get("/treasury", daoRateLimiter, async (req, res, next) => {
  try {
    const summary = await daoService.getTreasurySummary();
    res.json({ success: true, data: summary });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/arbitrators:
 *   get:
 *     summary: List arbitrators and top panel
 *     tags: [DAO]
 *     responses:
 *       200:
 *         description: Arbitrator list with top panel
 *   post:
 *     summary: Register as an arbitrator
 *     tags: [DAO]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *               bio:
 *                 type: string
 *     responses:
 *       201:
 *         description: Arbitrator profile created
 */
router.get("/arbitrators", daoRateLimiter, async (req, res, next) => {
  try {
    const arbitrators = await daoService.listArbitrators();
    const panel = await daoService.getTopArbitratorPanel(3);
    res.json({ success: true, data: { arbitrators, disputePanel: panel } });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/arbitrators/{publicKey}:
 *   get:
 *     summary: Get arbitrator profile
 *     tags: [DAO]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Arbitrator profile
 *       404:
 *         description: Arbitrator not found
 */
router.get("/arbitrators/:publicKey", daoRateLimiter, async (req, res, next) => {
  try {
    const arbitrators = await daoService.listArbitrators();
    const found = arbitrators.find((a) => a.publicKey === req.params.publicKey);
    if (!found) {
      return res.status(404).json({ error: "Arbitrator not found" });
    }
    res.json({ success: true, data: found });
  } catch (e) {
    next(e);
  }
});

router.post("/arbitrators", verifyJWT, daoRateLimiter, async (req, res, next) => {
  try {
    const { displayName, bio } = req.body;
    const profile = await daoService.upsertArbitrator({
      publicKey: req.user.publicKey,
      displayName,
      bio,
    });
    res.status(201).json({ success: true, data: profile });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/arbitrators/{publicKey}/vote:
 *   post:
 *     summary: Vote for an arbitrator
 *     tags: [DAO]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               weight:
 *                 type: number
 *     responses:
 *       200:
 *         description: Vote recorded
 */
router.post("/arbitrators/:publicKey/vote", verifyJWT, daoRateLimiter, async (req, res, next) => {
  try {
    const { weight } = req.body;
    const arbitrators = await daoService.voteForArbitrator({
      voter: req.user.publicKey,
      arbitratorKey: req.params.publicKey,
      weight,
    });
    res.json({ success: true, data: arbitrators });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/dao/proposals/{id}/execute:
 *   post:
 *     summary: Execute a passed proposal (admin only)
 *     tags: [DAO]
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
 *         description: Proposal executed
 */
router.post("/proposals/:id/execute", verifyJWT, requireAdminRole, daoRateLimiter, async (req, res, next) => {
  try {
    const proposal = await daoService.executeProposal(req.params.id);
    res.json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
