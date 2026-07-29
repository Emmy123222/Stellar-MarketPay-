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

router.get("/jobs", apiKeyRateLimiter("public_jobs"), async (req, res, next) => {
  try {
    const jobs = await listPublicJobs(req.query.limit);
    res.json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
});

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
