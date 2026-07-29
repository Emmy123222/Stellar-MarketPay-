/**
 * src/routes/timeEntries.js
 * Time tracking and billing endpoints — Issue #346
 *
 * POST /api/time-entries                    — log a time entry
 * GET  /api/time-entries/job/:jobId         — get all entries for a job
 * GET  /api/time-entries/job/:jobId/invoices — get all invoices for a job
 * POST /api/time-entries/invoice            — generate invoice from entries
 * PATCH /api/time-entries/invoice/:invoiceId/review — client approves/rejects
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
 * POST /api/time-entries
 * Log a time entry for a job.
 *
 * Body: { jobId, freelancerAddress, durationMinutes, description?, startedAt? }
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
 * GET /api/time-entries/job/:jobId
 * Get all time entries for a job.
 * Accessible by the job's client or freelancer (JWT required).
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
 * GET /api/time-entries/job/:jobId/invoices
 * Get all invoices for a job.
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
 * POST /api/time-entries/invoice
 * Generate an invoice from time entries.
 *
 * Body: { jobId, hourlyRateXlm, entryIds? }
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
 * PATCH /api/time-entries/invoice/:invoiceId/review
 * Client approves or rejects an invoice.
 *
 * Body: { decision: "approved" | "rejected", contractTxHash? }
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
