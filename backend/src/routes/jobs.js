/**
 * src/routes/jobs.js
 */
"use strict";

const express = require("express");
const router = express.Router();

const { createRateLimiter } = require("../middleware/rateLimiter");

const jobCreationRateLimiter = createRateLimiter(10, 1);
const generalJobRateLimiter = createRateLimiter(30, 1);
const suggestRateLimiter = createRateLimiter(60, 1);
const reportJobRateLimiter = createRateLimiter(5, 1);

const {
  createJob, getJob, listJobs, listJobsByClient, updateJobEscrowId, deleteJob,
  boostJob, incrementShareCount, raiseDispute, resolveDispute,
  getRecommendedJobs, getSuggestions, extendJobExpiry, incrementViewCount,
} = require("../services/jobService");
const { logContractInteraction } = require("../services/contractAuditService");
const { verifyJWT } = require("../middleware/auth");
const cache = require("../services/cacheService");
const jobDraftService = require("../services/jobDraftService");
const recommendationService = require("../services/recommendationService");

const jobReports = new Map();

// Feed Helpers

function escapeXml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDateRss(date) {
  return date.toUTCString();
}

function formatDateAtom(date) {
  return date.toISOString();
}

function truncateDescription(description, maxLength = 200) {
  if (!description) return "";
  if (description.length <= maxLength) return description;
  return description.substring(0, maxLength - 3) + "...";
}

// Apply feed-only query filters (skills, budget range) to an already-fetched job list.
function filterFeedJobs(jobs, { skills, min_budget, max_budget } = {}) {
  let filtered = jobs;
  const wanted = String(skills || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length > 0) {
    filtered = filtered.filter((job) =>
      (job.skills || []).some((s) => wanted.includes(String(s).toLowerCase()))
    );
  }
  const min = parseFloat(min_budget);
  if (!isNaN(min)) filtered = filtered.filter((job) => parseFloat(job.budget) >= min);
  const max = parseFloat(max_budget);
  if (!isNaN(max)) filtered = filtered.filter((job) => parseFloat(job.budget) <= max);
  return filtered;
}

// Build a feed title suffix that reflects the active filters.
function feedTitleSuffix({ category, skills } = {}) {
  const parts = [];
  if (category) parts.push(`in ${category}`);
  const skillList = String(skills || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (skillList.length > 0) parts.push(`matching ${skillList.join(", ")}`);
  return parts.length ? ` — ${parts.join(" ")}` : "";
}

function normalizeAddress(address) {
  return typeof address === "string" ? address.trim() : "";
}

function isValidReportCategory(category) {
  return ["fraud", "suspicious", "spam", "inappropriate", "other"].includes(
    category,
  );
}

/**
 * @swagger
 * /api/jobs:
 *   get:
 *     summary: List jobs
 *     description: Returns a paginated list of jobs with optional filtering
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by job category
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, in_progress, completed, cancelled]
 *         description: Filter by job status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Maximum number of jobs to return
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for job titles and descriptions
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor for next page
 *       - in: query
 *         name: timezone
 *         schema:
 *           type: string
 *         description: Timezone for date formatting
 *       - in: query
 *         name: viewerAddress
 *         schema:
 *           type: string
 *         description: Viewer's Stellar address for permission checks
 *     responses:
 *       200:
 *         description: Jobs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Job'
 *                 nextCursor:
 *                   type: string
 *                   nullable: true
 *                   description: Cursor for next page
 */
// GET /api/jobs — list jobs
router.get("/", generalJobRateLimiter, async (req, res, next) => {
  try {
    const {
      category,
      status,
      limit,
      search,
      cursor,
      timezone,
      viewerAddress,
      include_expired,
      page,
    } = req.query;
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const includeExpired = include_expired === "true";

    // Deprecated offset-style `page` param — cursor pagination is canonical (#291).
    if (page !== undefined && cursor === undefined) {
      res.set("Deprecation", "true");
      res.set("Link", '</api/jobs>; rel="deprecation"');
      res.set("Sunset", "2025-12-31");
    }

    const cacheKey = cache.jobListKey({ category, status, limit: String(safeLimit), search, cursor, timezone, viewerAddress, include_expired: String(includeExpired) });
    const cached = await cache.get(cacheKey);
    if (cached) {
      res.set("X-Cache", "HIT");
      return res.json({ success: true, ...cached, ...(page !== undefined && cursor === undefined && { _deprecation: "The `page` parameter is deprecated. Use cursor-based pagination via `nextCursor`." }) });
    }

    const result = await listJobs({
      category,
      status,
      limit: safeLimit,
      search,
      cursor,
      timezone,
      viewerAddress,
      includeExpired,
    });

    await cache.set(cacheKey, { data: result.jobs, nextCursor: result.nextCursor }, cache.TTL.JOBS_LIST);
    res.set("X-Cache", "MISS");
    res.json({
      success: true,
      data: result.jobs,
      nextCursor: result.nextCursor,
      ...(page !== undefined && cursor === undefined && {
        _deprecation: "The `page` parameter is deprecated. Use cursor-based pagination via `nextCursor`.",
      }),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/jobs/client/:publicKey — list jobs posted by a client
router.get(
  "/client/:publicKey",
  generalJobRateLimiter,
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await listJobsByClient(req.params.publicKey),
      });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/jobs/recommended/:publicKey — top 5 skill-matched open jobs for a freelancer
router.get(
  "/recommended/:publicKey",
  generalJobRateLimiter,
  async (req, res, next) => {
    try {
      const jobs = await getRecommendedJobs(req.params.publicKey);
      res.json({ success: true, data: jobs });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/jobs/:id — get single job
router.get("/:id", generalJobRateLimiter, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getJob(req.params.id) });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/jobs:
 *   post:
 *     summary: Create a new job
 *     description: Creates a new job posting in the marketplace
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *               - budget
 *               - clientId
 *             properties:
 *               title:
 *                 type: string
 *                 description: Job title
 *               description:
 *                 type: string
 *                 description: Detailed job description
 *               budget:
 *                 type: number
 *                 description: Job budget in XLM
 *               clientId:
 *                 type: string
 *                 description: Client's Stellar address
 *               category:
 *                 type: string
 *                 description: Job category
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Required skills
 *               visibility:
 *                 type: string
 *                 enum: [public, private]
 *                 default: public
 *                 description: Job visibility
 *     responses:
 *       201:
 *         description: Job created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Job'
 *       400:
 *         description: Bad request - invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// POST /api/jobs — create a new job
router.post("/", jobCreationRateLimiter, async (req, res, next) => {
  try {
    const job = await createJob(req.body);
    await cache.delPattern("jobs:list:*");
    res.status(201).json({ success: true, data: job });
  } catch (e) {
    next(e);
  }
});

// POST /api/jobs/:id/view — increment view count
router.post("/:id/view", generalJobRateLimiter, async (req, res, next) => {
  try {
    const viewCount = await incrementViewCount(req.params.id);
    res.json({ success: true, data: { viewCount } });
  } catch (e) {
    next(e);
  }
});

// POST /api/jobs/:id/invite — invite freelancer to invite-only job
router.post("/:id/invite", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { inviteFreelancerToJob } = require("../services/jobInvitationService");
    const invitation = await inviteFreelancerToJob({
      jobId: req.params.id,
      clientAddress: req.user.publicKey,
      freelancerAddress: req.body.freelancerAddress,
    });

    req.app.locals.broadcastRealtime?.("job:invited", {
      jobId: req.params.id,
      recipientAddress: invitation.freelancer_address,
      invitedAt: invitation.created_at,
    });

    res.status(201).json({ success: true, data: invitation });
  } catch (e) { next(e); }
});

// PATCH /api/jobs/:id/escrow — store escrow contract ID after on-chain lock
router.patch(
  "/:id/escrow",
  verifyJWT,
  generalJobRateLimiter,
  async (req, res, next) => {
    try {
      const { escrowContractId } = req.body;
      const job = await updateJobEscrowId(req.params.id, escrowContractId);
      await logContractInteraction({
        functionName: "create_escrow",
        callerAddress: req.user.publicKey,
        jobId: req.params.id,
        txHash: escrowContractId,
      });
      res.json({ success: true, data: job });
    } catch (e) {
      next(e);
    }
  },
);

// PATCH /api/jobs/:id/boost — boost a job listing for 7 days
router.patch("/:id/boost", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { txHash, amountXlm } = req.body;
    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({ success: false, error: "Transaction hash is required" });
    }

    // Determine boost duration from payment amount
    // 5 XLM = 7 days, 15 XLM = 30 days
    const amount = parseFloat(amountXlm) || 0;
    const boostDays = amount >= 15 ? 30 : 7;

    const job = await boostJob(req.params.id, txHash, boostDays);
    res.json({ success: true, data: job });
  } catch (e) { next(e); }
});

// GET /api/jobs/:id/analytics — job performance analytics
router.get("/:id/analytics", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { getJobAnalytics } = require("../services/jobService");
    const analytics = await getJobAnalytics(req.params.id);
    res.json({ success: true, data: analytics });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/jobs/:id/extend — extend job expiry with XLM fee
// Validates: only job owner, max 90-day total extension, charges 0.5 XLM per 7-day block
router.patch(
  "/:id/extend",
  verifyJWT,
  generalJobRateLimiter,
  async (req, res, next) => {
    try {
      const { days } = req.body;
      const validDays = [7, 14, 30];
      const daysNum = parseInt(days, 10) || 30;
      if (!validDays.includes(daysNum)) {
        return res.status(400).json({
          success: false,
          error: "Extension days must be 7, 14, or 30",
        });
      }
      const job = await extendJobExpiry(req.params.id, daysNum, req.user.publicKey);
      res.json({ success: true, data: job });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/jobs/:id/referral — track a referral click
router.post("/:id/referral", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { referrer } = req.body;
    if (!referrer)
      return res
        .status(400)
        .json({ success: false, error: "Referrer address is required" });
    await incrementShareCount(req.params.id);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/jobs/:id — roll back an orphaned job (escrow failed after creation)
router.delete(
  "/:id",
  verifyJWT,
  generalJobRateLimiter,
  async (req, res, next) => {
    try {
      await deleteJob(req.params.id);
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/jobs/:id/report — report a job
router.post("/:id/report", reportJobRateLimiter, (req, res, next) => {
  try {
    const { reporterAddress, category, description } = req.body;
    const jobId = req.params.id;
    const normalizedReporterAddress = normalizeAddress(reporterAddress);

    if (!normalizedReporterAddress)
      return res
        .status(400)
        .json({ success: false, error: "Reporter address is required" });
    if (!isValidReportCategory(category))
      return res
        .status(400)
        .json({ success: false, error: "Valid report category is required" });

    const duplicateKey = `${jobId}:${normalizedReporterAddress}`;
    if (jobReports.has(duplicateKey))
      return res
        .status(409)
        .json({ success: false, error: "You have already reported this job" });

    const report = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      jobId,
      reporterAddress: normalizedReporterAddress,
      category,
      description:
        typeof description === "string"
          ? description.trim().slice(0, 1000)
          : "",
      createdAt: new Date().toISOString(),
    };

    jobReports.set(duplicateKey, report);
    res.status(201).json({
      success: true,
      message: "Thank you for your report",
      data: report,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/jobs/:id/dispute — raise a dispute for an in-progress job
router.post(
  "/:id/dispute",
  verifyJWT,
  generalJobRateLimiter,
  async (req, res, next) => {
    try {
      const { reason, description } = req.body;
      if (!reason || !description) {
        return res.status(400).json({
          success: false,
          error: "Reason and description are required",
        });
      }
      const job = await raiseDispute(req.params.id, {
        reason,
        description,
        raisedBy: req.user.publicKey,
      });
      res.json({ success: true, data: job });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/jobs/:id/resolve — resolve a dispute (Admin only)
router.post(
  "/:id/resolve",
  verifyJWT,
  generalJobRateLimiter,
  async (req, res, next) => {
    try {
      // Basic admin check - in a real app this would be more robust
      const adminKey = process.env.ADMIN_PUBLIC_KEY;
      if (adminKey && req.user.publicKey !== adminKey) {
        return res
          .status(403)
          .json({ success: false, error: "Only admins can resolve disputes" });
      }

      const job = await resolveDispute(req.params.id);
      res.json({ success: true, data: job });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/jobs/feed.rss — RSS 2.0 feed
router.get("/feed.rss", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { category, skills, min_budget, max_budget } = req.query;
    const result = await listJobs({ category, status: "open", limit: 50 });
    const jobs = filterFeedJobs(result.jobs, { skills, min_budget, max_budget }).slice(0, 20);
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const feedUrl = `${baseUrl}/api/jobs/feed.rss${category ? `?category=${encodeURIComponent(category)}` : ""}`;
    const lastBuildDate =
      jobs.length > 0
        ? formatDateRss(new Date(jobs[0].createdAt))
        : formatDateRss(new Date());

    let rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(`Stellar MarketPay — Job Listings${feedTitleSuffix({ category, skills })}`)}</title>
    <description>Latest freelance job opportunities on Stellar MarketPay</description>
    <link>${baseUrl}/jobs</link>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
`;

    jobs.forEach((job) => {
      const jobUrl = `${baseUrl}/jobs/${job.id}`;
      const pubDate = formatDateRss(new Date(job.createdAt));
      const description = escapeXml(truncateDescription(job.description, 200));
      rss += `    <item>
      <title>${escapeXml(job.title)}</title>
      <description>${description}</description>
      <link>${jobUrl}</link>
      <guid isPermaLink="true">${jobUrl}</guid>
      <pubDate>${pubDate}</pubDate>
      <category>${escapeXml(job.category)}</category>
      <dc:creator>${escapeXml(job.clientDisplayName || job.clientAddress || "Anonymous")}</dc:creator>
      <skills>${escapeXml((job.skills || []).join(", "))}</skills>
      <budget>${escapeXml(job.budget.toString())} XLM</budget>
    </item>
`;
    });

    rss += `  </channel>
</rss>`;

    res.set("Content-Type", "application/rss+xml; charset=utf-8");
    res.send(rss);
  } catch (e) {
    next(e);
  }
});

// GET /api/jobs/feed.atom
router.get("/feed.atom", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { category, skills, min_budget, max_budget } = req.query;
    const result = await listJobs({ category, status: "open", limit: 50 });
    const jobs = filterFeedJobs(result.jobs, { skills, min_budget, max_budget }).slice(0, 20);
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const feedUrl = `${baseUrl}/api/jobs/feed.atom${category ? `?category=${encodeURIComponent(category)}` : ""}`;
    const updatedDate =
      jobs.length > 0
        ? formatDateAtom(new Date(jobs[0].createdAt))
        : formatDateAtom(new Date());

    let atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(`Stellar MarketPay — Job Listings${feedTitleSuffix({ category, skills })}`)}</title>
  <subtitle>Latest freelance job opportunities on Stellar MarketPay</subtitle>
  <link href="${baseUrl}/jobs" rel="alternate" type="text/html" />
  <link href="${feedUrl}" rel="self" type="application/atom+xml" />
  <updated>${updatedDate}</updated>
  <id>${feedUrl}</id>
`;

    jobs.forEach((job) => {
      const jobUrl = `${baseUrl}/jobs/${job.id}`;
      const published = formatDateAtom(new Date(job.createdAt));
      const summary = escapeXml(truncateDescription(job.description, 200));
      atom += `  <entry>
    <title>${escapeXml(job.title)}</title>
    <summary>${summary}</summary>
    <link href="${jobUrl}" rel="alternate" type="text/html" />
    <id>${jobUrl}</id>
    <published>${published}</published>
    <updated>${published}</updated>
    <author><name>${escapeXml(job.clientDisplayName || job.clientAddress || "Anonymous")}</name></author>
    <category term="${escapeXml(job.category)}" />
    <skills>${escapeXml((job.skills || []).join(", "))}</skills>
    <budget>${escapeXml(job.budget.toString())} XLM</budget>
  </entry>
`;
    });

    atom += `</feed>`;
    res.set("Content-Type", "application/atom+xml; charset=utf-8");
    res.send(atom);
  } catch (e) {
    next(e);
  }
});

// GET /api/jobs/drafts — list job drafts for authenticated user
router.get("/drafts", verifyJWT, async (req, res, next) => {
  try {
    const drafts = await jobDraftService.getDrafts(req.user.publicKey, 5);
    res.json({ success: true, data: drafts });
  } catch (e) {
    next(e);
  }
});

// POST /api/jobs/drafts — save or update a job draft
router.post("/drafts", verifyJWT, async (req, res, next) => {
  try {
    const draft = await jobDraftService.saveDraft(req.user.publicKey, req.body);
    res.status(201).json({ success: true, data: draft });
  } catch (e) {
    next(e);
  }
});

// GET /api/jobs/drafts/:id — get a specific draft
router.get("/drafts/:id", verifyJWT, async (req, res, next) => {
  try {
    const draft = await jobDraftService.getDraft(
      req.params.id,
      req.user.publicKey,
    );
    if (!draft)
      return res.status(404).json({ success: false, error: "Draft not found" });
    res.json({ success: true, data: draft });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/jobs/drafts/:id — delete a draft
router.delete("/drafts/:id", verifyJWT, async (req, res, next) => {
  try {
    await jobDraftService.deleteDraft(req.params.id, req.user.publicKey);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/jobs/recommended — get personalized job recommendations
router.get("/recommended", verifyJWT, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const recommendations = await recommendationService.getRecommendations(
      req.user.publicKey,
      limit,
    );
    res.json({ success: true, data: recommendations });
  } catch (e) {
    next(e);
  }
});

// GET /api/jobs/suggest — get job suggestions for autocomplete
router.get("/suggest", suggestRateLimiter, async (req, res, next) => {
  try {
    const q = req.query.q || "";
    const suggestions = await getSuggestions(q);
    res.json({ success: true, data: suggestions });
  } catch (e) { next(e); }
});

// GET /api/analytics/categories — stats per category
router.get(
  "/analytics/categories",
  generalJobRateLimiter,
  async (req, res, next) => {
    try {
      const { getCategoryAnalytics } = require("../services/jobService");
      const data = await getCategoryAnalytics();
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/analytics/overview — platform-wide totals
router.get(
  "/analytics/overview",
  generalJobRateLimiter,
  async (req, res, next) => {
    try {
      const { getAnalyticsOverview } = require("../services/jobService");
      const data = await getAnalyticsOverview();
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/jobs/bulk-cancel — cancel multiple open jobs at once
router.post(
  "/bulk-cancel",
  verifyJWT,
  jobCreationRateLimiter,
  async (req, res, next) => {
    try {
      const { jobIds } = req.body;
      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "jobIds must be a non-empty array" });
      }
      const { bulkCancelJobs } = require("../services/jobService");
      const results = await bulkCancelJobs(jobIds, req.user.publicKey);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      res.json({
        success: true,
        data: { results, succeeded, failed },
      });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/jobs/bulk-extend — extend expiry for multiple jobs at once
router.post(
  "/bulk-extend",
  verifyJWT,
  jobCreationRateLimiter,
  async (req, res, next) => {
    try {
      const { jobIds, days } = req.body;
      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "jobIds must be a non-empty array" });
      }
      const { bulkExtendJobs } = require("../services/jobService");
      const results = await bulkExtendJobs(
        jobIds,
        req.user.publicKey,
        days || 30,
      );
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      res.json({
        success: true,
        data: { results, succeeded, failed },
      });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/jobs/bulk-boost — boost multiple jobs at once
router.post(
  "/bulk-boost",
  verifyJWT,
  jobCreationRateLimiter,
  async (req, res, next) => {
    try {
      const { jobIds, txHash } = req.body;
      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "jobIds must be a non-empty array" });
      }
      if (!txHash) {
        return res
          .status(400)
          .json({ success: false, error: "txHash is required for bulk boost" });
      }
      const { bulkBoostJobs } = require("../services/jobService");
      const results = await bulkBoostJobs(jobIds, req.user.publicKey, txHash);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      res.json({
        success: true,
        data: { results, succeeded, failed },
      });
    } catch (e) {
      next(e);
    }
  },
);

module.exports = router;
