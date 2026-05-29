"use strict";

const rateLimit = require("express-rate-limit");
const {
  findApiKeyByRawValue,
  recordApiKeyUsage,
} = require("../services/developerService");

function createApiKeyRateLimiter(maxRequests = 100, windowMinutes = 60) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.apiKey?.id || req.ip,
    handler: (req, res) => {
      res.set("Retry-After", String(windowMinutes * 60));
      return res.status(429).json({
        error: "Too many requests for this API key. Please try again later.",
      });
    },
  });
}

async function requireApiKey(req, res, next) {
  try {
    const rawKey = req.header("x-api-key") || req.header("X-API-Key");
    if (!rawKey) {
      return res.status(401).json({ error: "Missing API key" });
    }

    const apiKey = await findApiKeyByRawValue(rawKey);
    if (!apiKey || apiKey.revoked_at) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    req.apiKey = apiKey;
    await recordApiKeyUsage(apiKey.id);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createApiKeyRateLimiter,
  requireApiKey,
};
