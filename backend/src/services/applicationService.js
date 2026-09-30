/**
 * src/services/applicationService.js
 *
 * Applications service — owns all reads and writes against the `applications`
 * PostgreSQL table. Handles freelancer proposal submission, validation of
 * screening-question answers, listing applications by job or freelancer,
 * bulk application management, and the atomic "accept one + reject the rest" transition.
 *
 * @module services/applicationService
 */
"use strict";

const crypto = require("crypto");
const { calculateFreelancerTier } = require("./profileService");

function encodeApplicationCursor(row) {
  return Buffer.from(JSON.stringify({
    createdAt: row.created_at || row.createdAt,
    id: row.id,
  })).toString("base64url");
}

function decodeApplicationCursor(cursor) {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!decoded.createdAt || !decoded.id) throw new Error("Invalid cursor");
    return decoded;
  } catch {
    const error = new Error("Invalid application cursor");
    error.status = 400;
    throw error;
  }
}

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

// Provide an in-memory test-mode implementation so unit tests don't require
// a running Postgres instance. When `NODE_ENV === 'test'` we operate on
// `services/store.js` maps.
if (process.env.NODE_ENV === "test") {
  const store = require("./store");

  function rowToApp(row) {
    return {
      id: row.id,
      jobId: row.jobId || row.job_id,
      freelancerAddress: row.freelancerAddress || row.freelancer_address,
      freelancerTier: calculateFreelancerTier(0, null),
      proposal: row.proposal,
      bidAmount: row.bidAmount || row.bid_amount,
      currency: row.currency || "XLM",
      status: row.status,
      screeningAnswers: row.screeningAnswers || row.screening_answers || {},
      bidCommitment: row.bidCommitment || row.bid_commitment || null,
      bidRevealed: Boolean(row.bidRevealed || row.bid_revealed),
      revealedBidAmount: row.revealedBidAmount || row.revealed_bid_amount || null,
      revealedAt: row.revealedAt || row.revealed_at || null,
      withdrawnAt: row.withdrawnAt || row.withdrawn_at || null,
      createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    };
  }

  async function submitApplication({
    jobId,
    freelancerAddress,
    proposal,
    bidAmount,
    currency = "XLM",
    screeningAnswers,
    bidCommitment,
  }) {
    validatePublicKey(freelancerAddress);

    const { getJob } = require("./jobService");
    const job = await getJob(jobId);

    const { isBlocked } = require("./profileService");
    if (typeof isBlocked === "function") {
      const blocked = await isBlocked(job.clientAddress, freelancerAddress);
      if (blocked) {
        const e = new Error("You are blocked by this client");
        e.status = 403;
        throw e;
      }
    }

    if (job.status !== "open") {
      const e = new Error("Job is not open for applications");
      e.status = 400;
      throw e;
    }
    if (job.clientAddress === freelancerAddress) {
      const e = new Error("You cannot apply to your own job");
      e.status = 400;
      throw e;
    }
    if (job.visibility === "private") {
      const e = new Error("This job is private and cannot receive applications");
      e.status = 403;
      throw e;
    }

    if (!proposal || proposal.length < 50) {
      const e = new Error("Proposal must be at least 50 characters");
      e.status = 400;
      throw e;
    }
    if (!bidAmount || isNaN(parseFloat(bidAmount)) || parseFloat(bidAmount) <= 0) {
      const e = new Error("Bid must be a positive number");
      e.status = 400;
      throw e;
    }

    // Duplicate check
    for (const app of store.applications.values()) {
      if (app.jobId === jobId && app.freelancerAddress === freelancerAddress) {
        const e = new Error("You have already applied to this job");
        e.status = 409;
        throw e;
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const appRow = {
      id,
      jobId,
      freelancerAddress,
      proposal: proposal.trim(),
      bidAmount: parseFloat(bidAmount).toFixed(7),
      currency,
      screeningAnswers: screeningAnswers || {},
      bidCommitment: bidCommitment || null,
      status: "pending",
      createdAt: now,
    };

    store.applications.set(id, appRow);

    const jobRow = store.jobs.get(jobId);
    if (jobRow) {
      jobRow.applicantCount = (jobRow.applicantCount || 0) + 1;
      store.jobs.set(jobId, jobRow);
    }

    return rowToApp(appRow);
  }

  async function acceptApplication(applicationId, clientAddress) {
    validatePublicKey(clientAddress);

    const appRow = store.applications.get(applicationId);
    if (!appRow) {
      const e = new Error("Application not found");
      e.status = 404;
      throw e;
    }

    const { getJob, assignFreelancer } = require("./jobService");
    const job = await getJob(appRow.jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can accept applications");
      e.status = 403;
      throw e;
    }
    if (job.status !== "open") {
      const e = new Error("Job is no longer accepting applications");
      e.status = 400;
      throw e;
    }

    // Accept chosen, reject others
    for (const [id, app] of store.applications.entries()) {
      if (app.jobId === appRow.jobId) {
        if (id === applicationId) app.status = "accepted";
        else if (app.status === "pending") app.status = "rejected";
        store.applications.set(id, app);
      }
    }

    await assignFreelancer(appRow.jobId, appRow.freelancerAddress);

    return rowToApp(store.applications.get(applicationId));
  }

  async function withdrawApplication(applicationId, freelancerAddress) {
    validatePublicKey(freelancerAddress);
    const appRow = store.applications.get(applicationId);
    if (!appRow) {
      const e = new Error("Application not found");
      e.status = 404;
      throw e;
    }
    if (appRow.freelancerAddress !== freelancerAddress) {
      const e = new Error("Only the freelancer who submitted can withdraw this application");
      e.status = 403;
      throw e;
    }
    if (appRow.status === "accepted") {
      const e = new Error("Cannot withdraw an already-accepted application");
      e.status = 400;
      throw e;
    }
    if (appRow.withdrawnAt) {
      const e = new Error("Application has already been withdrawn");
      e.status = 409;
      throw e;
    }
    appRow.withdrawnAt = new Date().toISOString();
    store.applications.set(applicationId, appRow);
    return rowToApp(appRow);
  }

  async function closeBiddingForJob(jobId, clientAddress) {
    validatePublicKey(clientAddress);
    const { getJob } = require("./jobService");
    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the client can close bidding");
      e.status = 403;
      throw e;
    }
    if (job.status !== "open") {
      const e = new Error("Bidding can only be closed while job is open");
      e.status = 400;
      throw e;
    }
    if (job.biddingClosedAt || job.bidding_closed_at) {
      const e = new Error("Bidding is already closed");
      e.status = 400;
      throw e;
    }
    job.biddingClosedAt = new Date().toISOString();
    store.jobs.set(jobId, job);
    return { jobId, biddingClosedAt: job.biddingClosedAt };
  }

  async function revealApplicationBid(applicationId, freelancerAddress, bidAmount, nonce) {
    validatePublicKey(freelancerAddress);
    if (!nonce) {
      const e = new Error("Reveal nonce is required");
      e.status = 400;
      throw e;
    }
    const parsedBid = parseFloat(bidAmount);
    if (isNaN(parsedBid) || parsedBid <= 0) {
      const e = new Error("Reveal bid amount must be positive");
      e.status = 400;
      throw e;
    }
    const appRow = store.applications.get(applicationId);
    if (!appRow) {
      const e = new Error("Application not found");
      e.status = 404;
      throw e;
    }
    if (appRow.freelancerAddress !== freelancerAddress) {
      const e = new Error("Only the freelancer can reveal this bid");
      e.status = 403;
      throw e;
    }
    const expected = crypto.createHash("sha256").update(`${parseFloat(bidAmount).toFixed(7)}:${nonce}`).digest("hex");
    if (expected !== appRow.bidCommitment) {
      const e = new Error("Commitment verification failed");
      e.status = 400;
      throw e;
    }
    appRow.bidRevealed = true;
    appRow.revealedBidAmount = parseFloat(bidAmount).toFixed(7);
    appRow.revealedAt = new Date().toISOString();
    store.applications.set(applicationId, appRow);
    return rowToApp(appRow);
  }

  async function extendBiddingClose(jobId, clientAddress) {
    validatePublicKey(clientAddress);
    const { getJob } = require("./jobService");
    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can extend bidding");
      e.status = 403;
      throw e;
    }
    if (!job.biddingClosedAt && !job.bidding_closed_at) {
      const e = new Error("Bidding has not been closed yet");
      e.status = 400;
      throw e;
    }
    const current = new Date(job.biddingClosedAt || job.bidding_closed_at).getTime();
    job.biddingClosedAt = new Date(current + 5 * 60 * 1000).toISOString();
    store.jobs.set(jobId, job);
    return { jobId, biddingClosedAt: job.biddingClosedAt };
  }

  async function bulkUpdateApplications({ applicationIds, action, status, clientAddress }) {
    validatePublicKey(clientAddress);
    if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
      const e = new Error("applicationIds must be a non-empty array");
      e.status = 400;
      throw e;
    }
    const normalized = (action || status || "").toLowerCase();
    let targetStatus;
    if (normalized === "reject" || normalized === "rejected") targetStatus = "rejected";
    else if (normalized === "shortlist" || normalized === "shortlisted") targetStatus = "shortlisted";
    else {
      const e = new Error("Invalid action. Must be 'reject' or 'shortlist'");
      e.status = 400;
      throw e;
    }
    const { getJob } = require("./jobService");
    const updated = [];
    let parentJobId = null;
    for (const id of applicationIds) {
      const appRow = store.applications.get(id);
      if (!appRow) continue;
      const job = await getJob(appRow.jobId || appRow.job_id);
      if (job.clientAddress !== clientAddress) {
        const e = new Error("Only the job client can update applications");
        e.status = 403;
        throw e;
      }
      parentJobId = job.id;
      appRow.status = targetStatus;
      store.applications.set(id, appRow);
      updated.push(rowToApp(appRow));
    }
    if (updated.length === 0) {
      const e = new Error("No applications found");
      e.status = 404;
      throw e;
    }
    return {
      updatedCount: updated.length,
      status: targetStatus,
      jobId: parentJobId,
      applications: updated,
    };
  }

  module.exports = {
    submitApplication,
    getApplicationsForJob: async (jobId, { limit = 20, cursor = null, tier = null } = {}) => {
      let rows = Array.from(store.applications.values())
        .filter((a) => a.jobId === jobId)
        .sort((a, b) => new Date(a.createdAt || a.created_at).getTime() - new Date(b.createdAt || b.created_at).getTime());
      if (tier) {
        rows = rows.filter((a) => calculateFreelancerTier(0, null) === tier);
      }
      const decodedCursor = cursor ? decodeApplicationCursor(cursor) : null;
      const start = decodedCursor ? rows.findIndex((row) => row.id === decodedCursor.id) + 1 : 0;
      const page = rows.slice(start, start + limit + 1);
      const hasNext = page.length > limit;
      const applications = page.slice(0, limit).map(rowToApp);
      applications.applications = applications;
      applications.nextCursor = hasNext ? encodeApplicationCursor(page[limit - 1]) : null;
      return applications;
    },
    getApplicationsForFreelancer: async (freelancerAddress) =>
      Array.from(store.applications.values())
        .filter((a) => a.freelancerAddress === freelancerAddress)
        .map(rowToApp),
    acceptApplication,
    withdrawApplication,
    closeBiddingForJob,
    revealApplicationBid,
    extendBiddingClose,
    bulkUpdateApplications,
  };
} else {
  const pool = require("../db/pool");
  const { getJob, assignFreelancer } = require("./jobService");

  function rowToApp(row) {
    const completedJobs = row.completed_jobs ?? 0;
    const freelancerRating =
      row.avg_rating !== null && row.avg_rating !== undefined ? parseFloat(row.avg_rating) : null;

    return {
      id: row.id,
      jobId: row.job_id,
      freelancerAddress: row.freelancer_address,
      freelancerTier: calculateFreelancerTier(completedJobs, freelancerRating),
      proposal: row.proposal,
      bidAmount: row.bid_amount,
      currency: row.currency || "XLM",
      status: row.status,
      screeningAnswers: row.screening_answers || {},
      bidCommitment: row.bid_commitment || null,
      bidRevealed: Boolean(row.bid_revealed),
      revealedBidAmount: row.revealed_bid_amount || null,
      revealedAt: row.revealed_at || null,
      withdrawnAt: row.withdrawn_at || null,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
    };
  }

  async function submitApplication({
    jobId,
    freelancerAddress,
    proposal,
    bidAmount,
    currency = "XLM",
    screeningAnswers,
    bidCommitment,
  }) {
    validatePublicKey(freelancerAddress);

    const job = await getJob(jobId);

    const { isBlocked } = require("./profileService");
    if (typeof isBlocked === "function") {
      const blocked = await isBlocked(job.clientAddress, freelancerAddress);
      if (blocked) {
        const e = new Error("This job is not available for applications");
        e.status = 403;
        throw e;
      }
    }

    if (job.status !== "open") {
      const e = new Error("Job is not open for applications");
      e.status = 400;
      throw e;
    }
    if (job.clientAddress === freelancerAddress) {
      const e = new Error("You cannot apply to your own job");
      e.status = 400;
      throw e;
    }
    if (job.visibility === "private") {
      const e = new Error("This job is private and cannot receive applications");
      e.status = 403;
      throw e;
    }
    if (job.visibility === "invite_only") {
      const { rows: inviteRows } = await pool.query(
        "SELECT 1 FROM job_invitations WHERE job_id = $1 AND freelancer_address = $2",
        [jobId, freelancerAddress],
      );
      if (!inviteRows.length) {
        const e = new Error("You are not invited to this job");
        e.status = 403;
        throw e;
      }
    }
    if (!proposal || proposal.length < 50) {
      const e = new Error("Proposal must be at least 50 characters");
      e.status = 400;
      throw e;
    }
    if (!bidAmount || isNaN(parseFloat(bidAmount)) || parseFloat(bidAmount) <= 0) {
      const e = new Error("Bid must be a positive number");
      e.status = 400;
      throw e;
    }

    if (job.screeningQuestions && job.screeningQuestions.length > 0) {
      if (!screeningAnswers || typeof screeningAnswers !== "object") {
        const e = new Error("Screening answers are required for this job");
        e.status = 400;
        throw e;
      }
      for (const question of job.screeningQuestions) {
        if (!screeningAnswers[question] || screeningAnswers[question].trim().length === 0) {
          const e = new Error("All screening questions must be answered");
          e.status = 400;
          throw e;
        }
      }
    }

    const safeScreeningAnswers =
      screeningAnswers && typeof screeningAnswers === "object" ? screeningAnswers : {};

    let appRow;
    try {
      const { rows } = await pool.query(
        `INSERT INTO applications (job_id, freelancer_address, proposal, bid_amount, currency, screening_answers, status, bid_commitment, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW())
         RETURNING *`,
        [
          jobId,
          freelancerAddress,
          proposal.trim(),
          parseFloat(bidAmount).toFixed(7),
          currency,
          JSON.stringify(safeScreeningAnswers),
          bidCommitment || null,
        ],
      );
      appRow = rows[0];
    } catch (err) {
      if (err.code === "23505") {
        const e = new Error("You have already applied to this job");
        e.status = 409;
        throw e;
      }
      throw err;
    }

    await pool.query(
      "UPDATE jobs SET applicant_count = applicant_count + 1, updated_at = NOW() WHERE id = $1",
      [jobId],
    );

    return rowToApp(appRow);
  }

  async function getApplicationsForJob(jobId, options = {}) {
    const isPaginated = options.limit !== undefined || options.cursor !== undefined;
    const limit = options.limit === undefined ? 20 : options.limit;
    const cursor = options.cursor || null;
    const tier = options.tier || null;

    const values = [jobId];
    let cursorClause = "";
    if (cursor) {
      const decodedCursor = decodeApplicationCursor(cursor);
      values.push(decodedCursor.createdAt, decodedCursor.id);
      cursorClause = "AND (a.created_at > $2::timestamptz OR (a.created_at = $2::timestamptz AND a.id > $3::uuid))";
    }
    values.push(limit + 1);

    const { rows } = await pool.query(
      `SELECT a.*,
              COALESCE(p.completed_jobs, 0) AS completed_jobs,
              ROUND(AVG(r.stars)::numeric, 2) AS avg_rating
       FROM applications a
       LEFT JOIN profiles p ON p.public_key = a.freelancer_address
       LEFT JOIN ratings r ON r.rated_address = a.freelancer_address
       WHERE a.job_id = $1
       ${cursorClause}
       GROUP BY a.id, p.completed_jobs
       ORDER BY a.created_at ASC, a.id ASC
       LIMIT $${values.length}`,
      values,
    );
    const hasNext = rows.length > limit;
    let apps = rows.slice(0, limit).map(rowToApp);
    if (tier) {
      apps = apps.filter((app) => app.freelancerTier === tier);
    }
    if (isPaginated) {
      return {
        applications: apps,
        nextCursor: hasNext ? encodeApplicationCursor(rows[limit - 1]) : null,
      };
    }
    return apps;
  }

  async function getApplicationsForFreelancer(freelancerAddress) {
    validatePublicKey(freelancerAddress);
    const { rows } = await pool.query(
      `SELECT a.*,
              COALESCE(p.completed_jobs, 0) AS completed_jobs,
              ROUND(AVG(r.stars)::numeric, 2) AS avg_rating
       FROM applications a
       LEFT JOIN profiles p ON p.public_key = a.freelancer_address
       LEFT JOIN ratings r ON r.rated_address = a.freelancer_address
       WHERE a.freelancer_address = $1
       GROUP BY a.id, p.completed_jobs
       ORDER BY a.created_at DESC`,
      [freelancerAddress],
    );
    return rows.map(rowToApp);
  }

  async function acceptApplication(applicationId, clientAddress) {
    validatePublicKey(clientAddress);

    const { rows: appRows } = await pool.query(
      "SELECT * FROM applications WHERE id = $1",
      [applicationId],
    );
    if (!appRows.length) {
      const e = new Error("Application not found");
      e.status = 404;
      throw e;
    }
    const app = appRows[0];

    const job = await getJob(app.job_id);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can accept applications");
      e.status = 403;
      throw e;
    }
    if (job.status !== "open") {
      const e = new Error("Job is no longer accepting applications");
      e.status = 400;
      throw e;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: updated } = await client.query(
        "UPDATE applications SET status = 'accepted', accepted_at = NOW() WHERE id = $1 RETURNING *",
        [applicationId],
      );

      await client.query(
        `UPDATE applications
         SET status = 'rejected'
         WHERE job_id = $1 AND id <> $2 AND status = 'pending'`,
        [app.job_id, applicationId],
      );

      await client.query("COMMIT");

      await assignFreelancer(app.job_id, app.freelancer_address);

      return rowToApp(updated[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async function withdrawApplication(applicationId, freelancerAddress) {
    validatePublicKey(freelancerAddress);

    const { rows: appRows } = await pool.query(
      "SELECT * FROM applications WHERE id = $1",
      [applicationId],
    );
    if (!appRows.length) {
      const e = new Error("Application not found");
      e.status = 404;
      throw e;
    }
    const app = appRows[0];

    if (app.freelancer_address !== freelancerAddress) {
      const e = new Error(
        "Only the freelancer who submitted can withdraw this application",
      );
      e.status = 403;
      throw e;
    }
    if (app.status === "accepted") {
      const e = new Error("Cannot withdraw an already-accepted application");
      e.status = 400;
      throw e;
    }
    if (app.withdrawn_at) {
      const e = new Error("Application has already been withdrawn");
      e.status = 409;
      throw e;
    }

    const { rows: updated } = await pool.query(
      "UPDATE applications SET withdrawn_at = NOW() WHERE id = $1 RETURNING *",
      [applicationId],
    );

    await pool.query(
      "UPDATE jobs SET applicant_count = GREATEST(applicant_count - 1, 0), updated_at = NOW() WHERE id = $1",
      [app.job_id],
    );

    return rowToApp(updated[0]);
  }

  async function closeBiddingForJob(jobId, clientAddress) {
    validatePublicKey(clientAddress);
    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the client can close bidding");
      e.status = 403;
      throw e;
    }
    if (job.status !== "open") {
      const e = new Error("Bidding can only be closed while job is open");
      e.status = 400;
      throw e;
    }
    if (job.biddingClosedAt || job.bidding_closed_at) {
      const e = new Error("Bidding is already closed");
      e.status = 400;
      throw e;
    }
    const { rows } = await pool.query(
      "UPDATE jobs SET bidding_closed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING bidding_closed_at",
      [jobId],
    );
    const biddingClosedAt = rows[0]?.bidding_closed_at || new Date().toISOString();
    return { jobId, biddingClosedAt };
  }

  async function revealApplicationBid(applicationId, freelancerAddress, bidAmount, nonce) {
    validatePublicKey(freelancerAddress);
    if (nonce === undefined || nonce === null || nonce === "") {
      const e = new Error("Reveal nonce is required");
      e.status = 400;
      throw e;
    }
    const parsedBid = parseFloat(bidAmount);
    if (isNaN(parsedBid) || parsedBid <= 0) {
      const e = new Error("Reveal bid amount must be positive");
      e.status = 400;
      throw e;
    }

    const { rows: appRows } = await pool.query(
      "SELECT * FROM applications WHERE id = $1",
      [applicationId],
    );
    if (!appRows.length) {
      const e = new Error("Application not found");
      e.status = 404;
      throw e;
    }
    const app = appRows[0];

    if (app.freelancer_address !== freelancerAddress) {
      const e = new Error("Only the freelancer can reveal this bid");
      e.status = 403;
      throw e;
    }

    const expected = crypto.createHash("sha256")
      .update(`${parseFloat(bidAmount).toFixed(7)}:${nonce}`)
      .digest("hex");
    if (expected !== app.bid_commitment) {
      const e = new Error("Commitment verification failed");
      e.status = 400;
      throw e;
    }

    const { rows: updatedRows } = await pool.query(
      `UPDATE applications
       SET bid_revealed = TRUE,
           revealed_bid_amount = $2,
           revealed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [applicationId, parseFloat(bidAmount).toFixed(7)],
    );
    return rowToApp(updatedRows[0]);
  }

  async function extendBiddingClose(jobId, clientAddress) {
    validatePublicKey(clientAddress);
    const job = await getJob(jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error("Only the job client can extend bidding");
      e.status = 403;
      throw e;
    }
    if (!job.biddingClosedAt && !job.bidding_closed_at) {
      const e = new Error("Bidding has not been closed yet");
      e.status = 400;
      throw e;
    }
    const currentClose = new Date(job.biddingClosedAt || job.bidding_closed_at).getTime();
    const extendedTime = new Date(currentClose + 5 * 60 * 1000).toISOString();
    await pool.query(
      "UPDATE jobs SET bidding_closed_at = $1 WHERE id = $2",
      [extendedTime, jobId],
    );
    return { jobId, biddingClosedAt: extendedTime };
  }

  async function bulkUpdateApplications({ applicationIds, action, status, clientAddress }) {
    validatePublicKey(clientAddress);
    if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
      const e = new Error("applicationIds must be a non-empty array");
      e.status = 400;
      throw e;
    }
    const normalized = (action || status || "").toLowerCase();
    let targetStatus;
    if (normalized === "reject" || normalized === "rejected") targetStatus = "rejected";
    else if (normalized === "shortlist" || normalized === "shortlisted") targetStatus = "shortlisted";
    else {
      const e = new Error("Invalid action. Must be 'reject' or 'shortlist'");
      e.status = 400;
      throw e;
    }

    const { rows: appRows } = await pool.query(
      `SELECT a.*, j.client_address, j.id AS parent_job_id, j.title AS job_title
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE a.id = ANY($1::uuid[])`,
      [applicationIds],
    );

    if (appRows.length === 0) {
      const e = new Error("No applications found");
      e.status = 404;
      throw e;
    }

    const unauthorized = appRows.some((row) => row.client_address !== clientAddress);
    if (unauthorized) {
      const e = new Error("Only the job client can update applications");
      e.status = 403;
      throw e;
    }

    const { rows: updatedRows } = await pool.query(
      `UPDATE applications
       SET status = $1
       WHERE id = ANY($2::uuid[])
       RETURNING *`,
      [targetStatus, applicationIds],
    );

    const updatedApps = updatedRows.map(rowToApp);
    return {
      updatedCount: updatedApps.length,
      status: targetStatus,
      jobId: appRows[0]?.job_id,
      applications: updatedApps,
    };
  }

  module.exports = {
    submitApplication,
    getApplicationsForJob,
    getApplicationsForFreelancer,
    acceptApplication,
    withdrawApplication,
    closeBiddingForJob,
    revealApplicationBid,
    extendBiddingClose,
    bulkUpdateApplications,
  };
}
