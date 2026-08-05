/**
 * src/routes/faucet.js
 * Stellar testnet faucet routes
 *
 * @swagger
 * tags:
 *   name: Faucet
 *   description: Testnet XLM faucet
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { fundTestnetWallet, checkAccountNeedsFunding, isTestnet } = require("../services/faucetService");

// Rate limiting: configurable via FAUCET_RATE_LIMIT env var
// Development default: 20/min, Production default: 5/min
const isDev = process.env.NODE_ENV !== 'production';
const faucetMaxRequests = parseInt(process.env.FAUCET_RATE_LIMIT, 10) || (isDev ? 20 : 5);
const faucetRateLimiter = createRateLimiter(faucetMaxRequests, 60);

/**
 * @swagger
 * /api/faucet/fund:
 *   post:
 *     summary: Fund a testnet wallet
 *     tags: [Faucet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicKey
 *             properties:
 *               publicKey:
 *                 type: string
 *                 description: Stellar public key to fund
 *     responses:
 *       200:
 *         description: Wallet funded successfully
 *       400:
 *         description: Missing public key
 *       403:
 *         description: Faucet only available on testnet
 */
router.post("/fund", faucetRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.body;

    if (!publicKey) {
      return res.status(400).json({ error: "Public key is required" });
    }

    // Check if we're on testnet
    if (!isTestnet()) {
      return res.status(403).json({ error: "Faucet only available on testnet" });
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
 * @swagger
 * /api/faucet/check/{publicKey}:
 *   get:
 *     summary: Check if an account needs funding
 *     tags: [Faucet]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account funding status
 *       403:
 *         description: Faucet only available on testnet
 */
router.get("/check/:publicKey", async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    if (!publicKey) {
      return res.status(400).json({ error: "Public key is required" });
    }

    // Check if we're on testnet
    if (!isTestnet()) {
      return res.status(403).json({ error: "Faucet only available on testnet" });
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
 * @swagger
 * /api/faucet/status:
 *   get:
 *     summary: Get faucet status and configuration
 *     tags: [Faucet]
 *     responses:
 *       200:
 *         description: Faucet status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     network:
 *                       type: string
 *                     amount:
 *                       type: string
 *                     asset:
 *                       type: string
 *                     rateLimitPerMinute:
 *                       type: integer
 */
router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: {
      enabled: isTestnet(),
      network: "testnet",
      amount: "10000",
      asset: "XLM",
      rateLimitPerMinute: faucetMaxRequests
    }
  });
});

module.exports = router;
