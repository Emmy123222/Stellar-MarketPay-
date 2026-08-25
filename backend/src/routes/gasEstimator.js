/**
 * src/routes/gasEstimator.js
 * Exposes Soroban dynamic fee estimates to the frontend.
 *
 * @swagger
 * tags:
 *   name: Gas
 *   description: Soroban gas fee estimation
 */
"use strict";

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { getSafeGasEstimate } = require("../services/gas_estimator");
const { getXlmUsd7dHistory } = require("../services/xlmPriceService");

const router = express.Router();

// Limit refresh endpoint: 10 calls per minute per IP
const refreshLimiter = createRateLimiter(10, 1);

/**
 * @swagger
 * /api/gas-estimate:
 *   get:
 *     summary: Get current Soroban fee estimate tiers
 *     tags: [Gas]
 *     parameters:
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *           enum: [XLM, USD]
 *         description: Include USD conversion when set to "USD"
 *     responses:
 *       200:
 *         description: Fee estimate tiers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/GasEstimate'
 */
router.get("/", async (req, res, next) => {
  try {
    let xlmUsd = null;

    if (req.query.currency === "USD") {
      try {
        const priceData = await getXlmUsd7dHistory();
        xlmUsd = priceData?.currentPriceUsd ?? null;
      } catch {
        // Non-fatal — USD values will be null
      }
    }

    const estimate = await getSafeGasEstimate({ xlmUsd });
    return res.json({ success: true, data: estimate });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/gas-estimate/refresh:
 *   post:
 *     summary: Force-refresh cached fee estimates
 *     tags: [Gas]
 *     responses:
 *       200:
 *         description: Fresh fee estimate tiers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/GasEstimate'
 */
router.post("/refresh", refreshLimiter, async (req, res, next) => {
  try {
    let xlmUsd = null;
    try {
      const priceData = await getXlmUsd7dHistory();
      xlmUsd = priceData?.currentPriceUsd ?? null;
    } catch {
      // Non-fatal
    }

    const estimate = await getSafeGasEstimate({ forceRefresh: true, xlmUsd });
    return res.json({ success: true, data: estimate });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
