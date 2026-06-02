/**
 * src/routes/referrals.js
 *
 * GET  /api/referrals/info               — public: bonus percentage info
 * GET  /api/referrals/:publicKey         — referral history & earnings (auth required)
 * POST /api/referrals/register           — record a new referral on signup
 */
"use strict";

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const {
  registerReferral,
  getReferralStats,
  REFERRAL_BONUS_BPS,
} = require("../services/referralService");

const router = express.Router();
const generalRateLimiter = createRateLimiter(60, 1);

/**
 * GET /api/referrals/info
 * Public — returns the current bonus percentage so the frontend can display it.
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
 * GET /api/referrals/:publicKey
 * Returns referral stats and history for the given referrer address.
 * Requires JWT auth — users can only view their own referral data.
 */
router.get(
  "/:publicKey",
  verifyJWT,
  generalRateLimiter,
  async (req, res, next) => {
    try {
      const { publicKey } = req.params;

      if (!/^G[A-Z0-9]{55}$/.test(publicKey)) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid public key" });
      }

      // Users may only fetch their own referral data
      if (req.user?.publicKey && req.user.publicKey !== publicKey) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }

      const stats = await getReferralStats(publicKey);
      res.json({ success: true, data: stats });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * POST /api/referrals/register
 * Called during profile creation when a ?ref= query param was present.
 * Body: { referrerAddress, refereeAddress }
 */
router.post("/register", generalRateLimiter, async (req, res, next) => {
  try {
    const { referrerAddress, refereeAddress } = req.body;

    if (!referrerAddress || !refereeAddress) {
      return res.status(400).json({
        success: false,
        error: "referrerAddress and refereeAddress are required",
      });
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
