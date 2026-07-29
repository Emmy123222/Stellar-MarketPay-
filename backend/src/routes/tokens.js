/**
 * src/routes/tokens.js
 * Stellar token routes for custom token support
 *
 * @swagger
 * tags:
 *   name: Tokens
 *   description: Stellar token registry and metadata
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { 
  getTokenMetadata, 
  getTokenBalance, 
  validateTokenContract,
  getPopularTokens,
  searchTokens 
} = require("../services/tokenService");

// Rate limiting: 30 requests per minute
const tokenRateLimiter = createRateLimiter(30, 1);

/**
 * @swagger
 * /api/tokens:
 *   get:
 *     summary: List supported tokens (cached 1 hour)
 *     tags: [Tokens]
 *     responses:
 *       200:
 *         description: Token list
 */
router.get("/", tokenRateLimiter, async (_req, res, next) => {
  try {
    const tokens = getPopularTokens();
    res.json({
      success: true,
      data: tokens,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/tokens/popular:
 *   get:
 *     summary: Get popular tokens
 *     tags: [Tokens]
 *     responses:
 *       200:
 *         description: Popular tokens list
 */
router.get("/popular", tokenRateLimiter, async (req, res, next) => {
  try {
    const tokens = getPopularTokens();
    res.json({
      success: true,
      data: tokens
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/tokens/search:
 *   get:
 *     summary: Search tokens by name or symbol
 *     tags: [Tokens]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Missing search query
 */
router.get("/search", tokenRateLimiter, async (req, res, next) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        error: "Search query is required"
      });
    }

    const tokens = await searchTokens(q);
    res.json({
      success: true,
      data: tokens
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/tokens/{contractId}/metadata:
 *   get:
 *     summary: Get token metadata by contract ID
 *     tags: [Tokens]
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token metadata
 */
router.get("/:contractId/metadata", tokenRateLimiter, async (req, res, next) => {
  try {
    const { contractId } = req.params;
    
    const metadata = await getTokenMetadata(contractId);
    res.json({
      success: true,
      data: metadata
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/tokens/{contractId}/balance/{publicKey}:
 *   get:
 *     summary: Get token balance for an account
 *     tags: [Tokens]
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token balance
 */
router.get("/:contractId/balance/:publicKey", tokenRateLimiter, async (req, res, next) => {
  try {
    const { contractId, publicKey } = req.params;
    
    const balance = await getTokenBalance(publicKey, contractId);
    res.json({
      success: true,
      data: balance
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/tokens/validate:
 *   post:
 *     summary: Validate if a contract is a token contract
 *     tags: [Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contractId
 *             properties:
 *               contractId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Validation result
 *       400:
 *         description: Missing contract ID
 */
router.post("/validate", tokenRateLimiter, async (req, res, next) => {
  try {
    const { contractId } = req.body;
    
    if (!contractId) {
      return res.status(400).json({
        success: false,
        error: "Contract ID is required"
      });
    }

    const validation = await validateTokenContract(contractId);
    res.json({
      success: true,
      data: validation
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
