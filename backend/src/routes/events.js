"use strict";

const express = require("express");
const router = express.Router();

/**
 * GET /api/events/:jobId
 * Returns indexed contract events for a specific job in chronological order.
 */
router.get("/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const indexerService = req.app.locals.indexerService;

    if (!indexerService) {
      return res.status(500).json({ error: "Indexer service not available" });
    }

    const events = await indexerService.getEventsForJob(jobId);
    res.json(events);
  } catch (error) {
    console.error("[Events Route] error:", error.message);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

module.exports = router;
