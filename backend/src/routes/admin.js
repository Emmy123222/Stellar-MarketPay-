/**
 * src/routes/admin.js
 * Admin-only moderation routes — protected by JWT role=admin check.
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { verifyJWT } = require("../middleware/auth");
const { getJob, updateJobStatus } = require("../services/jobService");
const { logContractInteraction } = require("../services/contractAuditService");

// ── Admin Role Guard ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const adminAddresses = (process.env.ADMIN_WALLET_ADDRESSES || "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (!adminAddresses.includes(req.user.publicKey) && req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }
  next();
}

// Helper: log admin action
async function logAdminAction({ action, adminAddress, targetId, targetType, details }) {
  try {
    await pool.query(
      `INSERT INTO admin_action_logs (action, admin_address, target_id, target_type, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [action, adminAddress, targetId, targetType, JSON.stringify(details || {})]
    );
  } catch {
    // Table may not exist yet — fail silently, action is still performed
  }
}

// ── GET /api/admin/reports/jobs — list all flagged/reported jobs ───────────────
router.get("/reports/jobs", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT jr.id, jr.job_id, jr.reporter_address, jr.category, jr.description,
              jr.created_at, j.title AS job_title, j.status AS job_status,
              j.client_address
       FROM job_reports jr
       LEFT JOIN jobs j ON jr.job_id = j.id
       ORDER BY jr.created_at DESC
       LIMIT 100`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/admin/disputes — list all open disputes ─────────────────────────
router.get("/disputes", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.job_id, e.status AS escrow_status, e.created_at AS escrow_created_at,
              j.title AS job_title, j.client_address, j.freelancer_address,
              j.budget, j.currency, j.status AS job_status
       FROM escrows e
       LEFT JOIN jobs j ON e.job_id = j.id
       WHERE e.status = 'disputed' OR j.status = 'disputed'
       ORDER BY e.created_at DESC
       LIMIT 100`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/admin/reported-wallets — list reported user addresses ─────────────
router.get("/reported-wallets", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT reporter_address AS reported_address, COUNT(*) AS report_count,
              MAX(created_at) AS last_reported_at
       FROM job_reports
       GROUP BY reporter_address
       HAVING COUNT(*) > 0
       ORDER BY report_count DESC
       LIMIT 100`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/admin/logs — admin action audit log ───────────────────────────────
router.get("/logs", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, action, admin_address, target_id, target_type, details, created_at
       FROM admin_action_logs
       ORDER BY created_at DESC
       LIMIT 200`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    // If table doesn't exist, return empty
    res.json({ success: true, data: [] });
  }
});

// ── PATCH /api/admin/disputes/:jobId/resolve — mark dispute resolved ───────────
router.patch("/disputes/:jobId/resolve", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { resolution, releaseTo } = req.body; // releaseTo: 'client' | 'freelancer'

    if (!resolution) {
      return res.status(400).json({ error: "Resolution note is required" });
    }

    // Update escrow status
    await pool.query(
      `UPDATE escrows SET status = 'resolved', updated_at = NOW() WHERE job_id = $1`,
      [jobId]
    );

    // Update job status
    const newJobStatus = releaseTo === "client" ? "cancelled" : "completed";
    await updateJobStatus(jobId, newJobStatus);

    await logAdminAction({
      action: "resolve_dispute",
      adminAddress: req.user.publicKey,
      targetId: jobId,
      targetType: "job",
      details: { resolution, releaseTo, newJobStatus },
    });

    await logContractInteraction({
      functionName: "admin_resolve_dispute",
      callerAddress: req.user.publicKey,
      jobId,
      txHash: `admin-${Date.now()}`,
    });

    res.json({
      success: true,
      message: `Dispute resolved. Job marked as ${newJobStatus}.`,
    });
  } catch (e) {
    next(e);
  }
});

// ── PATCH /api/admin/jobs/:jobId/cancel — cancel a flagged job ─────────────────
router.patch("/jobs/:jobId/cancel", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { reason } = req.body;

    await updateJobStatus(jobId, "cancelled");

    await logAdminAction({
      action: "cancel_job",
      adminAddress: req.user.publicKey,
      targetId: jobId,
      targetType: "job",
      details: { reason },
    });

    res.json({ success: true, message: "Job cancelled by admin." });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/admin/wallets/:address/freeze — freeze a wallet ─────────────────
router.post("/wallets/:address/freeze", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { address } = req.params;
    const { reason } = req.body;

    if (!/^G[A-Z0-9]{55}$/.test(address)) {
      return res.status(400).json({ error: "Invalid Stellar address" });
    }

    await pool.query(
      `INSERT INTO frozen_wallets (address, reason, frozen_by, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (address) DO UPDATE SET reason = $2, frozen_by = $3, created_at = NOW()`,
      [address, reason || "Admin action", req.user.publicKey]
    );

    await logAdminAction({
      action: "freeze_wallet",
      adminAddress: req.user.publicKey,
      targetId: address,
      targetType: "wallet",
      details: { reason },
    });

    res.json({ success: true, message: `Wallet ${address} frozen.` });
  } catch (e) {
    next(e);
  }
});

// ── DELETE /api/admin/wallets/:address/freeze — unfreeze a wallet ─────────────
router.delete("/wallets/:address/freeze", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { address } = req.params;
    await pool.query("DELETE FROM frozen_wallets WHERE address = $1", [address]);

    await logAdminAction({
      action: "unfreeze_wallet",
      adminAddress: req.user.publicKey,
      targetId: address,
      targetType: "wallet",
      details: {},
    });

    res.json({ success: true, message: `Wallet ${address} unfrozen.` });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/admin/wallets/frozen — list frozen wallets ───────────────────────
router.get("/wallets/frozen", verifyJWT, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT address, reason, frozen_by, created_at FROM frozen_wallets ORDER BY created_at DESC"
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.json({ success: true, data: [] });
  }
});

module.exports = router;
