"use strict";

const express = require("express");
const router = express.Router();

/**
 * GET /api/events/:jobId
 * Returns indexed contract events for a specific job in chronological order.
 */
router.get("/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const indexerService = req.app.locals.indexerService;

    if (!indexerService) {
      const err = Object.assign(new Error("Indexer service not available"), { status: 503 });
      return next(err);
    }

    const events = await indexerService.getEventsForJob(jobId);
    res.json(events);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
