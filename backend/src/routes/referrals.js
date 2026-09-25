/**
 * src/routes/referrals.js
 *
 * GET  /api/referrals/info               — public: bonus percentage info
 * GET  /api/referrals/my-stats           — dashboard pipeline for the caller (auth required)
 * GET  /api/referrals/:publicKey         — referral history & earnings (auth required)
 * POST /api/referrals/register           — record a new referral on signup
 *
 * @swagger
 * tags:
 *   name: Referrals
 *   description: Referral program management
 */
"use strict";

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const {
  registerReferral,
  getReferralStats,
  getMyReferralStats,
  REFERRAL_BONUS_BPS,
} = require("../services/referralService");

const router = express.Router();
const generalRateLimiter = createRateLimiter(60, 1);

/**
 * @swagger
 * /api/referrals/info:
 *   get:
 *     summary: Get referral bonus info (public)
 *     tags: [Referrals]
 *     responses:
 *       200:
 *         description: Referral bonus percentage
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     bonusBps:
 *                       type: integer
 *                     bonusPercent:
 *                       type: string
 *                     description:
 *                       type: string
 */
router.get("/info", (req, res) => {
  res.json({
    success: true,
    data: {
      bonusBps: REFERRAL_BONUS_BPS,
      bonusPercent: (REFERRAL_BONUS_BPS / 100).toFixed(0),
      description: `Earn ${REFERRAL_BONUS_BPS / 100}% of your referee's first job earnings`,
    },
  });
});

/**
 * @swagger
 * /api/referrals/my-stats:
 *   get:
 *     summary: Referral dashboard stats for the authenticated referrer
 *     description: >
 *       Returns total referred users, pending and paid credits, the caller's
 *       referral link and a paginated table of referees with their pipeline
 *       status (registered / first_job_completed / credit_paid).
 *     tags: [Referrals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [registered, first_job_completed, credit_paid]
 *     responses:
 *       200:
 *         description: Referral dashboard stats
 *       400:
 *         description: Invalid query parameter
 *       401:
 *         description: Unauthorized
 */
router.get("/my-stats", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const publicKey = req.user?.publicKey;
    if (!publicKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { page, limit, status } = req.query;
    const stats = await getMyReferralStats(publicKey, { page, limit, status });
    res.json({ success: true, data: stats });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/referrals/{publicKey}:
 *   get:
 *     summary: Get referral stats and history
 *     tags: [Referrals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Referral stats
 *       403:
 *         description: Can only view own referral data
 */
router.get(
  "/:publicKey",
  verifyJWT,
  generalRateLimiter,
  async (req, res, next) => {
    try {
      const { publicKey } = req.params;

      if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
        return res.status(400).json({ error: "Invalid public key" });
      }

      // Users may only fetch their own referral data
      if (req.user?.publicKey && req.user.publicKey !== publicKey) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const stats = await getReferralStats(publicKey);
      res.json({ success: true, data: stats });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @swagger
 * /api/referrals/register:
 *   post:
 *     summary: Register a new referral
 *     tags: [Referrals]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - referrerAddress
 *               - refereeAddress
 *             properties:
 *               referrerAddress:
 *                 type: string
 *               refereeAddress:
 *                 type: string
 *     responses:
 *       200:
 *         description: Referral registered (or already exists)
 */
router.post("/register", generalRateLimiter, async (req, res, next) => {
  try {
    const { referrerAddress, refereeAddress } = req.body;

    if (!referrerAddress || !refereeAddress) {
      return res.status(400).json({ error: "referrerAddress and refereeAddress are required" });
    }

    const referral = await registerReferral(referrerAddress, refereeAddress);
    res.json({
      success: true,
      data: referral,
      message: referral ? "Referral registered" : "Referral already exists",
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
