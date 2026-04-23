/**
 * src/routes/jobs.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");

const jobCreationRateLimiter = createRateLimiter(10, 1); // 10 job creations per minute
const generalJobRateLimiter = createRateLimiter(30, 1); // 100 requests per minute for listing/getting jobs


const jobService = require("../services/jobService");
const { createJob, getJob, listJobs, listJobsByClient, updateJobEscrowId, deleteJob, boostJob, incrementShareCount, trackReferral } = jobService.default || jobService;
const { verifyJWT } = require("../middleware/auth");

// ─── Feed Helpers ─────────────────────────────────────────────────────────────

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

// GET /api/jobs — list jobs (with optional ?category=&status=&limit=&search=)
router.get("/", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { category, status, limit, search, cursor, timezone } = req.query;
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const result = await listJobs({ category, status, limit: safeLimit, search, cursor, timezone });
    res.json({ success: true, data: result.jobs, nextCursor: result.nextCursor });
  } catch (e) { next(e); }
});

// GET /api/jobs/client/:publicKey — list jobs posted by a client
router.get("/client/:publicKey", generalJobRateLimiter, async (req, res, next) => {
  try { res.json({ success: true, data: await listJobsByClient(req.params.publicKey) }); }
  catch (e) { next(e); }
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

// PATCH /api/jobs/:id/escrow — store escrow contract ID after on-chain lock
router.patch("/:id/escrow", verifyJWT, generalJobRateLimiter, async (req, res, next) => {
  try {
    const { escrowContractId } = req.body;
    const job = await updateJobEscrowId(req.params.id, escrowContractId);
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

// PATCH /api/jobs/:id/share — increment share count
router.patch("/:id/share", generalJobRateLimiter, async (req, res, next) => {
  try {
    const job = await incrementShareCount(req.params.id);
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
    await deleteJob(req.params.id);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// GET /api/jobs/feed.rss — RSS 2.0 feed
router.get("/feed.rss", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { category } = req.query;
    const result = await listJobs({ category, status: "open", limit: 20 });
    const jobs = result.jobs;
    
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const feedUrl = `${baseUrl}/api/jobs/feed.rss${category ? `?category=${encodeURIComponent(category)}` : ""}`;
    const lastBuildDate = jobs.length > 0 ? formatDateRss(new Date(jobs[0].createdAt)) : formatDateRss(new Date());
    
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
    
    jobs.forEach(job => {
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
  } catch (e) { next(e); }
});

// GET /api/jobs/feed.atom — Atom 1.0 feed
router.get("/feed.atom", generalJobRateLimiter, async (req, res, next) => {
  try {
    const { category } = req.query;
    const result = await listJobs({ category, status: "open", limit: 20 });
    const jobs = result.jobs;
    
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const feedUrl = `${baseUrl}/api/jobs/feed.atom${category ? `?category=${encodeURIComponent(category)}` : ""}`;
    const updatedDate = jobs.length > 0 ? formatDateAtom(new Date(jobs[0].createdAt)) : formatDateAtom(new Date());
    
    let atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Stellar MarketPay — Job Listings</title>
  <subtitle>Latest freelance job opportunities on Stellar MarketPay</subtitle>
  <link href="${baseUrl}/jobs" rel="alternate" type="text/html" />
  <link href="${feedUrl}" rel="self" type="application/atom+xml" />
  <updated>${updatedDate}</updated>
  <id>${feedUrl}</id>
`;
    
    jobs.forEach(job => {
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
  } catch (e) { next(e); }
});

module.exports = router;
