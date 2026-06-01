/**
 * src/routes/escrow.js
 */
"use strict";

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");

const escrowActionRateLimiter = createRateLimiter(30, 1);

const router = express.Router();
const pool = require("../db/pool");
const { getJob } = require("../services/jobService");
const { logContractInteraction } = require("../services/contractAuditService");
const {
  notifyEscrowEvent,
  EVENT_TYPES,
} = require("../services/notificationService");
const { processReferralPayout } = require("../services/referralService");

/**
 * POST /api/escrow/:jobId/release
 */
router.post("/:jobId/release", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress, contractTxHash } = req.body;

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

    // Fetch escrow amount for referral bonus calculation.
    // DB status is updated asynchronously by the indexer when it processes the on-chain event.
    const { rows: escrowRows } = await pool.query(
      `SELECT amount_xlm FROM escrows WHERE job_id = $1`,
      [jobId],
    );

    // Process referral bonus payout (2% of earnings to referrer on referee's first job).
    // The on-chain transfer is handled by the Soroban contract's release_escrow();
    // this records the payout in the DB and updates referral status.
    const amountXlm = escrowRows.length ? escrowRows[0].amount_xlm : "0";
    const referralResult = await processReferralPayout(
      jobId,
      job.freelancerAddress,
      amountXlm,
      contractTxHash || null,
    );

    res.json({
      success: true,
      message: "Escrow released and job completed",
      ...(referralResult && {
        referralBonus: {
          referrer: referralResult.referrer,
          bonusXlm: referralResult.bonusXlm,
        },
      }),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/escrow/:jobId/partial_release
 */
router.post(
  "/:jobId/partial_release",
  escrowActionRateLimiter,
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { clientAddress, contractTxHash } = req.body;

      if (!clientAddress || !/^G[A-Z0-9]{55}$/.test(clientAddress)) {
        const e = new Error("Invalid client address");
        e.status = 400;
        throw e;
      }

      const job = await getJob(jobId);

      if (job.clientAddress !== clientAddress) {
        const e = new Error("Only the job client can release milestones");
        e.status = 403;
        throw e;
      }

      await logContractInteraction({
        functionName: "partial_release",
        callerAddress: clientAddress,
        jobId,
        txHash: contractTxHash || `offchain-${Date.now()}`,
      });

      // Notify users about escrow release
      await notifyEscrowEvent({
        eventType: EVENT_TYPES.ESCROW_RELEASED,
        jobId,
        clientAddress: job.clientAddress,
        freelancerAddress: job.freelancerAddress,
        data: {
          jobTitle: job.title,
          jobId,
          amount: job.budget,
          currency: job.currency,
        },
      });

      res.json({ success: true, message: "Escrow released and job completed" });
    } catch (e) {
      next(e);
    }
  },
);

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
      const e = new Error("Only the job client can refund escrow");
      e.status = 403;
      throw e;
    }

    // DB status is updated asynchronously by the indexer when it processes the on-chain event.

    await logContractInteraction({
      functionName: "refund_escrow",
      callerAddress: clientAddress,
      jobId,
      txHash: contractTxHash || `offchain-${Date.now()}`,
    });

    // Notify users about refund
    await notifyEscrowEvent({
      eventType: EVENT_TYPES.REFUND_ISSUED,
      jobId,
      clientAddress: job.clientAddress,
      freelancerAddress: job.freelancerAddress,
      data: {
        jobTitle: job.title,
        jobId,
        amount: job.budget,
        currency: job.currency,
      },
    });

    res.json({ success: true, message: "Escrow refunded" });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/escrow/:jobId/timeout-refund
 * Issue #175 — Client claims refund after freelancer inactivity timeout.
 */
router.post("/:jobId/timeout-refund", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress, contractTxHash } = req.body;
    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can request a timeout refund");
      e.status = 403;
      throw e;
    }

    // DB status is updated asynchronously by the indexer when it processes the on-chain event.

    await logContractInteraction({
      functionName: "timeout_refund",
      callerAddress: clientAddress,
      jobId,
      txHash: contractTxHash || `offchain-${Date.now()}`,
    });

    res.json({
      success: true,
      message: "Escrow refunded due to inactivity timeout",
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/escrow/:jobId
 */
router.get("/:jobId", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM escrows WHERE job_id = $1",
      [req.params.jobId],
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
