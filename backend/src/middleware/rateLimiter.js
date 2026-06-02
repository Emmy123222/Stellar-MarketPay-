"use strict";

const rateLimit = require("express-rate-limit");
const { getClientIp } = require("../utils/clientIp");

/**
 * Factory function to create reusable rate limiters
 */
const createRateLimiter = (maxRequests, windowMinutes) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: true,
    keyGenerator: (req) => getClientIp(req),
    handler: (req, res) => {
      res.set("Retry-After", Math.ceil(windowMinutes * 60));
      return res.status(429).json({
        message: "Too many requests — please wait before trying again",
      });
    },
  });
};

module.exports = { createRateLimiter };
