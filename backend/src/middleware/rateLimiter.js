"use strict";

const rateLimit = require("express-rate-limit");
const pool = require("../db/pool");

const MAX_OPEN_DISPUTES = 3;
const MAX_DISPUTES_30_DAYS = 10;

/**
 * Factory function to create reusable rate limiters
 */
const createRateLimiter = (maxRequests, windowMinutes) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: true,
    handler: (req, res) => {
      res.set("Retry-After", Math.ceil(windowMinutes * 60));
      return res.status(429).json({
        message: "Too many requests — please wait before trying again",
      });
    },
  });
};

/**
 * Dispute-specific rate limiter.
 * Checks two limits before allowing a dispute to be created:
 *   1. Max 3 open disputes per user at any time.
 *   2. Max 10 disputes opened per 30-day rolling window per user.
 *
 * Admin users (from ADMIN_WALLET_ADDRESSES or role "admin") are exempt.
 * Returns 429 with a Retry-After header when a limit is exceeded.
 */
async function createDisputeRateLimiter(req, res, next) {
  try {
    const userKey = req.user?.publicKey;
    if (!userKey) return next();

    const adminAddresses = (process.env.ADMIN_WALLET_ADDRESSES || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const isAdmin =
      adminAddresses.includes(userKey) || req.user?.role === "admin";
    if (isAdmin) return next();

    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'disputed') AS open_count,
         COUNT(*) FILTER (WHERE disputed_at > NOW() - INTERVAL '30 days') AS recent_count
       FROM jobs
       WHERE disputed_by = $1`,
      [userKey],
    );

    const { open_count, recent_count } = rows[0];
    const openCount = parseInt(open_count, 10);
    const recentCount = parseInt(recent_count, 10);

    if (openCount >= MAX_OPEN_DISPUTES) {
      res.set("Retry-After", "3600");
      return res.status(429).json({
        success: false,
        error: `You already have ${openCount} open ${openCount === 1 ? "dispute" : "disputes"}. Maximum is ${MAX_OPEN_DISPUTES}. Resolve existing disputes before opening new ones.`,
      });
    }

    if (recentCount >= MAX_DISPUTES_30_DAYS) {
      res.set("Retry-After", "86400");
      return res.status(429).json({
        success: false,
        error: `You have opened ${recentCount} ${recentCount === 1 ? "dispute" : "disputes"} in the last 30 days. Maximum is ${MAX_DISPUTES_30_DAYS}. Please wait before opening more.`,
      });
    }

    next();
  } catch (err) {
    console.error("[disputeRateLimiter] Error:", err.message);
    next();
  }
}

module.exports = { createRateLimiter, createDisputeRateLimiter };
