/**
 * src/routes/progress.js
 *
 * @swagger
 * tags:
 *   name: Progress
 *   description: Job progress tracking
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { addProgressUpdate, getProgressUpdates } = require("../services/progressService");

/**
 * @swagger
 * /api/progress/{jobId}:
 *   get:
 *     summary: Get progress updates for a job
 *     tags: [Progress]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Progress updates retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get("/:jobId", async (req, res, next) => {
  try {
    const updates = await getProgressUpdates(req.params.jobId);
    res.json({ success: true, data: updates });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/progress:
 *   post:
 *     summary: Add a progress update
 *     tags: [Progress]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - description
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *               description:
 *                 type: string
 *               percentage:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *     responses:
 *       200:
 *         description: Progress update created
 */
router.post("/", async (req, res, next) => {
  try {
    const update = await addProgressUpdate(req.body);
    res.json({ success: true, data: update });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
