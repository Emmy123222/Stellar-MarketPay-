/**
 * src/routes/timeEntries.js
 * Time tracking and billing endpoints — Issue #346
 *
 * @swagger
 * tags:
 *   name: Time Entries
 *   description: Time tracking and invoicing
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  logTimeEntry,
  getTimeEntriesForJob,
  generateInvoice,
  getInvoicesForJob,
  reviewInvoice,
} = require("../services/timeTrackingService");

const readLimiter   = createRateLimiter(60, 1);
const writeLimiter  = createRateLimiter(30, 1);

/**
 * @swagger
 * /api/time-entries:
 *   post:
 *     summary: Log a time entry for a job
 *     tags: [Time Entries]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - durationMinutes
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *               durationMinutes:
 *                 type: integer
 *               description:
 *                 type: string
 *               startedAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Time entry created
 */
router.post("/", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const { jobId, durationMinutes, description, startedAt } = req.body;
    const freelancerAddress = req.user.publicKey;

    const entry = await logTimeEntry({
      jobId,
      freelancerAddress,
      durationMinutes,
      description,
      startedAt,
    });

    res.status(201).json({ success: true, data: entry });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/time-entries/job/{jobId}:
 *   get:
 *     summary: Get time entries for a job
 *     tags: [Time Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Time entries list
 */
router.get("/job/:jobId", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const entries = await getTimeEntriesForJob(req.params.jobId);
    res.json({ success: true, data: entries });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/time-entries/job/{jobId}/invoices:
 *   get:
 *     summary: Get invoices for a job
 *     tags: [Time Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invoice list
 */
router.get("/job/:jobId/invoices", verifyJWT, readLimiter, async (req, res, next) => {
  try {
    const invoices = await getInvoicesForJob(req.params.jobId);
    res.json({ success: true, data: invoices });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/time-entries/invoice:
 *   post:
 *     summary: Generate invoice from time entries
 *     tags: [Time Entries]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - hourlyRateXlm
 *             properties:
 *               jobId:
 *                 type: string
 *               hourlyRateXlm:
 *                 type: number
 *               entryIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Invoice created
 */
router.post("/invoice", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const { jobId, hourlyRateXlm, entryIds } = req.body;
    const freelancerAddress = req.user.publicKey;

    const invoice = await generateInvoice({
      jobId,
      freelancerAddress,
      hourlyRateXlm,
      entryIds,
    });

    res.status(201).json({ success: true, data: invoice });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/time-entries/invoice/{invoiceId}/review:
 *   patch:
 *     summary: Client approves or rejects an invoice
 *     tags: [Time Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - decision
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [approved, rejected]
 *               contractTxHash:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invoice reviewed
 */
router.patch("/invoice/:invoiceId/review", verifyJWT, writeLimiter, async (req, res, next) => {
  try {
    const { invoiceId } = req.params;
    const { decision, contractTxHash } = req.body;
    const clientAddress = req.user.publicKey;

    const invoice = await reviewInvoice({
      invoiceId,
      clientAddress,
      decision,
      contractTxHash,
    });

    res.json({ success: true, data: invoice });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
