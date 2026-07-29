/**
 * src/routes/gasEstimator.js
 * Exposes Soroban dynamic fee estimates to the frontend.
 *
 * GET  /api/gas-estimate          — returns Slow/Medium/Fast fee tiers
 * POST /api/gas-estimate/refresh  — force-refresh the cached estimate
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
 * GET /api/gas-estimate
 * Returns the current fee estimate with optional USD conversion.
 *
 * Query params:
 *   currency  — "XLM" (default) | "USD"  — include USD values when "USD"
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
 * POST /api/gas-estimate/refresh
 * Force-bypasses the cache and fetches fresh fee data from Horizon.
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
