const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const notificationPreferencesService = require("../services/notificationPreferencesService");
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

const adminRateLimiter = createRateLimiter(30, 1);

// ─── Admin: failed webhooks ──────────────────────────────────────────────────

/**
 * GET /api/notifications/failed-webhooks
 * Returns failed webhook notifications with payload for manual retry (admin only).
 */
router.get("/failed-webhooks", verifyJWT, adminRateLimiter, async (req, res, next) => {
  try {
    const adminAddresses = (process.env.ADMIN_WALLET_ADDRESSES || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    if (!adminAddresses.includes(req.user.publicKey) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }

    const { rows } = await pool.query(
      `SELECT id, recipient_address, notification_type, event_type,
              job_id, payload, status, retry_count, error_message,
              created_at, last_attempt_at
       FROM notification_queue
       WHERE status = 'failed' AND notification_type = 'webhook'
       ORDER BY created_at DESC
       LIMIT 100`
    );

    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        recipientAddress: r.recipient_address,
        eventType: r.event_type,
        jobId: r.job_id,
        payload: r.payload,
        retryCount: r.retry_count,
        errorMessage: r.error_message,
        createdAt: r.created_at,
        lastAttemptAt: r.last_attempt_at,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/notifications/failed-webhooks/:id/retry
 * Manually retry a failed webhook notification (admin only).
 */
router.post("/failed-webhooks/:id/retry", verifyJWT, adminRateLimiter, async (req, res, next) => {
  try {
    const adminAddresses = (process.env.ADMIN_WALLET_ADDRESSES || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    if (!adminAddresses.includes(req.user.publicKey) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }

    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE notification_queue
       SET status = 'pending', retry_count = 0, next_retry_at = NULL, error_message = NULL
       WHERE id = $1 AND status = 'failed'
       RETURNING id`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Failed notification not found" });
    }

    res.json({ success: true, message: "Notification queued for retry" });
  } catch (e) {
    next(e);
  }
});

// ─── Authenticated preference endpoints ───────────────────────────────────────

router.get("/preferences", verifyJWT, async (req, res, next) => {
  try {
    const preferences = await notificationPreferencesService.getPreferences(
      req.user.publicKey
    );
    res.json({
      success: true,
      data: {
        notificationTypes: notificationPreferencesService.NOTIFICATION_TYPES,
        preferences,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/preferences", verifyJWT, async (req, res, next) => {
  try {
    const { preferences } = req.body;
    if (!preferences || typeof preferences !== "object") {
      const err = new Error("Invalid preferences format");
      err.status = 400;
      throw err;
    }

    await notificationPreferencesService.updatePreferences(
      req.user.publicKey,
      preferences
    );

    const updated = await notificationPreferencesService.getPreferences(
      req.user.publicKey
    );
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

// ─── Token-based unsubscribe (no auth required) ───────────────────────────────

/**
 * GET /api/notifications/unsubscribe?token=<uuid>
 *
 * Looks up the profile by digest_unsubscribe_token, disables the weekly_digest
 * email preference, then returns an HTML confirmation page.  No login required —
 * the token acts as a bearer credential for this single action.
 */
router.get("/unsubscribe", async (req, res) => {
  const { token } = req.query;

  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  // Helper: render a self-contained HTML page (works in any browser opened
  // via an email client link)
  function htmlPage(success, message) {
    const color = success ? "#22c55e" : "#ef4444";
    const icon  = success ? "✓" : "✗";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Unsubscribe — Stellar MarketPay</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0f172a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
         min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#1e293b;border-radius:16px;padding:48px 40px;max-width:480px;
          width:100%;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,.5)}
    .icon{font-size:52px;color:${color};margin-bottom:20px}
    h1{color:#f1f5f9;font-size:22px;font-weight:700;margin-bottom:12px}
    p{color:#94a3b8;font-size:15px;line-height:1.6;margin-bottom:28px}
    a{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
      font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px}
    a:hover{background:#1d4ed8}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${success ? "You've been unsubscribed" : "Invalid link"}</h1>
    <p>${message}</p>
    <a href="${baseUrl}">Back to Stellar MarketPay</a>
  </div>
</body>
</html>`;
  }

  // Validate token presence
  if (!token || typeof token !== "string" || token.trim() === "") {
    return res
      .status(400)
      .type("html")
      .send(htmlPage(false, "The unsubscribe link is missing or invalid. Please use the link from your email."));
  }

  try {
    // Look up the profile by unsubscribe token
    const { rows } = await pool.query(
      "SELECT public_key FROM profiles WHERE digest_unsubscribe_token = $1",
      [token.trim()]
    );

    if (!rows.length) {
      return res
        .status(404)
        .type("html")
        .send(htmlPage(false, "This unsubscribe link has already been used or is no longer valid."));
    }

    const { public_key } = rows[0];

    // Persist opt-out in notification_preferences
    await notificationPreferencesService.updatePreference(
      public_key,
      "weekly_digest",
      "email",
      false
    );

    // Rotate the token so the link can only be used once
    await pool.query(
      "UPDATE profiles SET digest_unsubscribe_token = gen_random_uuid() WHERE public_key = $1",
      [public_key]
    );

    return res
      .status(200)
      .type("html")
      .send(
        htmlPage(
          true,
          "You will no longer receive weekly job digest emails from Stellar MarketPay. " +
          "You can re-enable them at any time from your notification preferences."
        )
      );
  } catch (err) {
    console.error("[unsubscribe] Error processing request:", err.message);
    return res
      .status(500)
      .type("html")
      .send(htmlPage(false, "Something went wrong. Please try again later."));
  }
});

module.exports = router;

