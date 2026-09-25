"use strict";

const rateLimit = require("express-rate-limit");

/**
 * Factory function to create reusable rate limiters
 */
const createRateLimiter = (maxRequests, windowMinutes) => {
  const scale = Number(process.env.RATE_LIMIT_SCALE) || 1;
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests * scale,
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

module.exports = { createRateLimiter };
