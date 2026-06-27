/**
 * src/routes/tokens.js
 * Stellar token routes for custom token support
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
 * GET /api/tokens/popular
 * Get list of popular tokens
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
 * GET /api/tokens/search
 * Search for tokens by name or symbol
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
 * GET /api/tokens/:contractId/metadata
 * Get token metadata
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
 * GET /api/tokens/:contractId/balance/:publicKey
 * Get token balance for an account
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
 * POST /api/tokens/validate
 * Validate if a contract is a token contract
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
