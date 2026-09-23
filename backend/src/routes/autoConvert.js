/**
 * src/routes/autoConvert.js
 *
 * Issue #1560: Auto-convert XLM earnings to USDC after each escrow release.
 *
 * GET   /api/auto-convert/settings            — current opt-in + slippage (auth)
 * PATCH /api/auto-convert/settings            — toggle / set slippage (auth)
 * GET   /api/auto-convert/pending             — pending swaps with fresh quotes (auth)
 * POST  /api/auto-convert/:id/complete        — record a submitted swap tx (auth)
 * POST  /api/auto-convert/:id/dismiss         — mark a pending swap failed / skipped (auth)
 * GET   /api/auto-convert/history             — paginated conversion history (auth)
 *
 * @swagger
 * tags:
 *   name: AutoConvert
 *   description: Opt-in XLM → USDC conversion of earnings
 */
"use strict";

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const {
  getAutoConvertSettings,
  updateAutoConvertSettings,
  listPendingConversions,
  completeAutoConversion,
  dismissAutoConversion,
  listConversionHistory,
} = require("../services/autoConvertService");

const router = express.Router();
const readRateLimiter = createRateLimiter(60, 1);
const writeRateLimiter = createRateLimiter(20, 1);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(verifyJWT);

function requireUser(req, res) {
  const publicKey = req.user?.publicKey;
  if (!publicKey) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return publicKey;
}

function requireUuid(req, res) {
  if (!UUID_RE.test(req.params.id)) {
    res.status(400).json({ error: "Invalid conversion id" });
    return false;
  }
  return true;
}

/**
 * @swagger
 * /api/auto-convert/settings:
 *   get:
 *     summary: Get auto-convert settings for the authenticated user
 *     tags: [AutoConvert]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Settings
 *   patch:
 *     summary: Update auto-convert settings
 *     tags: [AutoConvert]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               slippageBps: { type: integer, minimum: 10, maximum: 1000 }
 *     responses:
 *       200:
 *         description: Updated settings
 */
router.get("/settings", readRateLimiter, async (req, res, next) => {
  try {
    const publicKey = requireUser(req, res);
    if (!publicKey) return;
    res.json({ success: true, data: await getAutoConvertSettings(publicKey) });
  } catch (e) {
    next(e);
  }
});

router.patch("/settings", writeRateLimiter, async (req, res, next) => {
  try {
    const publicKey = requireUser(req, res);
    if (!publicKey) return;
    const { enabled, slippageBps } = req.body || {};
    const data = await updateAutoConvertSettings(publicKey, { enabled, slippageBps });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/auto-convert/pending:
 *   get:
 *     summary: List pending XLM → USDC conversions with fresh path quotes
 *     tags: [AutoConvert]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending conversions
 */
router.get("/pending", readRateLimiter, async (req, res, next) => {
  try {
    const publicKey = requireUser(req, res);
    if (!publicKey) return;
    res.json({ success: true, data: await listPendingConversions(publicKey) });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/auto-convert/history:
 *   get:
 *     summary: Paginated auto-conversion payment history
 *     tags: [AutoConvert]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: Conversion history
 */
router.get("/history", readRateLimiter, async (req, res, next) => {
  try {
    const publicKey = requireUser(req, res);
    if (!publicKey) return;
    const { page, limit } = req.query;
    res.json({ success: true, data: await listConversionHistory(publicKey, { page, limit }) });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/auto-convert/{id}/complete:
 *   post:
 *     summary: Record a submitted pathPaymentStrictSend swap
 *     description: Verifies the transaction on Horizon and stores amounts and exchange rate.
 *     tags: [AutoConvert]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [txHash]
 *             properties:
 *               txHash: { type: string }
 *     responses:
 *       200:
 *         description: Conversion recorded
 *       400:
 *         description: Transaction does not match the pending conversion
 *       409:
 *         description: Conversion is not pending or tx already recorded
 */
router.post("/:id/complete", writeRateLimiter, async (req, res, next) => {
  try {
    const publicKey = requireUser(req, res);
    if (!publicKey || !requireUuid(req, res)) return;
    const data = await completeAutoConversion(publicKey, req.params.id, {
      txHash: req.body?.txHash,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/auto-convert/{id}/dismiss:
 *   post:
 *     summary: Mark a pending conversion as failed or skipped
 *     tags: [AutoConvert]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [failed, skipped] }
 *               error: { type: string }
 *     responses:
 *       200:
 *         description: Conversion dismissed
 */
router.post("/:id/dismiss", writeRateLimiter, async (req, res, next) => {
  try {
    const publicKey = requireUser(req, res);
    if (!publicKey || !requireUuid(req, res)) return;
    const { status, error } = req.body || {};
    const data = await dismissAutoConversion(publicKey, req.params.id, { status, error });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
