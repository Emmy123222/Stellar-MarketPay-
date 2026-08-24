/**
 * src/routes/escrow.js
 *
 * @swagger
 * tags:
 *   name: Escrow
 *   description: Escrow management (release, refund, milestones, recurring)
 */
"use strict";

const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");

const escrowActionRateLimiter = createRateLimiter(30, 1);

const router = express.Router();
const pool = require("../db/pool");
const { getJob, updateJobStatus } = require("../services/jobService");
const { logContractInteraction, verifyOnChainTransaction } = require("../services/contractAuditService");
const { insertAuditLog } = require("../services/auditLogService");
const {
  notifyEscrowEvent,
  EVENT_TYPES,
} = require("../services/notificationService");
const { processReferralPayout } = require("../services/referralService");
const {
  timeoutRefund,
  releaseMilestone,
  rejectMilestone,
  disputeMilestone,

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

    // Fetch escrow amount and status for referral bonus and audit log.
    // DB status is updated asynchronously by the indexer when it processes the on-chain event.
    const { rows: escrowRows } = await pool.query(
      `SELECT amount_xlm, status FROM escrows WHERE job_id = $1`,
      [jobId],
    );
    const escrowStatus = escrowRows.length ? escrowRows[0].status : null;

    if (!escrowRows.length) {
      const e = new Error("No escrow record found for this job");
      e.status = 400;
      throw e;
    }

    // Process referral bonus payout (2% of earnings to referrer on referee's first job).
    // The on-chain transfer is handled by the Soroban contract's release_escrow();
    // this records the payout in the DB and updates referral status.
    const amountXlm = escrowRows[0].amount_xlm;
    const escrowAmountNum = parseFloat(amountXlm);

    // Bug #850: Validate escrow amount consistency before release.
    if (isNaN(escrowAmountNum) || escrowAmountNum <= 0) {
      const e = new Error("Escrow amount is missing or invalid");
      e.status = 400;
      throw e;
    }
    const referralResult = await processReferralPayout(
      jobId,
      job.freelancerAddress,
      amountXlm,
      contractTxHash || null,
    );
    await updateJobStatus(jobId, "completed");

    // Audit log the escrow release event
    try {
      await insertAuditLog({
        actorAddress: clientAddress,
        action: "escrow_release",
        entityType: "escrow",
        entityId: jobId,
        oldValue: { jobStatus: job.status, escrowStatus },
        newValue: { jobStatus: "completed", escrowStatus: "released" },
      });
    } catch {
      // Non-fatal
    }

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

      const txInfo = await verifyOnChainTransaction(contractTxHash);
      const txHashInner = contractTxHash || `offchain-${Date.now()}`;

      await logContractInteraction({
        functionName: "partial_release",
        callerAddress: clientAddress,
        jobId,
        txHash: txHashInner,
        ledgerSequence: txInfo ? txInfo.ledgerSequence : undefined,
        feeCharged: txInfo ? txInfo.feeCharged : undefined,
        eventData: txInfo ? txInfo.eventData : undefined,
      });

      // Notify users about escrow release
      const { rows: escrowRows } = await pool.query(
        `SELECT amount_xlm FROM escrows WHERE job_id = $1`,
        [jobId],
      );
      const escrowAmount = escrowRows.length ? escrowRows[0].amount_xlm : job.budget;

      await notifyEscrowEvent({
        eventType: EVENT_TYPES.ESCROW_RELEASED,
        jobId,
        clientAddress: job.clientAddress,
        freelancerAddress: job.freelancerAddress,
        data: {
          jobTitle: job.title,
          jobId,
          amount: escrowAmount,
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

    const txInfo = await verifyOnChainTransaction(contractTxHash);
    const txHashInner = contractTxHash || `offchain-${Date.now()}`;

    await logContractInteraction({
      functionName: "refund_escrow",
      callerAddress: clientAddress,
      jobId,
      txHash: txHashInner,
      ledgerSequence: txInfo ? txInfo.ledgerSequence : undefined,
      feeCharged: txInfo ? txInfo.feeCharged : undefined,
      eventData: txInfo ? txInfo.eventData : undefined,
    });

    // Notify users about refund
    const { rows: escrowRows } = await pool.query(
      `SELECT amount_xlm FROM escrows WHERE job_id = $1`,
      [jobId],
    );
    const escrowAmount = escrowRows.length ? escrowRows[0].amount_xlm : job.budget;

    await notifyEscrowEvent({
      eventType: EVENT_TYPES.REFUND_ISSUED,
      jobId,
      clientAddress: job.clientAddress,
      freelancerAddress: job.freelancerAddress,
      data: {
        jobTitle: job.title,
        jobId,
        amount: escrowAmount,
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
    const result = await timeoutRefund(jobId, clientAddress, contractTxHash, req);

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

    await verifyFreelancerAccount(freelancerAddress);

    res.json({ success: true, data: { freelancerAddress, exists: true } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
