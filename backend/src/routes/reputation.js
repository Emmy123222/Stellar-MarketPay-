/**
 * src/routes/reputation.js
 *
 * Issue #1561: On-chain reputation score.
 *
 * GET /api/reputation/:userId — public reputation score for a Stellar address.
 * Includes an integer `scoreBps` (0–10000) so a Soroban contract (or an oracle
 * relaying to one) can consume it without floating point.
 *
 * @swagger
 * tags:
 *   name: Reputation
 *   description: Reputation scores for clients and freelancers
 */
"use strict";

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { getReputation } = require("../services/reputationService");

const router = express.Router();
const readRateLimiter = createRateLimiter(120, 1);

/**
 * @swagger
 * /api/reputation/{userId}:
 *   get:
 *     summary: Get a user's reputation score
 *     tags: [Reputation]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G...)
 *     responses:
 *       200:
 *         description: Reputation score
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     userId: { type: string }
 *                     score: { type: number, description: "0–100" }
 *                     scoreBps: { type: integer, description: "0–10000, for contract use" }
 *                     label: { type: string, enum: [New, Building, Established, Trusted, Excellent] }
 *                     completedJobs: { type: integer }
 *                     disputeRate: { type: number, description: "0–1" }
 *                     avgResponseHours: { type: number, nullable: true }
 *                     avgRating: { type: number, nullable: true }
 *                     ratingCount: { type: integer }
 *                     referralQuality: { type: number, description: "0–1" }
 *                     updatedAt: { type: string, format: date-time }
 *       400:
 *         description: Invalid public key
 *       404:
 *         description: No profile for this address
 */
router.get("/:userId", readRateLimiter, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!/^G[A-Z0-9]{55}$/.test(userId)) {
      return res.status(400).json({ error: "Invalid public key" });
    }

    const reputation = await getReputation(userId);
    if (!reputation) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.set("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: reputation });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
