/**
 * src/routes/profiles.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const pool    = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const multer = require("multer");
const { uploadFile, getGatewayUrl, MAX_FILE_SIZE } = require("../services/ipfsService");

const profileUpdateRateLimiter = createRateLimiter(5, 1);
const generalProfileRateLimiter = createRateLimiter(30, 1);
const cache = require("../services/cacheService");
const { sendEmail } = require("../utils/email");
const { createError, ErrorCodes } = require("../utils/errors");
const { validateJsonb } = require("../middleware/jsonbValidator");
const portfolioItemsSchema = require("../schemas/portfolioItems.schema");

const {
  getProfile,
  upsertProfile,
  updateAvailability,
  getSkillEndorsements,
  endorseSkill,
  getClientSpendingAnalytics,
  listProfiles,
  getClientReputation,
  getProfileStats,
  getResponseTime,
  blockFreelancer,
  unblockFreelancer,
  markProfileForDeletion,
} = require("../services/profileService");
const {
  upsertPriceAlertPreference,
  getPriceAlertPreference,
} = require("../services/priceAlertService");

router.get("/", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { role, availability, search, limit, after, page } = req.query;

    if (page !== undefined && after === undefined) {
      res.set("Deprecation", "true");
      res.set("Link", '</api/profiles>; rel="deprecation"');
      res.set("Sunset", "2025-12-31");
    }

    const result = await listProfiles({
      role: typeof role === "string" && role.trim() ? role : undefined,
      availability: typeof availability === "string" && availability.trim() ? availability : undefined,
      search: typeof search === "string" && search.trim() ? search : undefined,
      limit: typeof limit === "string" ? Number(limit) : undefined,
      after: typeof after === "string" && after.trim() ? after : undefined,
    });
    res.json({
      success: true,
      data: result.profiles,
      next_cursor: result.nextCursor,
      has_more: result.hasMore,
      ...(page !== undefined && after === undefined && {
        _deprecation: "The `page` parameter is deprecated. Use cursor-based pagination via `after`.",
      }),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:publicKey", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const key = cache.profileKey(req.params.publicKey);
    const cached = await cache.get(key);
    if (cached) {
      res.set("X-Cache", "HIT");
      return res.json({ success: true, data: cached });
    }
    const data = await getProfile(req.params.publicKey);
    await cache.set(key, data, cache.TTL.PROFILE);
    res.set("X-Cache", "MISS");
    res.json({ success: true, data });
  }
  catch (e) { next(e); }
});

router.get("/:publicKey/stats", generalProfileRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await getProfileStats(req.params.publicKey) }); }
  catch (e) { next(e); }
});

router.get("/:publicKey/response-time", generalProfileRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await getResponseTime(req.params.publicKey) }); }
  catch (e) { next(e); }
});

router.post("/", profileUpdateRateLimiter, validateJsonb({ portfolio_items: portfolioItemsSchema }), async (req, res, next) => {
  try {
    const data = await upsertProfile(req.body);
    if (req.body.publicKey) await cache.del(cache.profileKey(req.body.publicKey));
    res.json({ success: true, data });
  }
  catch (e) { next(e); }
});

// GET /api/profiles/:publicKey/notifications - Get notification preferences
router.get("/:publicKey/notifications", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { getUserPreferences } = require("../services/notificationService");
    const prefs = await getUserPreferences(req.params.publicKey);
    
    if (!prefs) {
      return res.status(404).json({ error: { code: ErrorCodes.PROFILE_NOT_FOUND, message: "Profile not found" } });
    }

    res.json({
      success: true,
      data: {
        email: prefs.email,
        emailNotificationsEnabled: prefs.email_notifications_enabled,
        webhookUrl: prefs.webhook_url,
        webhookSecret: prefs.webhook_secret ? "***" : null, // Hide secret
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/profiles/:publicKey/notifications - Update notification preferences
router.post("/:publicKey/notifications", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    const { email, emailNotificationsEnabled, webhookUrl, webhookSecret } = req.body;

    // Update profile with notification preferences
    const updated = await upsertProfile({
      publicKey,
      email,
      emailNotificationsEnabled,
      webhookUrl,
      webhookSecret,
    });

    res.json({
      success: true,
      data: {
        email: updated.email,
        emailNotificationsEnabled: updated.emailNotificationsEnabled,
        webhookUrl: updated.webhookUrl,
        webhookSecret: updated.webhookSecret ? "***" : null,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post("/:publicKey/availability", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await updateAvailability(req.params.publicKey, req.body),
    });
  }
  catch (e) { next(e); }
});

router.get("/:publicKey/price-alerts", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const pref = await getPriceAlertPreference(req.params.publicKey);
    res.json({ success: true, data: pref });
  } catch (e) {
    next(e);
  }
});

router.post("/:publicKey/price-alerts", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const pref = await upsertPriceAlertPreference({
      freelancerAddress: req.params.publicKey,
      minXlmPriceUsd: req.body.minXlmPriceUsd,
      maxXlmPriceUsd: req.body.maxXlmPriceUsd,
      emailNotificationsEnabled: req.body.emailNotificationsEnabled,
      email: req.body.email,
    });
    res.json({ success: true, data: pref });
  } catch (e) {
    next(e);
  }
});

router.get("/:publicKey/endorsements", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const endorsements = await getSkillEndorsements(req.params.publicKey);
    res.json({ success: true, data: endorsements });
  } catch (e) {
    next(e);
  }
});

router.post("/:publicKey/endorse", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const { skill, endorserAddress } = req.body;
    await endorseSkill({
      skill,
      endorserAddress,
      recipientAddress: req.params.publicKey,
    });
    res.json({ success: true, data: null });
  } catch (e) {
    next(e);
  }
});

router.get("/:publicKey/spending", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const data = await getClientSpendingAnalytics(req.params.publicKey);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.get("/:publicKey/client-reputation", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const data = await getClientReputation(req.params.publicKey);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// POST /api/profiles/:publicKey/block — block a freelancer
router.post("/:publicKey/block", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    if (req.user.publicKey !== req.params.publicKey) {
      return res.status(403).json({ error: { code: ErrorCodes.FORBIDDEN, message: "You can only manage your own block list" } });
    }
    const { address } = req.body;
    const profile = await blockFreelancer(req.params.publicKey, address);
    res.json({ success: true, data: profile });
  } catch (e) { next(e); }
});

// DELETE /api/profiles/:publicKey/block/:address — unblock a freelancer
router.delete("/:publicKey/block/:address", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    if (req.user.publicKey !== req.params.publicKey) {
      return res.status(403).json({ error: { code: ErrorCodes.FORBIDDEN, message: "You can only manage your own block list" } });
    }
    const profile = await unblockFreelancer(req.params.publicKey, req.params.address);
    res.json({ success: true, data: profile });
  } catch (e) { next(e); }
});

// GET /api/profiles/:publicKey/earnings — freelancer earnings history (Issue #181)
router.get("/:publicKey/earnings", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    const { rows: payments } = await pool.query(
      `SELECT
         e.id,
         e.job_id,
         e.amount_xlm,
         e.released_at,
         j.title  AS job_title,
         j.client_address,
         j.currency
       FROM escrows e
       JOIN jobs j ON e.job_id = j.id
       WHERE j.freelancer_address = $1
         AND e.status = 'released'
       ORDER BY e.released_at DESC`,
      [publicKey]
    );

    const { rows: monthly } = await pool.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', e.released_at), 'YYYY-MM') AS month,
         SUM(e.amount_xlm)::numeric                             AS total_xlm
       FROM escrows e
       JOIN jobs j ON e.job_id = j.id
       WHERE j.freelancer_address = $1
         AND e.status = 'released'
         AND e.released_at >= NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', e.released_at)
       ORDER BY DATE_TRUNC('month', e.released_at)`,
      [publicKey]
    );

    let totalXlm = 0;
    let totalUsdc = 0;
    for (const p of payments) {
      const amt = parseFloat(p.amount_xlm || 0);
      if ((p.currency || "XLM").toUpperCase() === "USDC") {
        totalUsdc += amt;
      } else {
        totalXlm += amt;
      }
    }

    res.json({
      success: true,
      data: {
        totalXlm: totalXlm.toFixed(7),
        totalUsdc: totalUsdc.toFixed(7),
        payments: payments.map((p) => ({
          id: p.id,
          jobId: p.job_id,
          jobTitle: p.job_title,
          amountXlm: p.amount_xlm,
          currency: p.currency || "XLM",
          releasedAt: p.released_at,
          clientAddress: p.client_address,
        })),
        monthly: monthly.map((m) => ({
          month: m.month,
          totalXlm: parseFloat(m.total_xlm),
        })),
      },
    });
  } catch (e) { next(e); }
});


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

const uploadMultiple = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
});

router.post("/:publicKey/portfolio", verifyJWT, upload.single("file"), async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: { code: ErrorCodes.FORBIDDEN, message: "Unauthorized" } });
    if (!req.file) return res.status(400).json({ error: { code: ErrorCodes.BAD_REQUEST, message: "File is required" } });

    const { rows } = await pool.query("SELECT portfolio_items FROM profiles WHERE public_key = $1", [publicKey]);
    const current = rows[0]?.portfolio_items || [];
    if (current.length >= 10) return res.status(400).json({ error: { code: ErrorCodes.PORTFOLIO_LIMIT_REACHED, message: "Maximum 10 portfolio items allowed" } });

    const uploaded = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    const item = {
      id: require("crypto").randomUUID(),
      title: req.body.title?.trim() || req.file.originalname,
      type: uploaded.mimeType.startsWith("image/") ? "image" : "pdf",
      cid: uploaded.cid,
      fileName: uploaded.fileName,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      uploadedAt: uploaded.uploadedAt,
      url: getGatewayUrl(uploaded.cid),
    };

    const updated = [...current, item];
    await pool.query("UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1", [publicKey, JSON.stringify(updated)]);

    res.json({ success: true, data: item });
  } catch (e) { next(e); }
});

router.post("/:publicKey/portfolio-files", verifyJWT, uploadMultiple.array("files", 10), async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: { code: ErrorCodes.FORBIDDEN, message: "Unauthorized" } });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: { code: ErrorCodes.BAD_REQUEST, message: "At least one file is required" } });

    const { rows } = await pool.query("SELECT portfolio_items FROM profiles WHERE public_key = $1", [publicKey]);
    const current = rows[0]?.portfolio_items || [];
    if (current.length + req.files.length > 10) {
      return res.status(400).json({ error: { code: ErrorCodes.PORTFOLIO_LIMIT_REACHED, message: `Maximum 10 portfolio items allowed. You have ${current.length} and are trying to add ${req.files.length}.` } });
    }

    const uploadedFiles = [];
    const gatewayUrls = [];
    for (const file of req.files) {
      const uploaded = await uploadFile(file.buffer, file.originalname, file.mimetype);
      const item = {
        id: require("crypto").randomUUID(),
        title: file.originalname,
        type: uploaded.mimeType.startsWith("image/") ? "image" : "pdf",
        cid: uploaded.cid,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        size: uploaded.size,
        uploadedAt: uploaded.uploadedAt,
        url: getGatewayUrl(uploaded.cid),
      };
      uploadedFiles.push(item);
      gatewayUrls.push(item.url);
    }

    const updated = [...current, ...uploadedFiles];
    await pool.query("UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1", [publicKey, JSON.stringify(updated)]);

    res.json({ success: true, data: { uploadedFiles, gatewayUrls } });
  } catch (e) { next(e); }
});

// GET /api/profiles/:publicKey/endorsements — get skill endorsements
router.get("/:publicKey/endorsements", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const data = await getSkillEndorsements(req.params.publicKey);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// POST /api/profiles/:publicKey/endorse — endorse a skill
router.post("/:publicKey/endorse", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    const { skill } = req.body;
    const endorserAddress = req.user.publicKey;

    if (!skill || typeof skill !== "string" || !skill.trim()) {
      return res.status(400).json({ error: { code: ErrorCodes.VALIDATION_ERROR, message: "Skill name is required" } });
    }

    const { rows: profileRows } = await pool.query(
      "SELECT skills FROM profiles WHERE public_key = $1",
      [publicKey]
    );
    if (!profileRows.length) {
      return res.status(404).json({ error: { code: ErrorCodes.PROFILE_NOT_FOUND, message: "Profile not found" } });
    }
    if (!profileRows[0].skills || !profileRows[0].skills.includes(skill.trim())) {
      return res.status(400).json({ error: { code: ErrorCodes.VALIDATION_ERROR, message: "Skill not found in freelancer's profile" } });
    }

    const { rows: jobRows } = await pool.query(
      `SELECT 1 FROM jobs
       WHERE client_address = $1
         AND freelancer_address = $2
         AND status = 'completed'
       LIMIT 1`,
      [endorserAddress, publicKey]
    );
    if (!jobRows.length) {
      return res.status(403).json({ error: { code: ErrorCodes.FORBIDDEN, message: "Only past clients with completed jobs can endorse" } });
    }

    await endorseSkill({ skill: skill.trim(), endorserAddress, recipientAddress: publicKey });

    res.status(201).json({ success: true, data: { skill: skill.trim(), endorsed: true } });
  } catch (e) { next(e); }
});

router.delete("/:publicKey/portfolio/:itemId", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey, itemId } = req.params;
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: { code: ErrorCodes.FORBIDDEN, message: "Unauthorized" } });

    const { rows } = await pool.query("SELECT portfolio_items FROM profiles WHERE public_key = $1", [publicKey]);
    const current = rows[0]?.portfolio_items || [];
    const nextItems = current.filter((item) => item.id !== itemId);

    if (nextItems.length === current.length) return res.status(404).json({ error: { code: ErrorCodes.NOT_FOUND, message: "Portfolio item not found" } });

    await pool.query("UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1", [publicKey, JSON.stringify(nextItems)]);

    res.json({ success: true, data: { deleted: true } });
  } catch (e) { next(e); }
});

  // GET /api/profiles/:publicKey/encryption-key — NaCl public key lookup (no auth required)
router.get("/:publicKey/encryption-key", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT encryption_public_key FROM profiles WHERE public_key = $1`,
      [req.params.publicKey],
    );
    if (!rows.length) return res.status(404).json({ error: { code: ErrorCodes.PROFILE_NOT_FOUND, message: "Profile not found" } });
    res.json({ success: true, data: { encryptionPublicKey: rows[0].encryption_public_key || null } });
  } catch (e) { next(e); }
});

// PUT /api/profiles/:publicKey/encryption-key — store user's X25519 public key (Issue #474)
router.put("/:publicKey/encryption-key", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    if (req.user.publicKey !== publicKey) {
      return next(createError(ErrorCodes.FORBIDDEN, "You can only update your own encryption key", 403));
    }

    const { encryptionPublicKey } = req.body;

    if (!encryptionPublicKey || typeof encryptionPublicKey !== "string") {
      return next(createError(ErrorCodes.VALIDATION_ERROR, "encryptionPublicKey is required", 400));
    }

    // Validate: must be a base64-encoded 32-byte X25519 key
    let keyBytes;
    try {
      keyBytes = Buffer.from(encryptionPublicKey, "base64");
    } catch {
      return next(createError(ErrorCodes.ENCRYPTION_KEY_INVALID, "encryptionPublicKey must be base64-encoded", 400));
    }

    if (keyBytes.length !== 32) {
      return next(createError(ErrorCodes.ENCRYPTION_KEY_INVALID, "encryptionPublicKey must be a 32-byte X25519 key (base64)", 400));
    }

    const { rows } = await pool.query(
      `UPDATE profiles
         SET encryption_public_key = $2, updated_at = NOW()
       WHERE public_key = $1
       RETURNING encryption_public_key`,
      [publicKey, encryptionPublicKey],
    );

    if (!rows.length) {
      return next(createError(ErrorCodes.PROFILE_NOT_FOUND, "Profile not found", 404));
    }

    await cache.del(cache.profileKey(publicKey));

    res.json({ success: true, data: { encryptionPublicKey: rows[0].encryption_public_key } });
  } catch (e) { next(e); }
});

// DELETE /api/profiles/:publicKey/data — GDPR deletion request
router.delete("/:publicKey/data", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    if (req.user.publicKey !== publicKey) {
      return res.status(403).json({ error: { code: ErrorCodes.FORBIDDEN, message: "You can only delete your own profile data" } });
    }
    
    const profile = await markProfileForDeletion(publicKey);
    
    await cache.del(cache.profileKey(publicKey));
    
    if (profile.email) {
      await sendEmail({
        to: profile.email,
        subject: "Profile Deletion Request Received",
        text: "We have received your request to delete your profile. Your profile is now hidden and will be permanently deleted after a 30-day grace period.",
        html: "<p>We have received your request to delete your profile.</p><p>Your profile is now hidden and will be permanently deleted after a 30-day grace period.</p>"
      });
    }

    res.json({ success: true, message: "Profile marked for deletion" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

