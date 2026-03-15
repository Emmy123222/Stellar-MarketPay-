/**
 * src/routes/jobs.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { createJob, getJob, listJobs, listJobsByClient } = require("../services/jobService");

// GET /api/jobs — list jobs (with optional ?category=&status=&limit=)
router.get("/", (req, res, next) => {
  try {
    const { category, status, limit } = req.query;
    res.json({ success: true, data: listJobs({ category, status, limit: parseInt(limit) || 50 }) });
  } catch (e) { next(e); }
});

// GET /api/jobs/client/:publicKey — list jobs posted by a client
router.get("/client/:publicKey", (req, res, next) => {
  try { res.json({ success: true, data: listJobsByClient(req.params.publicKey) }); }
  catch (e) { next(e); }
});

// GET /api/jobs/:id — get single job
router.get("/:id", (req, res, next) => {
  try { res.json({ success: true, data: getJob(req.params.id) }); }
  catch (e) { next(e); }
});

// POST /api/jobs — create a new job
router.post("/", (req, res, next) => {
  try {
    const job = createJob(req.body);
    res.status(201).json({ success: true, data: job });
  } catch (e) { next(e); }
});

module.exports = router;
