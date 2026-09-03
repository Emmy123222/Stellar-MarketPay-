/**
 * src/routes/profiles.js
 *
 * @swagger
 * tags:
 *   name: Profiles
 *   description: User profile management
 */
"use strict";
const express = require("express");
const router  = express.Router();
const pool    = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const multer = require("multer");
const { uploadFile, getGatewayUrl, MAX_FILE_SIZE } = require("../services/ipfsService");
const { createServiceLogger } = require("../utils/logger");

const profileLogger = createServiceLogger("profiles");

const profileUpdateRateLimiter = createRateLimiter(5, 1);
const generalProfileRateLimiter = createRateLimiter(30, 1);
const cache = require("../services/cacheService");
const { sendEmail } = require("../utils/email");
const { createError, ErrorCodes } = require("../utils/errors");
const { validateJsonb } = require("../middleware/jsonbValidator");
const portfolioItemsSchema = require("../schemas/portfolioItems.schema");
const {
  validate,
  upsertProfileSchema,
  notificationPreferencesSchema,
  availabilitySchema,
  priceAlertSchema,
  endorseSkillSchema,
  blockFreelancerSchema,
  encryptionKeySchema,
} = require("../validators/profileValidator");

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
  migrateProfile,
} = require("../services/profileMigrationService");
const { validateProfileMigration } = require("../validators/profileMigrationValidator");
const {
  getProfile,
  upsertProfile,
  updateAvailability,
  getProfileStats,
  getResponseTime,
  blockFreelancer,
  unblockFreelancer,
  getSkillEndorsements,
  endorseSkill,
} = require("../services/profileService");

/**
 * @swagger
 * /api/profiles:
 *   get:
 *     summary: List profiles
 *     tags: [Profiles]
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [freelancer, client, both]
 *       - in: query
 *         name: availability
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: after
 *         schema:
 *           type: string
 *         description: Cursor for next page
 *     responses:
 *       200:
 *         description: Profile list
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
 *                     $ref: '#/components/schemas/Profile'
 *                 next_cursor:
 *                   type: string
 *                   nullable: true
 *                 has_more:
 *                   type: boolean
 *   post:
 *     summary: Create or update a profile
 *     tags: [Profiles]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               publicKey:
 *                 type: string
 *               displayName:
 *                 type: string
 *               bio:
 *                 type: string
 *               role:
 *                 type: string
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Profile upserted
 */
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

/**
 * @swagger
 * /api/profiles/{publicKey}:
 *   get:
 *     summary: Get a profile by public key
 *     tags: [Profiles]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Profile'
 *   put:
 *     summary: Update own profile
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile updated
 *       403:
 *         description: Can only update own profile
 */
router.get("/:publicKey", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const key = cache.profileKey(req.params.publicKey);
    const cached = await cache.get(key);
    if (cached) {
      profileLogger.debug({ publicKey: req.params.publicKey, cacheKey: key }, "Cache HIT for profile");
      res.set("X-Cache", "HIT");
      return res.json({ success: true, data: cached });
    }
    profileLogger.debug({ publicKey: req.params.publicKey, cacheKey: key }, "Cache MISS for profile");
    const data = await getProfile(req.params.publicKey);
    await cache.set(key, data, cache.TTL.PROFILE);
    res.set("X-Cache", "MISS");
    res.json({ success: true, data });
  }
  catch (e) {
    // A migrated address has no active profile row match (deletion_status or
    // migrated marker); report the redirect target so both addresses stay
    // searchable and the old one points to the new profile (Issue #885).
    if (e.status === 404) {
      try {
        const { getRedirectTarget } = require("../services/profileMigrationService");
        const target = await getRedirectTarget(req.params.publicKey);
        if (target) {
          return res.status(200).json({
            success: true,
            data: { publicKey: req.params.publicKey, migrated_to: target, redirect: true },
          });
        }
      } catch (_) { /* fall through to 404 */ }
    }
    next(e);
  }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/stats:
 *   get:
 *     summary: Get profile stats
 *     tags: [Profiles]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile stats
 */
router.get("/:publicKey/stats", generalProfileRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await getProfileStats(req.params.publicKey) }); }
  catch (e) { next(e); }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/response-time:
 *   get:
 *     summary: Get freelancer response time
 *     tags: [Profiles]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Response time data
 */
router.get("/:publicKey/response-time", generalProfileRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await getResponseTime(req.params.publicKey) }); }
  catch (e) { next(e); }
});

router.post("/", profileUpdateRateLimiter, validateJsonb({ portfolio_items: portfolioItemsSchema }), async (req, res, next) => {
  try {
    const body = validate(upsertProfileSchema, req.body);
    const data = await upsertProfile(body);
    if (body.publicKey) {
      const key = cache.profileKey(body.publicKey);
      await cache.del(key);
      profileLogger.debug({ publicKey: body.publicKey, cacheKey: key }, "Cache invalidated after POST profile");
    }
    res.json({ success: true, data });
  }
  catch (e) { next(e); }
});

// PUT /api/profiles/:publicKey — update a profile (invalidates cache)
router.put("/:publicKey", profileUpdateRateLimiter, verifyJWT, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    if (req.user.publicKey !== publicKey) {
      return res.status(403).json({ error: "You can only update your own profile" });
    }
    const body = validate(upsertProfileSchema, req.body);
    const data = await upsertProfile({ ...body, publicKey });
    const key = cache.profileKey(publicKey);
    await cache.del(key);
    profileLogger.debug({ publicKey, cacheKey: key }, "Cache invalidated after PUT profile");
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
      return res.status(404).json({ error: "Profile not found", code: ErrorCodes.PROFILE_NOT_FOUND });
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
    const { email, emailNotificationsEnabled, webhookUrl, webhookSecret } = validate(notificationPreferencesSchema, req.body);

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

/**
 * @swagger
 * /api/profiles/{publicKey}/availability:
 *   post:
 *     summary: Update availability status
 *     tags: [Profiles]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               availability:
 *                 type: string
 *                 enum: [available, busy, unavailable]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Availability updated
 */
// PATCH /api/profiles/:publicKey/notificationPreferences - Update detailed preferences
router.patch("/:publicKey/notificationPreferences", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    if (req.user.publicKey !== publicKey) {
      return res.status(403).json({ error: { code: ErrorCodes.FORBIDDEN, message: "Unauthorized" } });
    }
    const notificationPreferencesService = require("../services/notificationPreferencesService");
    const { preferences } = req.body;
    if (!preferences || typeof preferences !== "object") {
      return res.status(400).json({ error: { code: ErrorCodes.BAD_REQUEST, message: "Invalid preferences format" } });
    }
    await notificationPreferencesService.updatePreferences(publicKey, preferences);
    const updated = await notificationPreferencesService.getPreferences(publicKey);
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

router.post("/:publicKey/availability", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const body = validate(availabilitySchema, req.body);
    res.json({
      success: true,
      data: await updateAvailability(req.params.publicKey, body),
    });
  }
  catch (e) { next(e); }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/price-alerts:
 *   get:
 *     summary: Get price alert preferences
 *     tags: [Profiles]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Price alert prefs
 *   post:
 *     summary: Update price alert preferences
 *     tags: [Profiles]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Price alert prefs updated
 */
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
    const body = validate(priceAlertSchema, req.body);
    const pref = await upsertPriceAlertPreference({
      freelancerAddress: req.params.publicKey,
      minXlmPriceUsd: body.minXlmPriceUsd,
      maxXlmPriceUsd: body.maxXlmPriceUsd,
      emailNotificationsEnabled: body.emailNotificationsEnabled,
      email: body.email,
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

/**
 * @swagger
 * /api/profiles/{publicKey}/endorse:
 *   post:
 *     summary: Endorse a skill
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - skill
 *               - endorserAddress
 *             properties:
 *               skill:
 *                 type: string
 *               endorserAddress:
 *                 type: string
 *     responses:
 *       200:
 *         description: Skill endorsed
 */
router.post("/:publicKey/endorse", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const { skill, endorserAddress } = validate(endorseSkillSchema, req.body);
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

/**
 * @swagger
 * /api/profiles/{publicKey}/spending:
 *   get:
 *     summary: Get client spending analytics
 *     tags: [Profiles]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Spending analytics
 */
router.get("/:publicKey/spending", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const data = await getClientSpendingAnalytics(req.params.publicKey);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/client-reputation:
 *   get:
 *     summary: Get client reputation
 *     tags: [Profiles]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Client reputation data
 */
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
      return res.status(403).json({ error: "You can only manage your own block list", code: ErrorCodes.FORBIDDEN });
    }
    const { address } = validate(blockFreelancerSchema, req.body);
    const profile = await blockFreelancer(req.params.publicKey, address);
    res.json({ success: true, data: profile });
  } catch (e) { next(e); }
});

// DELETE /api/profiles/:publicKey/block/:address — unblock a freelancer
router.delete("/:publicKey/block/:address", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    if (req.user.publicKey !== req.params.publicKey) {
      return res.status(403).json({ error: "You can only manage your own block list", code: ErrorCodes.FORBIDDEN });
    }
    const profile = await unblockFreelancer(req.params.publicKey, req.params.address);
    res.json({ success: true, data: profile });
  } catch (e) { next(e); }
});

// GET /api/profiles/:publicKey/earnings — freelancer earnings history (Issue #181)
/**
 * @swagger
 * /api/profiles/{publicKey}/earnings:
 *   get:
 *     summary: Get freelancer earnings history
 *     tags: [Profiles]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Earnings breakdown with monthly totals
 */
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
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: "Unauthorized", code: ErrorCodes.FORBIDDEN });
    if (!req.file) return res.status(400).json({ error: "File is required", code: ErrorCodes.BAD_REQUEST });

    const { rows } = await pool.query("SELECT portfolio_items FROM profiles WHERE public_key = $1", [publicKey]);
    const current = rows[0]?.portfolio_items || [];
    if (current.length >= 10) return res.status(400).json({ error: "Maximum 10 portfolio items allowed", code: ErrorCodes.PORTFOLIO_LIMIT_REACHED });

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
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: "Unauthorized", code: ErrorCodes.FORBIDDEN });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: "At least one file is required", code: ErrorCodes.BAD_REQUEST });

    const { rows } = await pool.query("SELECT portfolio_items FROM profiles WHERE public_key = $1", [publicKey]);
    const current = rows[0]?.portfolio_items || [];
    if (current.length + req.files.length > 10) {
      return res.status(400).json({ error: `Maximum 10 portfolio items allowed. You have ${current.length} and are trying to add ${req.files.length}.`, code: ErrorCodes.PORTFOLIO_LIMIT_REACHED });
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

// GET /api/profiles/:publicKey/endorsements — get skill endorsements (documented above)
/**
 * @swagger
 * /api/profiles/{publicKey}/endorsements:
 *   get:
 *     summary: Get skill endorsements
 *     tags: [Profiles]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Endorsements list
 */
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
    const { skill } = validate(endorseSkillSchema, req.body);
    const endorserAddress = req.user.publicKey;

    if (!skill || typeof skill !== "string" || !skill.trim()) {
      return res.status(400).json({ error: "Skill name is required", code: ErrorCodes.VALIDATION_ERROR });
    }

    const { rows: profileRows } = await pool.query(
      "SELECT skills FROM profiles WHERE public_key = $1",
      [publicKey]
    );
    if (!profileRows.length) {
      return res.status(404).json({ error: "Profile not found", code: ErrorCodes.PROFILE_NOT_FOUND });
    }
    if (!profileRows[0].skills || !profileRows[0].skills.includes(skill.trim())) {
      return res.status(400).json({ error: "Skill not found in freelancer's profile", code: ErrorCodes.VALIDATION_ERROR });
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
      return res.status(403).json({ error: "Only past clients with completed jobs can endorse", code: ErrorCodes.FORBIDDEN });
    }

    await endorseSkill({ skill: skill.trim(), endorserAddress, recipientAddress: publicKey });

    res.status(201).json({ success: true, data: { skill: skill.trim(), endorsed: true } });
  } catch (e) { next(e); }
});

router.delete("/:publicKey/portfolio/:itemId", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey, itemId } = req.params;
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: "Unauthorized", code: ErrorCodes.FORBIDDEN });

    const { rows } = await pool.query("SELECT portfolio_items FROM profiles WHERE public_key = $1", [publicKey]);
    const current = rows[0]?.portfolio_items || [];
    const nextItems = current.filter((item) => item.id !== itemId);

    if (nextItems.length === current.length) return res.status(404).json({ error: "Portfolio item not found", code: ErrorCodes.NOT_FOUND });

    await pool.query("UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1", [publicKey, JSON.stringify(nextItems)]);

    res.json({ success: true, data: { deleted: true } });
  } catch (e) { next(e); }
});

/**
 * @swagger
 * /api/profiles/{publicKey}/encryption-key:
 *   get:
 *     summary: Get NaCl encryption public key (public lookup)
 *     tags: [Profiles]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Encryption public key
 *       404:
 *         description: Profile not found
 *   put:
 *     summary: Store X25519 encryption public key
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - encryptionPublicKey
 *             properties:
 *               encryptionPublicKey:
 *                 type: string
 *                 description: Base64-encoded 32-byte X25519 key
 *     responses:
 *       200:
 *         description: Key stored
 *       403:
 *         description: Can only update own key
 */
router.get("/:publicKey/encryption-key", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT encryption_public_key FROM profiles WHERE public_key = $1`,
      [req.params.publicKey],
    );
    if (!rows.length) return res.status(404).json({ error: "Profile not found", code: ErrorCodes.PROFILE_NOT_FOUND });
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

    const { encryptionPublicKey } = validate(encryptionKeySchema, req.body);

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

/**
 * @swagger
 * /api/profiles/{publicKey}/data:
 *   delete:
 *     summary: GDPR deletion request (30-day grace period)
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile marked for deletion
 *       403:
 *         description: Can only delete own profile
 */
/**
 * @swagger
 * /api/profiles/migrate:
 *   post:
 *     summary: Merge an old Stellar account into a new one (identity migration)
 *     description: |
 *       Proves ownership of BOTH accounts via ed25519 signatures over the
 *       canonical challenge string `MARKETPAY-ACCOUNT-MERGE\\n<old>\\n<new>\\n<issuedAt>`
 *       (one signature per key, hex or base64). On success, in one transaction:
 *       profile identity/reputation is carried to the new address, all history
 *       tables (jobs, applications, ratings, referrals, payouts, messages,
 *       progress updates, dispute evidence, archives, certificates, push
 *       subscriptions, API keys) are re-pointed old -> new, and the old
 *       address is marked `migrated_to = new` (kept searchable; lookups of the
 *       old address report the redirect target).
 *     tags: [Profiles]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [oldPublicKey, newPublicKey, oldSignature, newSignature, issuedAt]
 *             properties:
 *               oldPublicKey:
 *                 type: string
 *               newPublicKey:
 *                 type: string
 *               oldSignature:
 *                 type: string
 *                 description: ed25519 signature of the challenge by the OLD secret key (hex/base64)
 *               newSignature:
 *                 type: string
 *                 description: ed25519 signature of the challenge by the NEW secret key (hex/base64)
 *               issuedAt:
 *                 type: string
 *                 format: date-time
 *                 description: ISO timestamp embedded in the challenge (10-minute validity)
 *               network:
 *                 type: string
 *                 enum: [testnet, mainnet]
 *     responses:
 *       200:
 *         description: Migration complete; returns per-table transferred-row counts
 *       400:
 *         description: Validation error (bad address/signature format, expired challenge)
 *       401:
 *         description: A signature does not prove ownership of its address
 *       404:
 *         description: Old profile not found
 *       409:
 *         description: Old address already migrated, or new address is itself migrated
 */
router.post("/migrate", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const body = validateProfileMigration(req.body);
    const summary = await migrateProfile(body);
    res.json({ success: true, data: summary });
  }
  catch (e) { next(e); }
});

// DELETE /api/profiles/:publicKey/data — GDPR deletion request
router.delete("/:publicKey/data", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    if (req.user.publicKey !== publicKey) {
      return res.status(403).json({ error: "You can only delete your own profile data", code: ErrorCodes.FORBIDDEN });
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

