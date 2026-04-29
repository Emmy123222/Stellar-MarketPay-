/**
 * src/routes/profiles.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const pool    = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");

const profileUpdateRateLimiter = createRateLimiter(5, 1); // 5 profile updates per minute
const generalProfileRateLimiter = createRateLimiter(30, 1); // 100 requests per minute for getting profiles

const { getProfile, upsertProfile, updateAvailability, getSkillEndorsements, endorseSkill } = require("../services/profileService");
const {
  upsertPriceAlertPreference,
  getPriceAlertPreference,
} = require("../services/priceAlertService");

router.get("/:publicKey", generalProfileRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await getProfile(req.params.publicKey) }); }
  catch (e) { next(e); }
});

router.get("/:publicKey/stats", generalProfileRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await getProfileStats(req.params.publicKey) }); }
  catch (e) { next(e); }
});

router.get("/:publicKey/response-time", generalProfileRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await getResponseTime(req.params.publicKey) }); }
  catch (e) { next(e); }
});

router.post("/", profileUpdateRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await upsertProfile(req.body) }); }
  catch (e) { next(e); }
});

router.post("/:publicKey/availability", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await updateAvailability(req.params.publicKey, req.body),
    });
  }
  catch (e) { next(e); }
});

// POST /api/profiles/:publicKey/block — block a freelancer
router.post("/:publicKey/block", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    if (req.user.publicKey !== req.params.publicKey) {
      return res.status(403).json({ error: "You can only manage your own block list" });
    }
    const { address } = req.body;
    const profile = await blockFreelancer(req.params.publicKey, address);
    res.json({ success: true, data: profile });
  } catch (e) { next(e); }
});

// DELETE /api/profiles/:publicKey/block/:address — unblock a freelancer
router.delete("/:publicKey/block/:address", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    if (req.user.publicKey !== req.params.publicKey) {
      return res.status(403).json({ error: "You can only manage your own block list" });
    }
    const profile = await unblockFreelancer(req.params.publicKey, req.params.address);
    res.json({ success: true, data: profile });
  } catch (e) { next(e); }
});

// GET /api/profiles/:publicKey/earnings — freelancer earnings history (Issue #181)
router.get("/:publicKey/earnings", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    const { rows: payments } = await pool.query(
      `SELECT
         e.id,
         e.job_id,
         e.amount_xlm,
         e.released_at,
         j.title  AS job_title,
         j.client_address
       FROM escrows e
       JOIN jobs j ON e.job_id = j.id
       WHERE j.freelancer_address = $1
         AND e.status = 'released'
       ORDER BY e.released_at DESC`,
      [publicKey]
    );

    const { rows: monthly } = await pool.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', e.released_at), 'YYYY-MM') AS month,
         SUM(e.amount_xlm)::numeric                             AS total_xlm
       FROM escrows e
       JOIN jobs j ON e.job_id = j.id
       WHERE j.freelancer_address = $1
         AND e.status = 'released'
         AND e.released_at >= NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', e.released_at)
       ORDER BY DATE_TRUNC('month', e.released_at)`,
      [publicKey]
    );

    const totalXlm = payments.reduce((sum, p) => sum + parseFloat(p.amount_xlm || 0), 0);

    res.json({
      success: true,
      data: {
        totalXlm: totalXlm.toFixed(7),
        payments: payments.map((p) => ({
          id: p.id,
          jobId: p.job_id,
          jobTitle: p.job_title,
          amountXlm: p.amount_xlm,
          releasedAt: p.released_at,
          clientAddress: p.client_address,
        })),
        monthly: monthly.map((m) => ({
          month: m.month,
          totalXlm: parseFloat(m.total_xlm),
        })),
      },
    });
  } catch (e) { next(e); }
});

module.exports = router;
