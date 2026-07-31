"use strict";

const express = require("express");
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { createError, ErrorCodes } = require("../utils/errors");
const { registerWebhook } = require("../services/webhookService");
const { EVENT_TYPES } = require("../services/notificationService");

const router = express.Router();
const webhookRateLimiter = createRateLimiter(10, 1);

const ALLOWED_ESCROW_EVENTS = new Set([
  EVENT_TYPES.ESCROW_CREATED,
  EVENT_TYPES.ESCROW_RELEASED,
  EVENT_TYPES.REFUND_ISSUED,
  EVENT_TYPES.DISPUTE_OPENED,
]);

router.post("/", verifyJWT, webhookRateLimiter, async (req, res, next) => {
  try {
    const { url, events, secret } = req.body;

    if (!url || !/^https?:\/\//i.test(url)) {
      throw createError(ErrorCodes.VALIDATION_ERROR, "A valid webhook URL is required", 400);
    }

    if (!Array.isArray(events) || events.length === 0) {
      throw createError(ErrorCodes.VALIDATION_ERROR, "At least one webhook event is required", 400);
    }

    const normalizedEvents = [...new Set(events.map((event) => String(event).trim()))];
    if (normalizedEvents.some((event) => !ALLOWED_ESCROW_EVENTS.has(event))) {
      throw createError(ErrorCodes.VALIDATION_ERROR, "Unsupported webhook event", 400);
    }

    if (!secret || typeof secret !== "string" || secret.trim().length < 8) {
      throw createError(ErrorCodes.VALIDATION_ERROR, "Webhook secret must be at least 8 characters", 400);
    }

    const webhook = await registerWebhook({
      userAddress: req.user.publicKey,
      url: url.trim(),
      events: normalizedEvents,
      secret: secret.trim(),
    });

    res.status(201).json({
      success: true,
      data: {
        id: webhook.id,
        userAddress: webhook.user_address,
        url: webhook.url,
        events: webhook.events,
        createdAt: webhook.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
