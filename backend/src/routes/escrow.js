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
const {
  notifyEscrowEvent,
  EVENT_TYPES,
} = require("../services/notificationService");
const { processReferralPayout } = require("../services/referralService");
const {
  releaseMilestone,
  rejectMilestone,
  disputeMilestone,
  submitDeliverableHash,

  verifyFreelancerAccount,
} = require("../services/escrowService");
const {
  createRecurringEscrow,
  cancelRecurringEscrow,
  getRecurringEscrow,
} = require("../services/recurringEscrowService");

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
    await updateJobStatus(jobId, "completed");

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
 * POST /api/escrow/:jobId/release-milestone
 */
router.post(
  "/:jobId/release-milestone",
  escrowActionRateLimiter,
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { clientAddress, contractTxHash, milestoneIndex } = req.body;

      if (!clientAddress || !/^G[A-Z0-9]{55}$/.test(clientAddress)) {
        const e = new Error("Invalid client address");
        e.status = 400;
        throw e;
      }

      const result = await releaseMilestone(
        jobId,
        milestoneIndex,
        clientAddress,
        contractTxHash,
      );
      res.json({ success: true, data: result });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * POST /api/escrow/:jobId/reject-milestone
 * Client rejects a single milestone; its share is refunded to the client
 * while the remaining milestones stay locked.
 */
router.post(
  "/:jobId/reject-milestone",
  escrowActionRateLimiter,
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { clientAddress, contractTxHash, milestoneIndex } = req.body;

      if (!clientAddress || !/^G[A-Z0-9]{55}$/.test(clientAddress)) {
        const e = new Error("Invalid client address");
        e.status = 400;
        throw e;
      }

      const result = await rejectMilestone(
        jobId,
        milestoneIndex,
        clientAddress,
        contractTxHash,
      );
      res.json({ success: true, data: result });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * POST /api/escrow/:jobId/dispute-milestone
 */
router.post(
  "/:jobId/dispute-milestone",
  escrowActionRateLimiter,
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { raisedBy, milestoneIndex } = req.body;

      if (!raisedBy || !/^G[A-Z0-9]{55}$/.test(raisedBy)) {
        const e = new Error("Invalid wallet address");
        e.status = 400;
        throw e;
      }

      const result = await disputeMilestone(jobId, milestoneIndex, raisedBy);
      res.json({ success: true, data: result });
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
 * Issue #536 — Uses service keypair with IP validation for contract calls.
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

    // Issue #536: Pass request for IP validation in service key usage
    const result = await escrowService.timeoutRefund(jobId, clientAddress, contractTxHash, req);

    // DB status is updated asynchronously by the indexer when it processes the on-chain event.

    res.json(result);
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

/**
 * POST /api/escrow/:jobId/recurring
 * Create a recurring escrow for retainer contracts (Issue #450)
 */
router.post("/:jobId/recurring", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { 
      clientAddress, 
      freelancerAddress, 
      contractId, 
      amountPerRelease, 
      currency, 
      intervalDays, 
      totalReleases 
    } = req.body;

    if (!clientAddress || !/^G[A-Z0-9]{55}$/.test(clientAddress)) {
      const e = new Error("Invalid client address");
      e.status = 400;
      throw e;
    }

    if (!freelancerAddress || !/^G[A-Z0-9]{55}$/.test(freelancerAddress)) {
      const e = new Error("Invalid freelancer address");
      e.status = 400;
      throw e;
    }

    if (!amountPerRelease || parseFloat(amountPerRelease) <= 0) {
      const e = new Error("Amount per release must be positive");
      e.status = 400;
      throw e;
    }

    if (!intervalDays || parseInt(intervalDays) <= 0) {
      const e = new Error("Interval days must be positive");
      e.status = 400;
      throw e;
    }

    if (!totalReleases || parseInt(totalReleases) <= 0) {
      const e = new Error("Total releases must be positive");
      e.status = 400;
      throw e;
    }

    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can create recurring escrow");
      e.status = 403;
      throw e;
    }

    const recurringEscrow = await createRecurringEscrow({
      jobId,
      clientAddress,
      freelancerAddress,
      contractId,
      amountPerRelease: parseFloat(amountPerRelease),
      currency,
      intervalDays: parseInt(intervalDays),
      totalReleases: parseInt(totalReleases),
    });

    res.json({
      success: true,
      message: "Recurring escrow created successfully",
      data: recurringEscrow,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/escrow/:jobId/recurring/cancel
 * Cancel a recurring escrow and refund remaining funds (Issue #450)
 */
router.post("/:jobId/recurring/cancel", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress } = req.body;

    if (!clientAddress || !/^G[A-Z0-9]{55}$/.test(clientAddress)) {
      const e = new Error("Invalid client address");
      e.status = 400;
      throw e;
    }

    const result = await cancelRecurringEscrow(jobId, clientAddress);

    res.json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/escrow/:jobId/recurring
 * Get recurring escrow details (Issue #450)
 */
router.get("/:jobId/recurring", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const recurringEscrow = await getRecurringEscrow(jobId);

    res.json({
      success: true,
      data: recurringEscrow,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/escrow/verify-freelancer
 * Verify that a freelancer Stellar account exists on the network before
 * creating an escrow.
 */
router.post("/verify-freelancer", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { freelancerAddress } = req.body;

    if (!freelancerAddress) {
      const e = new Error("freelancerAddress is required");
      e.status = 400;
      throw e;
    }

    if (!Number.isInteger(newTimeoutLedger) || newTimeoutLedger <= 0) {
      const e = new Error("newTimeoutLedger must be a positive integer");
      e.status = 400;
      throw e;
    }

    const result = await requestEscrowExtension(jobId, requestedBy, newTimeoutLedger);

    await logContractInteraction({
      functionName: "request_extension",
      callerAddress: requestedBy,
      jobId,
      txHash: `offchain-${Date.now()}`,
    });

    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/escrow/:jobId/extend/approve
 * Approve a pending escrow timeout extension request.
 * The caller must be the party that did NOT request the extension.
 */
router.post("/:jobId/extend/approve", escrowActionRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { approvedBy } = req.body;

    if (!approvedBy || !/^G[A-Z0-9]{55}$/.test(approvedBy)) {
      const e = new Error("Invalid wallet address");
      e.status = 400;
      throw e;
    }

    const result = await approveEscrowExtension(jobId, approvedBy);

    await logContractInteraction({
      functionName: "approve_extension",
      callerAddress: approvedBy,
      jobId,
      txHash: `offchain-${Date.now()}`,
    });

    res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
