/**
 * @swagger
 * tags:
 *   name: Events
 *   description: Contract event indexing
 *
 * /api/events/{jobId}:
 *   get:
 *     summary: Get indexed contract events for a job
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Contract events in chronological order
 *       500:
 *         description: Indexer service unavailable
 */
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
