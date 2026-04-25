/**
 * src/routes/jobs.js
 */
"use strict";

const express = require("express");
const router = express.Router();

const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");

const jobService = require("../services/jobService");
const {
  createJob,
  getJob,
  listJobs,
  listJobsByClient,
  updateJobEscrowId,
  deleteJob,
  boostJob,
  incrementShareCount,
} = jobService.default || jobService;

const jobCreationRateLimiter = createRateLimiter(10, 1);
const generalJobRateLimiter = createRateLimiter(30, 1);
const reportJobRateLimiter = createRateLimiter(10, 1);

const jobReports = new Map();

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
    const { category, status, limit, search, cursor, timezone } = req.query;
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));

    const result = await listJobs({
      category,
      status,
      limit: safeLimit,
      search,
      cursor,
      timezone,
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

// GET /api/jobs/feed.rss
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

module.exports = router;