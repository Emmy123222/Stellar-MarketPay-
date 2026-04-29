"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { getJob } = require("../services/jobService");
const { getAuditLogsForJob } = require("../services/contractAuditService");

const adminList = (process.env.ADMIN_PUBLIC_KEYS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

router.get("/:jobId", verifyJWT, async (req, res, next) => {
  try {
    const job = await getJob(req.params.jobId);
    const caller = req.user.publicKey;
    const isParticipant = caller === job.clientAddress || caller === job.freelancerAddress;
    const isAdmin = adminList.includes(caller);
    if (!isParticipant && !isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rows = await getAuditLogsForJob(req.params.jobId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
