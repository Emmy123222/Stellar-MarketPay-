/**
 * src/routes/profiles.js
 */
"use strict";
const express = require("express");
const router = express.Router();
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

// ─── Skill Endorsements ──────────────────────────────────────────────────────

router.post("/:publicKey/skill-endorsements", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const recipientAddress = req.params.publicKey;
    const endorserAddress = req.user.publicKey;
    const { skill } = req.body;

    if (!skill || typeof skill !== "string" || !skill.trim()) {
      return res.status(400).json({ error: "skill is required" });
    }

    if (endorserAddress === recipientAddress) {
      return res.status(400).json({ error: "Cannot endorse your own skill" });
    }

    await endorseSkill({ skill, endorserAddress, recipientAddress });
    res.status(201).json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ─── Skill Endorsements ──────────────────────────────────────────────────────

router.post("/:publicKey/skill-endorsements", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const recipientAddress = req.params.publicKey;
    const endorserAddress = req.user.publicKey;
    const { skill } = req.body;

    if (!skill || typeof skill !== "string" || !skill.trim()) {
      return res.status(400).json({ error: "skill is required" });
    }

    if (endorserAddress === recipientAddress) {
      return res.status(400).json({ error: "Cannot endorse your own skill" });
    }

    await endorseSkill({ skill, endorserAddress, recipientAddress });
    res.status(201).json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.get("/:publicKey/skill-endorsements", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const endorsements = await getSkillEndorsements(req.params.publicKey);
    res.json({ success: true, data: endorsements });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
