/**
 * src/routes/health.js
 */
"use strict";
const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");

const healthCheckRateLimiter = createRateLimiter(30, 1); // 100 requests per minute

const router  = express.Router();

router.get("/", healthCheckRateLimiter ,(req, res) => res.json({
  status: "ok", service: "stellar-marketpay-api",
  network: process.env.STELLAR_NETWORK || "testnet",
  timestamp: new Date().toISOString(),
  indexer: req.app.locals.indexerService ? req.app.locals.indexerService.getHealth() : null,
}));

module.exports = router;
