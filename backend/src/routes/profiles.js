/**
 * src/routes/profiles.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");

const profileUpdateRateLimiter = createRateLimiter(5, 1); // 5 profile updates per minute
const generalProfileRateLimiter = createRateLimiter(30, 1); // 100 requests per minute for getting profiles

const { getProfile, upsertProfile, updateAvailability, blockFreelancer, unblockFreelancer } = require("../services/profileService");

router.get("/:publicKey", generalProfileRateLimiter ,async (req, res, next) => {
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

module.exports = router;
