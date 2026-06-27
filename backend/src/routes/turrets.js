/**
 * src/routes/turrets.js
 * Stellar Turrets routes for serverless contract execution
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { 
  submitTransaction,
  getTurretStatus,
  estimateTurretFee,
  shouldUseTurret
} = require("../services/turretsService");

// Rate limiting: 10 requests per minute for transaction submissions
const turretRateLimiter = createRateLimiter(10, 60);

/**
 * POST /api/turrets/submit
 * Submit transaction via Turret (with fallback)
 */
router.post("/submit", turretRateLimiter, async (req, res, next) => {
  try {
    const { transactionXDR, useTurret } = req.body;
    
    if (!transactionXDR) {
      return res.status(400).json({
        success: false,
        error: "Transaction XDR is required"
      });
    }

    const options = { useTurret };
    const result = await submitTransaction(transactionXDR, options);
    
    res.json({
      success: true,
      data: result
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/turrets/status
 * Get Turret service status
 */
router.get("/status", async (req, res, next) => {
  try {
    const status = await getTurretStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/turrets/estimate
 * Estimate transaction fees via Turret
 */
router.post("/estimate", turretRateLimiter, async (req, res, next) => {
  try {
    const { transactionXDR } = req.body;
    
    if (!transactionXDR) {
      return res.status(400).json({
        success: false,
        error: "Transaction XDR is required"
      });
    }

    const estimation = await estimateTurretFee(transactionXDR);
    res.json({
      success: true,
      data: estimation
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/turrets/config
 * Get Turret configuration
 */
router.get("/config", (req, res) => {
  const TURRET_URL = process.env.TURRET_URL;
  const TURRET_API_KEY = process.env.TURRET_API_KEY;
  
  res.json({
    success: true,
    data: {
      configured: !!TURRET_URL,
      url: TURRET_URL || null,
      hasApiKey: !!TURRET_API_KEY,
      shouldUseByDefault: shouldUseTurret()
    }
  });
});

module.exports = router;
