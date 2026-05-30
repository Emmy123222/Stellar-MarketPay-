/**
 * src/routes/admin.js
 * Admin-only moderation routes — protected by JWT role=admin check.
 */
"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { verifyJWT, requireAdmin2FA } = require("../middleware/auth");
const { updateJobStatus } = require("../services/jobService");
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
      `INSERT INTO audit_logs (actor_address, action, target, reason, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        adminAddress,
        action,
        targetId || null,
        details?.reason || null,
        JSON.stringify({ targetType, ...details }),
      ]
    );
  } catch {
    // Table may not exist yet — fail silently, action is still performed
  }
}

// ── GET /api/admin/metrics — platform analytics dashboard ─────────────────────
router.get("/metrics", verifyJWT, requireAdmin, requireAdmin2FA, async (req, res, next) => {
  try {
    const { period = "30d" } = req.query;
    
    // Calculate date range based on period
    let daysBack = 30;
    if (period === "7d") daysBack = 7;
    else if (period === "90d") daysBack = 90;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    
    // Platform Health Metrics
    const platformHealth = await pool.query(`
      SELECT 
        COUNT(*) as total_jobs,
        COUNT(*) FILTER (WHERE status = 'open') as open_jobs,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
        COUNT(*) FILTER (WHERE status = 'disputed') as disputed_jobs,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'completed')::numeric / 
          NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'cancelled'))::numeric, 0) * 100, 2
        ) as completion_rate,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'disputed')::numeric / 
          NULLIF(COUNT(*)::numeric, 0) * 100, 2
        ) as dispute_rate
      FROM jobs 
      WHERE created_at >= $1
    `, [startDate]);

    // User Growth Metrics
    const userGrowth = await pool.query(`
      SELECT 
        COUNT(DISTINCT public_key) as total_users,
        COUNT(DISTINCT public_key) FILTER (WHERE role IN ('freelancer', 'both')) as freelancers,
        COUNT(DISTINCT public_key) FILTER (WHERE role IN ('client', 'both')) as clients,
        COUNT(DISTINCT public_key) FILTER (WHERE created_at >= $1) as new_users_period
      FROM profiles
    `, [startDate]);

    // Weekly new user growth
    const weeklyGrowth = await pool.query(`
      SELECT 
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as new_users
      FROM profiles 
      WHERE created_at >= $1
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week
    `, [startDate]);

    // Financial Metrics
    const financialMetrics = await pool.query(`
      SELECT 
        COALESCE(SUM(budget) FILTER (WHERE status = 'funded'), 0) as total_xlm_escrow,
        COALESCE(SUM(budget) FILTER (WHERE status = 'released'), 0) as total_xlm_released,
        COALESCE(AVG(budget), 0) as avg_job_budget,
        COUNT(*) FILTER (WHERE status = 'funded') as active_escrows
      FROM jobs j
      LEFT JOIN escrows e ON j.id = e.job_id
      WHERE j.created_at >= $1
    `, [startDate]);

    // Quality Metrics
    const qualityMetrics = await pool.query(`
      SELECT 
        COALESCE(AVG(rating), 0) as avg_rating,
        COUNT(*) as total_ratings,
        COUNT(DISTINCT j.client_address) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM jobs j2 
            WHERE j2.client_address = j.client_address 
            AND j2.freelancer_address = j.freelancer_address 
            AND j2.id != j.id
          )
        ) as repeat_hires
      FROM jobs j
      LEFT JOIN ratings r ON j.id = r.job_id
      WHERE j.created_at >= $1 AND j.status = 'completed'
    `, [startDate]);

    // Dispute Metrics
    const disputeMetrics = await pool.query(`
      SELECT 
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) FILTER (WHERE status = 'disputed') as disputes_opened,
        COUNT(*) FILTER (WHERE status = 'resolved') as disputes_resolved
      FROM jobs
      WHERE created_at >= $1
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week
    `, [startDate]);

    // Top Earners
    const topEarners = await pool.query(`
      SELECT 
        p.public_key,
        p.display_name,
        p.total_earned_xlm,
        p.completed_jobs,
        p.rating
      FROM profiles p
      WHERE p.total_earned_xlm > 0
      ORDER BY p.total_earned_xlm DESC
      LIMIT 10
    `);

    // Job Volume Over Time
    const jobVolume = await pool.query(`
      SELECT 
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) as jobs_created,
        COUNT(*) FILTER (WHERE status = 'completed') as jobs_completed
      FROM jobs
      WHERE created_at >= $1
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date
    `, [startDate]);

    res.json({
      success: true,
      data: {
        period,
        platformHealth: platformHealth.rows[0],
        userGrowth: userGrowth.rows[0],
        weeklyGrowth: weeklyGrowth.rows,
        financialMetrics: financialMetrics.rows[0],
        qualityMetrics: qualityMetrics.rows[0],
        disputeMetrics: disputeMetrics.rows,
        topEarners: topEarners.rows,
        jobVolume: jobVolume.rows
      }
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/admin/reports/jobs — list all flagged/reported jobs ───────────────
router.get("/reports/jobs", verifyJWT, requireAdmin, requireAdmin2FA, async (req, res, next) => {
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
router.get("/disputes", verifyJWT, requireAdmin, requireAdmin2FA, async (req, res, next) => {
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
router.get("/reported-wallets", verifyJWT, requireAdmin, requireAdmin2FA, async (req, res, next) => {
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
router.get("/logs", verifyJWT, requireAdmin, requireAdmin2FA, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, action, actor_address, target, reason, metadata, created_at
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT 200`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.json({ success: true, data: [] });
  }
});

// ── PATCH /api/admin/disputes/:jobId/resolve — mark dispute resolved ───────────
router.patch("/disputes/:jobId/resolve", verifyJWT, requireAdmin, requireAdmin2FA, async (req, res, next) => {
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
      details: { reason: resolution, resolution, releaseTo, newJobStatus },
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
router.patch("/jobs/:jobId/cancel", verifyJWT, requireAdmin, requireAdmin2FA, async (req, res, next) => {
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
router.post("/wallets/:address/freeze", verifyJWT, requireAdmin, requireAdmin2FA, async (req, res, next) => {
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
router.delete("/wallets/:address/freeze", verifyJWT, requireAdmin, requireAdmin2FA, async (req, res, next) => {
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
router.get("/wallets/frozen", verifyJWT, requireAdmin, requireAdmin2FA, async (req, res) => {
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
