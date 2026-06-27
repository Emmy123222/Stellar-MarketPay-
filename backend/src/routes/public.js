"use strict";

const express = require("express");
const router = express.Router();
const { createApiKeyRateLimiter, requireApiKey } = require("../middleware/apiKey");
const {
  listPublicJobs,
  getPublicJob,
  getPublicFreelancerProfile,
} = require("../services/developerService");

const publicApiLimiter = createApiKeyRateLimiter(100, 60);

router.use(requireApiKey, publicApiLimiter);

router.get("/jobs", async (req, res, next) => {
  try {
    const jobs = await listPublicJobs(req.query.limit);
    res.json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
});

router.get("/jobs/:id", async (req, res, next) => {
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

router.get("/freelancers/:publicKey", async (req, res, next) => {
  try {
    const profile = await getPublicFreelancerProfile(req.params.publicKey);
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
