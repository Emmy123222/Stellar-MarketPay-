/**
 * src/routes/jobs.js
 */
"use strict";

const express = require("express");
const router = express.Router();

const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");

const jobService = require("../services/jobService");
const { createJob, getJob, listJobs, listJobsByClient, updateJobEscrowId, deleteJob, boostJob, incrementShareCount, getRecommendedJobs } = jobService.default || jobService;
const { verifyJWT } = require("../middleware/auth");
const { inviteFreelancerToJob } = require("../services/jobInvitationService");
const { logContractInteraction } = require("../services/contractAuditService");
const jobDraftService = require("../services/jobDraftService");
const recommendationService = require("../services/recommendationService");

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

function normalizeAddress(address) {
  return typeof address === "string" ? address.trim() : "";
}

function isValidReportCategory(category) {
  return ["fraud", "suspicious", "spam", "inappropriate", "other"].includes(category);
}

// GET /api/jobs — list jobs
router.get("/", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { category, status, limit, search, cursor, timezone, viewerAddress } = req.query;
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const result = await listJobs({ category, status, limit: safeLimit, search, cursor, timezone, viewerAddress });
    res.json({ success: true, data: result.jobs, nextCursor: result.nextCursor });
  } catch (e) { next(e); }
});

// GET /api/jobs/client/:publicKey — list jobs posted by a client
router.get("/client/:publicKey", generalJobRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await listJobsByClient(req.params.publicKey) }); }
  catch (e) { next(e); }
});

// GET /api/jobs/recommended/:publicKey — top 5 skill-matched open jobs for a freelancer
router.get("/recommended/:publicKey", generalJobRateLimiter, async (req, res, next) => {
  try {
    const jobs = await getRecommendedJobs(req.params.publicKey);
    res.json({ success: true, data: jobs });
  } catch (e) { next(e); }
});

// GET /api/jobs/:id — get single job
router.get("/:id", generalJobRateLimiter , async (req, res, next) => {
  try { res.json({ success: true, data: await getJob(req.params.id) }); }
  catch (e) { next(e); }
});

// POST /api/jobs — create a new job
router.post("/", jobCreationRateLimiter , async (req, res, next) => {
  try {
    const job = await createJob(req.body);
    res.status(201).json({ success: true, data: job });
  } catch (e) { next(e); }
});

// POST /api/jobs/:id/invite — invite freelancer to invite-only job
router.post("/:id/invite", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
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
  } catch (e) {
    next(e);
  }
});

// PATCH /api/jobs/:id/escrow — store escrow contract ID after on-chain lock
router.patch("/:id/escrow", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
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
  } catch (e) { next(e); }
});

// PATCH /api/jobs/:id/boost — boost a job listing for 7 days
router.patch("/:id/boost", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { txHash } = req.body;
    
    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({ success: false, error: "Transaction hash is required" });
    }

    // TODO: Verify Stellar payment of 10 XLM to platform wallet
    // For now, we'll just accept the txHash
    
    const job = await boostJob(req.params.id, txHash);
    res.json({ success: true, data: job });
  } catch (e) { next(e); }
});

    res.json({
      success: true,
      data: result.jobs,
      nextCursor: result.nextCursor,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/jobs/client/:publicKey
router.get("/client/:publicKey", generalJobRateLimiter, (req, res, next) => {
  try {
    res.json({
      success: true,
      data: listJobsByClient(req.params.publicKey),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/jobs/:id/analytics — job performance analytics
router.get("/:id/analytics", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { getJobAnalytics } = require("../services/jobService");
    const analytics = await getJobAnalytics(req.params.id);
    res.json({ success: true, data: analytics });
  } catch (e) { next(e); }
});

// PATCH /api/jobs/:id/extend — extend job expiry by 30 days
router.patch("/:id/extend", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { extendJobExpiry } = require("../services/jobService");
    const job = await extendJobExpiry(req.params.id, 30, 3);
    res.json({ success: true, data: job });
  } catch (e) { next(e); }
});

// POST /api/jobs/:id/referral — track a referral click
router.post("/:id/referral", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { referrer } = req.body;
    if (!referrer) return res.status(400).json({ success: false, error: "Referrer address is required" });
    const ip = req.ip;
    await trackReferral(req.params.id, referrer, ip);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// DELETE /api/jobs/:id — roll back an orphaned job (escrow failed after creation)
router.delete("/:id", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { getExpiringJobs } = require("../services/jobService");
    const jobs = await getExpiringJobs(3);
    res.json({ success: true, data: jobs });
  } catch (e) { next(e); }
});

// POST /api/jobs/expire-old — manually trigger expiry check (also runs as background job)
router.post("/expire-old", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { expireOldJobs } = require("../services/jobService");
    const count = await expireOldJobs();
    res.json({ success: true, data: { expiredCount: count } });
  } catch (e) { next(e); }
});

// POST /api/jobs/:id/score-proposals — score all applications using AI
router.post("/:id/score-proposals", verifyJWT, async (req, res, next) => {
  try {
    const { scoreProposals } = require("../services/aiService");
    const { getApplicationsForJob } = require("../services/applicationService");
    
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });

    // Verify ownership
    if (job.clientAddress !== req.user.publicKey) {
      return res.status(403).json({ success: false, error: "Only the job client can score proposals" });
    }

    const applications = await getApplicationsForJob(req.params.id);
    const scores = await scoreProposals(job, applications);

    res.json({ success: true, data: scores });
  } catch (e) { next(e); }
});

// GET /api/jobs/suggestions — autocomplete suggestions for search
router.get("/suggestions", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: [] });

    const result = await listJobs({ status: "open", limit: 100 });
    const jobs = result.jobs;
    const query = q.toLowerCase();

    const titleSuggestions = jobs
      .filter(j => j.title.toLowerCase().includes(query))
      .slice(0, 5)
      .map(j => ({ type: "title", value: j.title }));

    const skillSuggestions = jobs
      .flatMap(j => j.skills || [])
      .filter((skill, index, self) => self.indexOf(skill) === index)
      .filter(skill => skill.toLowerCase().includes(query))
      .slice(0, 5)
      .map(skill => ({ type: "skill", value: skill }));

    const categorySuggestions = [...new Set(jobs.map(j => j.category))]
      .filter(cat => cat.toLowerCase().includes(query))
      .slice(0, 5)
      .map(cat => ({ type: "category", value: cat }));

    const suggestions = [...titleSuggestions, ...skillSuggestions, ...categorySuggestions];
    res.json({ success: true, data: suggestions });
  } catch (e) { next(e); }
});

// POST /api/jobs/:id/dispute — raise a dispute for an in-progress job
router.post("/:id/dispute", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { reason, description } = req.body;
    if (!reason || !description) {
      return res.status(400).json({ success: false, error: "Reason and description are required" });
    }
    const job = await raiseDispute(req.params.id, { 
      reason, 
      description, 
      raisedBy: req.user.publicKey 
    });
    res.json({ success: true, data: job });
  } catch (e) { next(e); }
});

// POST /api/jobs/:id/resolve — resolve a dispute (Admin only)
router.post("/:id/resolve", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    // Basic admin check - in a real app this would be more robust
    const adminKey = process.env.ADMIN_PUBLIC_KEY;
    if (adminKey && req.user.publicKey !== adminKey) {
      return res.status(403).json({ success: false, error: "Only admins can resolve disputes" });
    }
    
    const job = await resolveDispute(req.params.id);
    res.json({ success: true, data: job });
  } catch (e) { next(e); }
});

// GET /api/jobs/feed.rss — RSS 2.0 feed
router.get("/feed.rss", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { category } = req.query;
    const result = await listJobs({ category, status: "open", limit: 20 });
    const jobs = result.jobs;

    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const feedUrl = `${baseUrl}/api/jobs/feed.rss${
      category ? `?category=${encodeURIComponent(category)}` : ""
    }`;

    const lastBuildDate =
      jobs.length > 0
        ? formatDateRss(new Date(jobs[0].createdAt))
        : formatDateRss(new Date());

    let rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Stellar MarketPay — Job Listings</title>
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
    const { category } = req.query;
    const result = await listJobs({ category, status: "open", limit: 20 });
    const jobs = result.jobs;

    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const feedUrl = `${baseUrl}/api/jobs/feed.atom${
      category ? `?category=${encodeURIComponent(category)}` : ""
    }`;

    const updatedDate =
      jobs.length > 0
        ? formatDateAtom(new Date(jobs[0].createdAt))
        : formatDateAtom(new Date());

    let atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Stellar MarketPay — Job Listings</title>
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
    <category term="${escapeXml(job.category)}" />
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

// GET /api/jobs/:id
router.get("/:id", generalJobRateLimiter, (req, res, next) => {
  try {
    const job = getJob(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }

    res.json({
      success: true,
      data: job,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/jobs
router.post("/", jobCreationRateLimiter, (req, res, next) => {
  try {
    const job = createJob(req.body);

    res.status(201).json({
      success: true,
      data: job,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/jobs/:id/report
router.post("/:id/report", reportJobRateLimiter, (req, res, next) => {
  try {
    const { reporterAddress, category, description } = req.body;
    const jobId = req.params.id;
    const normalizedReporterAddress = normalizeAddress(reporterAddress);

    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }

    if (!normalizedReporterAddress) {
      return res.status(400).json({
        success: false,
        error: "Reporter address is required",
      });
    }

    if (!isValidReportCategory(category)) {
      return res.status(400).json({
        success: false,
        error: "Valid report category is required",
      });
    }

    const duplicateKey = `${jobId}:${normalizedReporterAddress}`;

    if (jobReports.has(duplicateKey)) {
      return res.status(409).json({
        success: false,
        error: "You have already reported this job",
      });
    }

    const report = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      jobId,
      reporterAddress: normalizedReporterAddress,
      category,
      description:
        typeof description === "string" ? description.trim().slice(0, 1000) : "",
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

// PATCH /api/jobs/:id/escrow
router.patch("/:id/escrow", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { escrowContractId } = req.body;
    const job = await updateJobEscrowId(req.params.id, escrowContractId);

    res.json({
      success: true,
      data: job,
    });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/jobs/:id/boost
router.patch("/:id/boost", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { txHash } = req.body;

    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({
        success: false,
        error: "Transaction hash is required",
      });
    }

    const job = await boostJob(req.params.id, txHash);

    res.json({
      success: true,
      data: job,
    });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/jobs/:id/share
router.patch("/:id/share", generalJobRateLimiter, async (req, res, next) => {
  try {
    const job = await incrementShareCount(req.params.id);

    res.json({
      success: true,
      data: job,
    });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/jobs/:id
router.delete("/:id", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    await deleteJob(req.params.id);

    res.json({
      success: true,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/jobs/drafts — list job drafts for authenticated user
router.get("/drafts", verifyJWT, async (req, res, next) => {
  try {
    const drafts = await jobDraftService.getDrafts(req.user.publicKey, 5);
    res.json({ success: true, data: drafts });
  } catch (e) { next(e); }
});

// POST /api/jobs/drafts — save or update a job draft
router.post("/drafts", verifyJWT, async (req, res, next) => {
  try {
    const draft = await jobDraftService.saveDraft(req.user.publicKey, req.body);
    res.status(201).json({ success: true, data: draft });
  } catch (e) { next(e); }
});

// GET /api/jobs/drafts/:id — get a specific draft
router.get("/drafts/:id", verifyJWT, async (req, res, next) => {
  try {
    const draft = await jobDraftService.getDraft(req.params.id, req.user.publicKey);
    if (!draft) return res.status(404).json({ success: false, error: "Draft not found" });
    res.json({ success: true, data: draft });
  } catch (e) { next(e); }
});

// DELETE /api/jobs/drafts/:id — delete a draft
router.delete("/drafts/:id", verifyJWT, async (req, res, next) => {
  try {
    await jobDraftService.deleteDraft(req.params.id, req.user.publicKey);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// GET /api/jobs/recommended — get personalized job recommendations
router.get("/recommended", verifyJWT, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const recommendations = await recommendationService.getRecommendations(req.user.publicKey, limit);
    res.json({ success: true, data: recommendations });
  } catch (e) { next(e); }
});

module.exports = router;
