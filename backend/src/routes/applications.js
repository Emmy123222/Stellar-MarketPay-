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
} = require("../services/applicationService");
const { logContractInteraction } = require("../services/contractAuditService");

/**
 * @swagger
 * /api/applications/job/{jobId}:
 *   get:
 *     summary: Get applications for a job
 *     description: Returns all applications submitted for a specific job
 *     tags: [Applications]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Applications retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Application'
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @swagger
 * /api/applications:
 *   post:
 *     summary: Submit a job application
 *     description: Submit a proposal/application for a job
 *     tags: [Applications]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - freelancerId
 *               - proposal
 *               - bidAmount
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *                 description: Job ID
 *               freelancerId:
 *                 type: string
 *                 description: Freelancer's Stellar address
 *               proposal:
 *                 type: string
 *                 description: Application proposal
 *               bidAmount:
 *                 type: number
 *                 description: Bid amount in XLM
 *               estimatedDuration:
 *                 type: string
 *                 description: Estimated completion time
 *     responses:
 *       201:
 *         description: Application submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Application'
 *       400:
 *         description: Bad request - invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Conflict - already applied to this job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
    res.json({ success: true, data: app });
  } catch (e) { next(e); }
});

module.exports = router;
