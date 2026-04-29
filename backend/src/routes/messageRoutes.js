/**
 * src/routes/messageRoutes.js
 * Private messaging endpoints for job participants.
 */

"use strict";
const express = require("express");
const router  = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");

const messageService = require("../services/messageService");
const generalRateLimiter = createRateLimiter(60, 1); // 60 req/min for message operations

// ─── POST /api/messages/job/:jobId ───────────────────────────────────────────
// Send a message in a job thread.
// Requires authentication. User must be job participant.
router.post("/job/:jobId", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { content } = req.body;
    const senderAddress = req.user.publicKey;

    if (!content || typeof content !== "string") {
      return res.status(400).json({ success: false, error: "Message content is required" });
    }

    const message = await messageService.createMessage({
      jobId,
      senderAddress,
      content: content.trim(),
    });

    res.status(201).json({ success: true, data: message });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/messages/job/:jobId ────────────────────────────────────────────
// Retrieve all messages for a job.
// Requires authentication. User must be job participant.
// Marks messages as read for the requesting user.
router.get("/job/:jobId", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const userAddress = req.user.publicKey;

    const messages = await messageService.getMessagesByJob(jobId, userAddress);
    res.json({ success: true, data: messages });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/messages/unread-count ─────────────────────────────────────────
// Get total unread message count for the authenticated user.
router.get("/unread-count", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const userAddress = req.user.publicKey;
    const count = await messageService.getUnreadCount(userAddress);
    res.json({ success: true, data: { unreadCount: count } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
