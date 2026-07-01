"use strict";

const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT, requireAdminRole } = require("../middleware/auth");
const daoService = require("../services/daoService");

const daoRateLimiter = createRateLimiter(60, 1);

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

router.get("/treasury", daoRateLimiter, async (req, res, next) => {
  try {
    const summary = await daoService.getTreasurySummary();
    res.json({ success: true, data: summary });
  } catch (e) {
    next(e);
  }
});

router.get("/arbitrators", daoRateLimiter, async (req, res, next) => {
  try {
    const arbitrators = await daoService.listArbitrators();
    const panel = await daoService.getTopArbitratorPanel(3);
    res.json({ success: true, data: { arbitrators, disputePanel: panel } });
  } catch (e) {
    next(e);
  }
});

router.get("/arbitrators/:publicKey", daoRateLimiter, async (req, res, next) => {
  try {
    const arbitrators = await daoService.listArbitrators();
    const found = arbitrators.find((a) => a.publicKey === req.params.publicKey);
    if (!found) {
      return res.status(404).json({ success: false, error: "Arbitrator not found" });
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

router.post("/proposals/:id/execute", verifyJWT, requireAdminRole, daoRateLimiter, async (req, res, next) => {
  try {
    const proposal = await daoService.executeProposal(req.params.id);
    res.json({ success: true, data: proposal });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
