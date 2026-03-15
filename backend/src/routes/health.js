/**
 * src/routes/health.js
 */
"use strict";
const express = require("express");
const router  = express.Router();

router.get("/", (req, res) => res.json({
  status: "ok", service: "stellar-marketpay-api",
  network: process.env.STELLAR_NETWORK || "testnet",
  timestamp: new Date().toISOString(),
}));

module.exports = router;
