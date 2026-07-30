/**
 * src/routes/priceAlerts.js
 * Dedicated price alerts route — issue #887
 * POST   /api/price-alerts        — create a new price alert
 * GET    /api/price-alerts        — list active alerts for the authenticated user
 * DELETE /api/price-alerts/:id    — delete a price alert
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  createPriceAlert,
  listPriceAlerts,
  deletePriceAlert,
} = require("../services/priceAlertService");

const priceAlertRateLimiter = createRateLimiter(10, 1); // 10 req/min

/**
 * POST /api/price-alerts
 * Create a new price alert (condition: above/below, threshold: number)
 * Body: { condition: "above"|"below", threshold: number, oneTime?: boolean }
 */
router.post("/", verifyJWT, priceAlertRateLimiter, async (req, res, next) => {
  try {
    const { condition, threshold, oneTime } = req.body;
    const userAddress = req.user.publicKey;

    const alert = await createPriceAlert({
      userAddress,
      condition,
      threshold,
      oneTime: oneTime !== false, // default true
    });

    res.status(201).json({
      success: true,
      data: {
        id: alert.id,
        userAddress: alert.user_address,
        condition: alert.condition,
        threshold: alert.threshold,
        oneTime: alert.one_time,
        triggered: alert.triggered,
        triggeredAt: alert.triggered_at,
        createdAt: alert.created_at,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/price-alerts
 * List all price alerts for the authenticated user.
 */
router.get("/", verifyJWT, priceAlertRateLimiter, async (req, res, next) => {
  try {
    const userAddress = req.user.publicKey;
    const alerts = await listPriceAlerts(userAddress);

    res.json({
      success: true,
      data: alerts.map((a) => ({
        id: a.id,
        userAddress: a.user_address,
        condition: a.condition,
        threshold: a.threshold,
        oneTime: a.one_time,
        triggered: a.triggered,
        triggeredAt: a.triggered_at,
        createdAt: a.created_at,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/price-alerts/:id
 * Delete a price alert by ID.
 */
router.delete("/:id", verifyJWT, priceAlertRateLimiter, async (req, res, next) => {
  try {
    const userAddress = req.user.publicKey;
    await deletePriceAlert(req.params.id, userAddress);

    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
