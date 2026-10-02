"use strict";

const net = require("net");
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

/**
 * RFC-1918 private and loopback ranges that must never be reachable via a
 * webhook URL.  We block these at registration time so we never even attempt
 * an outbound connection to an internal address.
 *
 * Covered ranges (IPv4):
 *   Loopback   : 127.0.0.0/8
 *   RFC-1918   : 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   Link-local : 169.254.0.0/16  (AWS/GCP metadata endpoint lives here)
 *   Localhost  : ::1 (IPv6 loopback)
 */
const BLOCKED_IP_PATTERNS = [
  /^127\./,                        // loopback
  /^10\./,                         // RFC-1918
  /^172\.(1[6-9]|2\d|3[01])\./,   // RFC-1918
  /^192\.168\./,                   // RFC-1918
  /^169\.254\./,                   // link-local (AWS metadata)
  /^::1$/,                         // IPv6 loopback
  /^fc00:/i,                       // IPv6 unique local
  /^fd[0-9a-f]{2}:/i,              // IPv6 unique local
  /^0\./,                          // 0.0.0.0/8
];

/**
 * Returns true when the hostname component of a URL resolves to a private or
 * loopback address that must be blocked.  Pure numeric IPs are checked
 * directly; hostnames are checked by pattern against the literal string only
 * (full DNS resolution happens at delivery time via ssrf-req-filter).
 */
function isBlockedHost(hostname) {
  // node's URL parser keeps IPv6 brackets: "[::1]" — strip them so net.isIP()
  // and the pattern regexes work correctly.
  const bare = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  // If the hostname is already a bare IP address, check it directly.
  if (net.isIP(bare)) {
    return BLOCKED_IP_PATTERNS.some((re) => re.test(bare));
  }
  // Block "localhost" and variants regardless of case.
  if (/^localhost$/i.test(bare)) {
    return true;
  }
  return false;
}

/**
 * Validate that a webhook URL:
 *   1. Uses the https scheme only (http is rejected — traffic must be encrypted).
 *   2. Does not target a private/loopback IP or "localhost".
 *
 * Returns an error message string when invalid, or null when the URL is safe.
 */
function validateWebhookUrl(rawUrl) {
  // Must start with https:// — no http, ftp, file, etc.
  if (!rawUrl || !/^https:\/\//i.test(rawUrl)) {
    return "Webhook URL must use the https scheme";
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Webhook URL is not a valid URL";
  }

  if (isBlockedHost(parsed.hostname)) {
    return "Webhook URL must not target a private or loopback address";
  }

  return null;
}

router.post("/", verifyJWT, webhookRateLimiter, async (req, res, next) => {
  try {
    const { url, events, secret } = req.body;

    const urlError = validateWebhookUrl(url);
    if (urlError) {
      throw createError(ErrorCodes.VALIDATION_ERROR, urlError, 400);
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
