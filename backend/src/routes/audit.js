"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT, requireAdminRole } = require("../middleware/auth");
const { getJob } = require("../services/jobService");
const { getAuditLogsForJob } = require("../services/contractAuditService");
const pool = require("../db/pool");

const adminList = (process.env.ADMIN_PUBLIC_KEYS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

// GET /api/audit — admin-only audit log list with cursor pagination
router.get("/", verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const { action, resource_type, from, to, limit = "50", after } = req.query;
    const maxLimit = Math.min(parseInt(limit, 10) || 50, 100);

    // Build cursor condition from `after` (base64-encoded id)
    let cursorValue = null;
    if (after) {
      try {
        cursorValue = Buffer.from(after, "base64").toString("utf8");
      } catch {
        return res.status(400).json({ error: "Invalid cursor" });
      }
    }

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (action) {
      conditions.push(`action = $${paramIdx}`);
      params.push(action);
      paramIdx++;
    }

    if (resource_type) {
      conditions.push(`metadata->>'targetType' = $${paramIdx}`);
      params.push(resource_type);
      paramIdx++;
    }

    if (from) {
      conditions.push(`created_at >= $${paramIdx}`);
      params.push(new Date(from).toISOString());
      paramIdx++;
    }

    if (to) {
      conditions.push(`created_at <= $${paramIdx}`);
      params.push(new Date(to).toISOString());
      paramIdx++;
    }

    if (cursorValue) {
      conditions.push(`id < $${paramIdx}`);
      params.push(cursorValue);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const { rows } = await pool.query(
      `SELECT id, actor_address as "adminAddress", action, target as "resource", 
              created_at as "timestamp", metadata->'changes' as "changesDiff"
       FROM audit_logs 
       ${whereClause}
       ORDER BY created_at DESC 
       LIMIT 100`,
      params
    );

    const nextCursor = rows.length === maxLimit
      ? Buffer.from(rows[rows.length - 1].id).toString("base64")
      : null;

    return res.json({ success: true, data: rows, nextCursor });
  } catch (error) {
    return next(error);
  }
});

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
