/**
 * src/routes/applications.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");

const applicationRateLimiter = createRateLimiter(5, 1); // 100 requests per 15 minutes
const generalApplicationRateLimiter = createRateLimiter(30, 1); // 100 requests per minute for listing/getting applications

const {
  submitApplication, getApplicationsForJob,
  getApplicationsForFreelancer, acceptApplication,
  withdrawApplication,
} = require("../services/applicationService");
const { logContractInteraction } = require("../services/contractAuditService");
const { notifyEscrowEvent, EVENT_TYPES } = require("../services/notificationService");
const { getJob } = require("../services/jobService");

// GET /api/applications/job/:jobId
router.get("/job/:jobId", generalApplicationRateLimiter, async (req, res, next) => {
  try {
    const applications = await getApplicationsForJob(req.params.jobId);
    res.json({ success: true, data: applications });
  } catch (e) {
    next(e);
  }
});

// GET /api/applications/freelancer/:publicKey
router.get("/freelancer/:publicKey", generalApplicationRateLimiter, async (req, res, next) => {
  try {
    const applications = await getApplicationsForFreelancer(req.params.publicKey);
    res.json({ success: true, data: applications });
  } catch (e) {
    next(e);
  }
});

// POST /api/applications — submit a proposal
router.post("/", applicationRateLimiter, async (req, res, next) => {
  try {
    const app = await submitApplication(req.body);
    res.status(201).json({ success: true, data: app });
  } catch (e) { next(e); }
});

// POST /api/applications/:id/accept — client accepts a proposal
router.post("/:id/accept", applicationRateLimiter, async (req, res, next) => {
  try {
    const app = await acceptApplication(req.params.id, req.body.clientAddress);
    await logContractInteraction({
      functionName: "start_work",
      callerAddress: req.body.clientAddress,
      jobId: app.jobId,
      txHash: req.body.contractTxHash || `offchain-${Date.now()}`,
    });

    // Notify freelancer about accepted application
    const job = await getJob(app.jobId);
    await notifyEscrowEvent({
      eventType: EVENT_TYPES.APPLICATION_ACCEPTED,
      jobId: app.jobId,
      clientAddress: job.clientAddress,
      freelancerAddress: app.freelancerAddress,
      data: {
        jobTitle: job.title,
        jobId: app.jobId,
        amount: job.budget,
        currency: job.currency,
      },
    });

    res.json({ success: true, data: app });
  } catch (e) { next(e); }
});

// DELETE /api/applications/:id — freelancer withdraws their application
router.delete("/:id", applicationRateLimiter, async (req, res, next) => {
  try {
    const app = await withdrawApplication(req.params.id, req.body.freelancerAddress);
    res.json({ success: true, data: app });
  } catch (e) { next(e); }
});

module.exports = router;
