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
