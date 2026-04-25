/**
 * src/routes/escrow.js
 * Escrow management endpoints.
 * In v1 this records escrow state in memory.
 * In v1.2 this will invoke the Soroban contract directly.
 */
"use strict";
const express = require("express");
const { createRateLimiter } = require("../middleware/rateLimiter");

const escrowActionRateLimiter = createRateLimiter(30, 1); // 10 escrow actions per minute

const router  = express.Router();
const pool = require("../db/pool");
const { getJob, updateJobStatus } = require("../services/jobService");

/**
 * POST /api/escrow/:jobId/release
 * Client approves work and releases escrow to freelancer.
 *
 * In v1.2 this will call the Soroban contract's release_escrow() function.
 * See ROADMAP.md v1.2 — Escrow Contract (Live).
 */
router.post("/:jobId/release", async (req, res, next) => {
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

    // Record escrow release in DB
    await pool.query(
      `UPDATE escrows 
       SET status = 'released', released_at = NOW(), updated_at = NOW() 
       WHERE job_id = $1`,
      [jobId]
    );

    // Update job status
    await updateJobStatus(jobId, "completed");

    res.json({ success: true, message: "Escrow released and job completed" });
  } catch (e) { next(e); }
});

/**
 * GET /api/escrow/:jobId
 * Get escrow state for a job.
 */
router.get("/:jobId", escrowActionRateLimiter ,async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM escrows WHERE job_id = $1", [req.params.jobId]);
    if (!rows.length) { const e = new Error("No escrow record found for this job"); e.status = 404; throw e; }
    res.json({ success: true, data: rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
