/**
 * src/routes/faucet.js
 * Stellar testnet faucet routes
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { fundTestnetWallet, checkAccountNeedsFunding, isTestnet } = require("../services/faucetService");

// Rate limiting: 1 request per minute per IP for faucet
const faucetRateLimiter = createRateLimiter(1, 60);

/**
 * POST /api/faucet/fund
 * Fund a testnet wallet using Friendbot
 */
router.post("/fund", faucetRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.body;

    if (!publicKey) {
      return res.status(400).json({
        success: false,
        error: "Public key is required"
      });
    }

    // Check if we're on testnet
    if (!isTestnet()) {
      return res.status(403).json({
        success: false,
        error: "Faucet only available on testnet"
      });
    }

    const result = await fundTestnetWallet(publicKey);
    
    res.json({
      success: true,
      data: result
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/faucet/check/:publicKey
 * Check if an account needs funding
 */
router.get("/check/:publicKey", async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    if (!publicKey) {
      return res.status(400).json({
        success: false,
        error: "Public key is required"
      });
    }

    // Check if we're on testnet
    if (!isTestnet()) {
      return res.status(403).json({
        success: false,
        error: "Faucet only available on testnet"
      });
    }

    const result = await checkAccountNeedsFunding(publicKey);
    
    res.json({
      success: true,
      data: result
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/faucet/status
 * Get faucet status and configuration
 */
router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: {
      enabled: isTestnet(),
      network: "testnet",
      amount: "10000",
      asset: "XLM"
    }
  });
});

module.exports = router;
