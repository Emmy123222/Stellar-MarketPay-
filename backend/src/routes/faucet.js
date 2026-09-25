/**
 * src/routes/faucet.js
 * Stellar testnet faucet routes
 */
"use strict";
const express = require("express");
const router = express.Router();
const {
  createSensitiveRateLimiters,
  createRateLimiter,
  hashRateLimitIdentifier,
} = require("../middleware/rateLimiter");
const { RedisRateLimitStore } = require("../middleware/redisRateLimitStore");
const {
  fundTestnetWallet,
  checkAccountNeedsFunding,
  isTestnet,
} = require("../services/faucetService");

// Rate limiting: configurable via FAUCET_RATE_LIMIT env var
// Development default: 20/min, Production default: 5/min
const isDev = process.env.NODE_ENV !== "production";
const faucetMaxRequests = parseInt(process.env.FAUCET_RATE_LIMIT, 10) || (isDev ? 20 : 5);
const [faucetIpLimiter, faucetPrincipalLimiter] = createSensitiveRateLimiters({
  namespace: "faucet",
  windowMinutes: 60,
  maxRequestsPerIp: faucetMaxRequests,
  maxRequestsPerPrincipal: faucetMaxRequests,
  principalKeyGenerator: (req) => req.body?.publicKey || req.params?.publicKey,
});

// Strict per-wallet limit: 1 faucet request per wallet per 24 hours.
// This prevents a single wallet address from draining testnet XLM through
// rotating proxies, since the IP-based limiters can be bypassed by
// forwarding requests through different IPs.
const faucetWalletLimiter = createRateLimiter(1, 24 * 60, {
  store: new RedisRateLimitStore({ prefix: "faucet:wallet:" }),
  keyGenerator: (req) =>
    hashRateLimitIdentifier("wallet", req.body?.publicKey || req.params?.publicKey),
  requestPropertyName: "rateLimit_faucet_wallet",
  legacyHeaders: false,
});

/**
 * @swagger
 * /api/faucet/fund:
 *   post:
 *     summary: Fund a Stellar testnet wallet via Friendbot
 *     description: >
 *       Funds the given Stellar account with testnet XLM using Friendbot.
 *       Enforced testnet-only: if the configured Horizon URL is not a
 *       testnet URL (HORIZON_URL env var), the request is rejected with 403.
 *       If the account already has a non-zero native balance it is not
 *       re-funded (the service still responds 200, with `success: false`
 *       in the payload). Rate limited per IP and per wallet address. The
 *       per-IP limit is configurable via FAUCET_RATE_LIMIT (defaults to 20/min
 *       in development, 5/min in production), with a fixed 60-minute window.
 *       A strict per-wallet limit of 1 request per 24 hours is enforced in
 *       Redis to prevent draining testnet XLM through rotating proxies.
 *     tags: [Faucet]
 *     x-rate-limit:
 *       limit: 20
 *       windowMinutes: 60
 *     x-rate-limit-wallet:
 *       limit: 1
 *       windowMinutes: 1440
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
 *                 description: Stellar public key (G...) to fund on testnet
 *                 example: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *           example:
 *             publicKey: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *     responses:
 *       200:
 *         description: >
 *           Funding attempted. `data.success` is `false` (with no error
 *           status) when the account already holds a non-zero XLM balance
 *           and Friendbot was not called.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     message:
 *                       type: string
 *                     fundedAmount:
 *                       type: string
 *                     newBalance:
 *                       type: string
 *                     currentBalance:
 *                       type: string
 *                     transactionHash:
 *                       type: string
 *                     ledger:
 *                       type: integer
 *             examples:
 *               funded:
 *                 summary: Newly funded account
 *                 value:
 *                   success: true
 *                   data:
 *                     success: true
 *                     message: Successfully funded testnet wallet
 *                     fundedAmount: "10000.0000000"
 *                     newBalance: "10000.0000000"
 *                     transactionHash: a1b2c3d4e5f6
 *                     ledger: 123456
 *               alreadyFunded:
 *                 summary: Account already has a balance
 *                 value:
 *                   success: true
 *                   data:
 *                     success: false
 *                     message: Account already has testnet XLM balance
 *                     currentBalance: "9500.0000000"
 *                     fundedAmount: "0"
 *       400:
 *         description: Missing publicKey, or Friendbot rejected the address as invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Public key is required
 *       403:
 *         description: Faucet is disabled because the server is not configured for testnet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Faucet only available on testnet
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: Unexpected error while funding the wallet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: Unable to connect to the Stellar testnet Horizon server
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Unable to connect to Stellar testnet
 */
router.post("/fund", faucetIpLimiter, faucetPrincipalLimiter, faucetWalletLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.body;

    if (!publicKey) {
      return res.status(400).json({
        success: false,
        error: "Public key is required",
      });
    }

    // Check if we're on testnet
    if (!isTestnet()) {
      return res.status(403).json({
        success: false,
        error: "Faucet only available on testnet",
      });
    }

    const result = await fundTestnetWallet(publicKey);

    res.json({
      success: true,
      data: result,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/faucet/check/{publicKey}:
 *   get:
 *     summary: Check whether a testnet account needs funding
 *     description: >
 *       Looks up the account's current native XLM balance on the configured
 *       Horizon server and reports whether it needs funding (balance is
 *       zero or the account does not exist yet). Enforced testnet-only, like
 *       POST /api/faucet/fund. The same shared IP + public-key limiter
 *       is applied to this route.
 *     tags: [Faucet]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G...) to check
 *         example: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *     responses:
 *       200:
 *         description: Account funding status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     needsFunding:
 *                       type: boolean
 *                     currentBalance:
 *                       type: string
 *                     exists:
 *                       type: boolean
 *             examples:
 *               existingFundedAccount:
 *                 summary: Account exists and already has a balance
 *                 value:
 *                   success: true
 *                   data:
 *                     needsFunding: false
 *                     currentBalance: "9500.0000000"
 *                     exists: true
 *               nonExistentAccount:
 *                 summary: Account has not been created on-chain yet
 *                 value:
 *                   success: true
 *                   data:
 *                     needsFunding: true
 *                     currentBalance: "0"
 *                     exists: false
 *       400:
 *         description: Public key missing or not a valid Stellar address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Public key is required
 *       403:
 *         description: Faucet is disabled because the server is not configured for testnet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Faucet only available on testnet
 *       500:
 *         description: Unexpected error while checking the account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/check/:publicKey", faucetIpLimiter, faucetPrincipalLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    if (!publicKey) {
      return res.status(400).json({
        success: false,
        error: "Public key is required",
      });
    }

    // Check if we're on testnet
    if (!isTestnet()) {
      return res.status(403).json({
        success: false,
        error: "Faucet only available on testnet",
      });
    }

    const result = await checkAccountNeedsFunding(publicKey);

    res.json({
      success: true,
      data: result,
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
 *     description: >
 *       Returns static faucet configuration: whether the faucet is enabled
 *       (true only when the server is configured against a testnet Horizon
 *       URL), the network name, the fixed Friendbot funding amount, the
 *       asset, and the currently effective per-minute rate limit. Has no
 *       auth or rate-limit middleware.
 *     tags: [Faucet]
 *     responses:
 *       200:
 *         description: Faucet status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                       description: True only when the Horizon URL points at testnet
 *                     network:
 *                       type: string
 *                       example: testnet
 *                     amount:
 *                       type: string
 *                       description: Amount of XLM Friendbot funds per request
 *                       example: "10000"
 *                     asset:
 *                       type: string
 *                       example: XLM
 *                     rateLimitPerMinute:
 *                       type: integer
 *                       description: Effective FAUCET_RATE_LIMIT applied to POST /api/faucet/fund
 *                       example: 20
 *             example:
 *               success: true
 *               data:
 *                 enabled: true
 *                 network: testnet
 *                 amount: "10000"
 *                 asset: XLM
 *                 rateLimitPerMinute: 20
 */
router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: {
      enabled: isTestnet(),
      network: "testnet",
      amount: "10000",
      asset: "XLM",
      rateLimitPerMinute: faucetMaxRequests,
    },
  });
});

module.exports = router;
