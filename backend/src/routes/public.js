/**
 * @swagger
 * tags:
 *   name: Public API
 *   description: Public API endpoints for developers (require API key)
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireApiKey } = require("../middleware/apiKey");
const { apiKeyRateLimiter } = require("../middleware/apiKeyRateLimiter");
const {
  listPublicJobs,
  getPublicJob,
  getPublicFreelancerProfile,
} = require("../services/developerService");

// Issue #452: per-endpoint sliding window rate limit (60 req/min for jobs).
router.use(requireApiKey);

/**
 * @swagger
 * /api/public/jobs:
 *   get:
 *     summary: List public jobs (API key required)
 *     tags: [Public API]
 *     security:
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Max results
 *     responses:
 *       200:
 *         description: Jobs retrieved
 *       401:
 *         description: Missing or invalid API key
 */
router.get("/jobs", apiKeyRateLimiter("public_jobs"), async (req, res, next) => {
  try {
    const jobs = await listPublicJobs(req.query.limit);
    res.json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/public/jobs/{id}:
 *   get:
 *     summary: Get public job by ID (API key required)
 *     tags: [Public API]
 *     security:
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job retrieved
 *       404:
 *         description: Job not found
 */
router.get("/jobs/:id", apiKeyRateLimiter("public_job"), async (req, res, next) => {
  try {
    const job = await getPublicJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/public/freelancers/{publicKey}:
 *   get:
 *     summary: Get public freelancer profile (API key required)
 *     tags: [Public API]
 *     security:
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile retrieved
 *       404:
 *         description: Profile not found
 */
router.get(
  "/freelancers/:publicKey",
  apiKeyRateLimiter("public_freelancer"),
  async (req, res, next) => {
    try {
      const profile = await getPublicFreelancerProfile(req.params.publicKey);
      if (!profile) {
        return res.status(404).json({ error: "Profile not found" });
      }

      res.json({ success: true, data: profile });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
