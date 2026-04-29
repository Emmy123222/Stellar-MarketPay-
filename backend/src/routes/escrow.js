/**
 * src/routes/escrow.js
 */
"use strict";

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");

const escrowActionRateLimiter = createRateLimiter(30, 1);

const router = express.Router();
const pool = require("../db/pool");
const { getJob, updateJobStatus } = require("../services/jobService");
const { logContractInteraction } = require("../services/contractAuditService");

/**
 * POST /api/escrow/:jobId/release
 */
router.post("/:jobId/release", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress, contractTxHash, releaseCurrency } = req.body;

    if (!clientAddress || !/^G[A-Z0-9]{55}$/.test(clientAddress)) {
      const e = new Error("Invalid client address");
      e.status = 400;
      throw e;
    }

    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can release escrow");
      e.status = 403;
      throw e;
    }

    if (job.status !== "in_progress") {
      const e = new Error("Job is not in progress");
      e.status = 400;
      throw e;
    }

    // Update escrow
    await pool.query(
      `UPDATE escrows 
       SET status = 'released', released_at = NOW(), updated_at = NOW() 
       WHERE job_id = $1`,
      [jobId]
    );

    // Update job
    await updateJobStatus(jobId, "completed");

    // Credit referrer if applicable
    const { rows: appRows } = await pool.query(
      "SELECT referred_by FROM applications WHERE job_id = $1 AND status = 'accepted'",
      [jobId]
    );
    if (appRows.length > 0 && appRows[0].referred_by) {
      const referrer = appRows[0].referred_by;
      await pool.query(
        "UPDATE profiles SET reputation_points = reputation_points + 5 WHERE public_key = $1",
        [referrer]
      );
    }

    res.json({ success: true, message: "Escrow released and job completed" });
  } catch (e) { next(e); }
});

/**
 * POST /api/escrow/:jobId/refund
 * Client issues a refund to close escrow.
 */
router.post("/:jobId/refund", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress, contractTxHash } = req.body;
    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can refund escrow"); e.status = 403; throw e;
    }

    await pool.query(
      `UPDATE escrows
       SET status = 'refunded', updated_at = NOW()
       WHERE job_id = $1`,
      [jobId]
    );
    await updateJobStatus(jobId, "cancelled");

    await logContractInteraction({
      functionName: "refund_escrow",
      callerAddress: clientAddress,
      jobId,
      txHash: contractTxHash || `offchain-${Date.now()}`,
    });

    res.json({ success: true, message: "Escrow refunded" });
  } catch (e) { next(e); }
});

/**
 * GET /api/escrow/:jobId
 */
router.get("/:jobId", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM escrows WHERE job_id = $1",
      [req.params.jobId]
    );

    if (!rows.length) {
      const e = new Error("No escrow record found for this job");
      e.status = 404;
      throw e;
    }

    res.json({
      success: true,
      data: rows[0],
    });

  } catch (e) {
    next(e);
  }
});

module.exports = router;