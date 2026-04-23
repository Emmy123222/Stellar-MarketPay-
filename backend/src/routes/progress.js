/**
 * src/routes/progress.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { addProgressUpdate, getProgressUpdates } = require("../services/progressService");

router.get("/:jobId", async (req, res, next) => {
  try {
    const updates = await getProgressUpdates(req.params.jobId);
    res.json({ success: true, data: updates });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const update = await addProgressUpdate(req.body);
    res.json({ success: true, data: update });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
