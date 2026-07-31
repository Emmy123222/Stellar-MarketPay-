/**
 * src/routes/turrets.js
 * Stellar Turrets routes for serverless contract execution
 *
 * @swagger
 * tags:
 *   name: Turrets
 *   description: Stellar Turrets for serverless contract execution
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  submitTransaction,
  signTransaction,
  getTurretStatus,
  estimateTurretFee,
  shouldUseTurret,
} = require("../services/turretsService");

// Rate limiting: 10 requests per minute for transaction submissions
const turretRateLimiter = createRateLimiter(10, 60);

/**
 * POST /api/turrets/sign
 * Sign a transaction XDR using the Turret signing key.
 * Only authorized escrow transactions are signed.
 */
router.post("/sign", turretRateLimiter, async (req, res, next) => {
  try {
    const { transactionXDR, escrowId } = req.body;

    if (!transactionXDR) {
      return res.status(400).json({
        success: false,
        error: "Transaction XDR is required",
      });
    }

    if (!escrowId) {
      return res.status(400).json({
        success: false,
        error: "Escrow ID is required for authorization",
      });
    }

    const result = await signTransaction(transactionXDR, escrowId);

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
 * /api/turrets/submit:
 *   post:
 *     summary: Submit transaction via Turret
 *     tags: [Turrets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionXDR
 *             properties:
 *               transactionXDR:
 *                 type: string
 *               useTurret:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Transaction submitted
 */
router.post("/submit", turretRateLimiter, async (req, res, next) => {
  try {
    const { transactionXDR, useTurret } = req.body;
    
    if (!transactionXDR) {
      return res.status(400).json({ error: "Transaction XDR is required" });
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
 * @swagger
 * /api/turrets/status:
 *   get:
 *     summary: Get Turret service status
 *     tags: [Turrets]
 *     responses:
 *       200:
 *         description: Turret status
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
 * @swagger
 * /api/turrets/estimate:
 *   post:
 *     summary: Estimate transaction fees via Turret
 *     tags: [Turrets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionXDR
 *             properties:
 *               transactionXDR:
 *                 type: string
 *     responses:
 *       200:
 *         description: Fee estimation
 */
router.post("/estimate", turretRateLimiter, async (req, res, next) => {
  try {
    const { transactionXDR } = req.body;
    
    if (!transactionXDR) {
      return res.status(400).json({ error: "Transaction XDR is required" });
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
 * @swagger
 * /api/turrets/config:
 *   get:
 *     summary: Get Turret configuration
 *     tags: [Turrets]
 *     responses:
 *       200:
 *         description: Turret config
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
