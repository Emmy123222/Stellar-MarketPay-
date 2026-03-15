/**
 * src/routes/escrow.js
 * Escrow management endpoints.
 * In v1 this records escrow state in memory.
 * In v1.2 this will invoke the Soroban contract directly.
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { escrows } = require("../services/store");
const { getJob, updateJobStatus } = require("../services/jobService");

/**
 * POST /api/escrow/:jobId/release
 * Client approves work and releases escrow to freelancer.
 *
 * In v1.2 this will call the Soroban contract's release_escrow() function.
 * See ROADMAP.md v1.2 — Escrow Contract (Live).
 */
router.post("/:jobId/release", (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { clientAddress } = req.body;

    if (!clientAddress || !/^G[A-Z0-9]{55}$/.test(clientAddress)) {
      const e = new Error("Invalid client address"); e.status = 400; throw e;
    }

    const job = getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can release escrow"); e.status = 403; throw e;
    }
    if (job.status !== "in_progress") {
      const e = new Error("Job is not in progress"); e.status = 400; throw e;
    }

    // Record escrow release
    const escrowRecord = {
      jobId,
      client:     job.clientAddress,
      freelancer: job.freelancerAddress,
      amount:     job.budget,
      status:     "released",
      releasedAt: new Date().toISOString(),
      // TODO v1.2: contractTxHash — Soroban transaction hash
    };
    escrows.set(jobId, escrowRecord);

    // Update job status
    updateJobStatus(jobId, "completed");

    res.json({ success: true, data: escrowRecord });
  } catch (e) { next(e); }
});

/**
 * GET /api/escrow/:jobId
 * Get escrow state for a job.
 */
router.get("/:jobId", (req, res, next) => {
  try {
    const record = escrows.get(req.params.jobId);
    if (!record) { const e = new Error("No escrow record found for this job"); e.status = 404; throw e; }
    res.json({ success: true, data: record });
  } catch (e) { next(e); }
});

module.exports = router;
