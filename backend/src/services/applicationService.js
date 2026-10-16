/**
 * src/services/applicationService.js
 *
 * Applications service — owns all reads and writes against the `applications`
 * PostgreSQL table. Handles freelancer proposal submission, validation of
 * screening-question answers, listing applications by job or freelancer, and
 * the atomic "accept one + reject the rest" transition that hires a freelancer.
 *
 * @module services/applicationService
 */
"use strict";

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

// Provide an in-memory test-mode implementation so unit tests don't require
// a running Postgres instance. When `NODE_ENV === 'test'` we operate on
// `services/store.js` maps.
if (process.env.NODE_ENV === 'test') {
  const store = require('./store');
  const crypto = require('crypto');
  const pool = require('../db/pool');
  const statusHistory = new Map();

  function validatePublicKey(key) {
    if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
      const e = new Error("Invalid Stellar public key");
      e.status = 400;
      throw e;
    }
  }

  function rowToApp(row) {
    return {
      id: row.id,
      jobId: row.jobId || row.job_id,
      freelancerAddress: row.freelancerAddress || row.freelancer_address,
      freelancerTier: calculateFreelancerTier(0, null),
      proposal: row.proposal,
      bidAmount: row.bidAmount || row.bid_amount,
      currency: row.currency || 'XLM',
      status: row.status,
      screeningAnswers: row.screeningAnswers || row.screening_answers || {},
      createdAt: row.createdAt || row.created_at || new Date().toISOString(),
      withdrawnAt: row.withdrawnAt || row.withdrawn_at || null,
      bidRevealed: row.bidRevealed ?? row.bid_revealed ?? false,
      revealedBidAmount: row.revealedBidAmount || row.revealed_bid_amount || null,
      biddingClosedAt: row.biddingClosedAt || row.bidding_closed_at || null,
    };
  }

  async function submitApplication({ jobId, freelancerAddress, proposal, bidAmount, currency = 'XLM', screeningAnswers, bidCommitment }) {
    validatePublicKey(freelancerAddress);

    const { getJob } = require('./jobService');
    const job = await getJob(jobId);
    if (job.status !== 'open') {
      const e = new Error('Job is not open for applications');
      e.status = 400;
      throw e;
    }
    if (job.clientAddress === freelancerAddress) {
      const e = new Error('You cannot apply to your own job');
      e.status = 400;
      throw e;
    }
    if (job.visibility === 'private') {
      const e = new Error('This job is private and cannot receive applications');
      e.status = 403;
      throw e;
    }
    if (job.visibility === 'invite_only') {
      const { rows: inviteRows } = await pool.query(
        "SELECT 1 FROM job_invitations WHERE job_id = $1 AND freelancer_address = $2",
        [jobId, freelancerAddress]
      );
      if (!inviteRows.length) {
        const e = new Error('You are not invited to this job');
        e.status = 403;
        throw e;
      }
    }

    if (!proposal || proposal.length < 50) {
      const e = new Error('Proposal must be at least 50 characters');
      e.status = 400;
      throw e;
    }
    if (!bidAmount || isNaN(parseFloat(bidAmount)) || parseFloat(bidAmount) <= 0) {
      const e = new Error('Bid must be a positive number');
      e.status = 400;
      throw e;
    }

    // Duplicate check
    for (const app of store.applications.values()) {
      if (app.jobId === jobId && app.freelancerAddress === freelancerAddress) {
        const e = new Error('You have already applied to this job');
        e.status = 409;
        throw e;
      }
    }

    let appRow;
    try {
      const { rows } = await pool.query(
        `INSERT INTO applications (job_id, freelancer_address, proposal, bid_amount, currency, screening_answers, bid_commitment, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
         RETURNING *`,
        [
          jobId,
          freelancerAddress,
          proposal.trim(),
          parseFloat(bidAmount).toFixed(7),
          currency,
          JSON.stringify(screeningAnswers || {}),
          bidCommitment || null,
        ]
      );
      appRow = rows[0];
    } catch (err) {
      if (err.code === "23505") {
        const e = new Error('You have already applied to this job');
        e.status = 409;
        throw e;
      }
      throw err;
    }

    store.applications.set(appRow.id, rowToApp(appRow));

    const jobRow = { ...job, applicantCount: (job.applicantCount || 0) + 1 };
    store.jobs.set(jobId, jobRow);

    const result = rowToApp(appRow);
    return result;
  }

  async function acceptApplication(applicationId, clientAddress) {
    validatePublicKey(clientAddress);

    const appRow = store.applications.get(applicationId);
    if (!appRow) {
      const e = new Error('Application not found');
      e.status = 404;
      throw e;
    }

    const { getJob, assignFreelancer } = require('./jobService');
    const job = await getJob(appRow.jobId);
    if (job.clientAddress !== clientAddress) {
      const e = new Error('Only the job client can accept applications');
      e.status = 403;
      throw e;
    }
    if (job.status !== 'open') {
      const e = new Error('Job is no longer accepting applications');
      e.status = 400;
      throw e;
    }

    // Accept chosen, reject others
    for (const [id, app] of store.applications.entries()) {
      if (app.jobId === appRow.jobId) {
        if (id === applicationId) app.status = 'accepted';
        else if (app.status === 'pending') app.status = 'rejected';
        store.applications.set(id, app);
      }
    }

    await assignFreelancer(appRow.jobId, appRow.freelancerAddress);

    return rowToApp(store.applications.get(applicationId));
  }

  async function updateStatus(applicationId, newStatus, changedBy) {
    const app = store.applications.get(applicationId);
    if (!app) { const e = new Error('Application not found'); e.status = 404; throw e; }
    if (!['pending', 'shortlisted', 'accepted', 'rejected'].includes(newStatus)) {
      const e = new Error('Invalid application status'); e.status = 400; throw e;
    }
    const entry = { id: crypto.randomUUID(), applicationId, oldStatus: app.status, newStatus, changedBy, changedAt: new Date().toISOString() };
    app.status = newStatus;
    store.applications.set(applicationId, app);
    statusHistory.set(applicationId, [...(statusHistory.get(applicationId) || []), entry]);
    return rowToApp(app);
  }

  async function getApplicationStatusHistory(applicationId) {
    if (!store.applications.has(applicationId)) { const e = new Error('Application not found'); e.status = 404; throw e; }
    return statusHistory.get(applicationId) || [];
  }

  async function withdrawApplication(applicationId, freelancerAddress) {
    const app = store.applications.get(applicationId);
    if (!app) { const e = new Error('Application not found'); e.status = 404; throw e; }
    if (app.freelancerAddress !== freelancerAddress) { const e = new Error('Only the freelancer who submitted can withdraw this application'); e.status = 403; throw e; }
    if (app.status === 'accepted') { const e = new Error('Cannot withdraw an already-accepted application'); e.status = 400; throw e; }
    app.status = 'withdrawn';
    app.withdrawnAt = new Date().toISOString();
    store.applications.set(applicationId, app);
    return rowToApp(app);
  }

  async function closeBiddingForJob(jobId, clientAddress) {
    const job = store.jobs.get(jobId);
    if (!job) { const e = new Error('Job not found'); e.status = 404; throw e; }
    if (job.clientAddress !== clientAddress) { const e = new Error('Only the client can close bidding'); e.status = 403; throw e; }
    if (job.status !== 'open') { const e = new Error('Bidding can only be closed while job is open'); e.status = 400; throw e; }
    if (job.biddingClosedAt) { const e = new Error('Bidding is already closed'); e.status = 400; throw e; }
    job.biddingClosedAt = new Date().toISOString();
    store.jobs.set(jobId, job);
    return { jobId, biddingClosedAt: job.biddingClosedAt };
  }

  async function revealApplicationBid(applicationId, freelancerAddress, bidAmount, nonce) {
    const app = store.applications.get(applicationId);
    if (!app) { const e = new Error('Application not found'); e.status = 404; throw e; }
    if (!/^G[A-Z0-9]{55}$/.test(freelancerAddress)) { const e = new Error('Invalid Stellar public key'); e.status = 400; throw e; }
    if (app.freelancerAddress !== freelancerAddress) { const e = new Error('Only the freelancer can reveal this bid'); e.status = 403; throw e; }
    if (!nonce || nonce.trim() === '') { const e = new Error('Reveal nonce is required'); e.status = 400; throw e; }
    if (!bidAmount || parseFloat(bidAmount) <= 0) { const e = new Error('Reveal bid amount must be positive'); e.status = 400; throw e; }
    const expectedCommitment = crypto.createHash('sha256').update(`${parseFloat(bidAmount).toFixed(7)}:${nonce}`).digest('hex');
    if (!app.bidCommitment || app.bidCommitment !== expectedCommitment) { const e = new Error('Commitment verification failed'); e.status = 400; throw e; }
    app.bidRevealed = true;
    app.revealedBidAmount = parseFloat(bidAmount).toFixed(7);
    app.revealedAt = new Date().toISOString();
    store.applications.set(applicationId, app);
    return rowToApp(app);
  }

  async function extendBiddingClose(jobId, clientAddress) {
    const job = store.jobs.get(jobId);
    if (!job) { const e = new Error('Job not found'); e.status = 404; throw e; }
    if (job.clientAddress !== clientAddress) { const e = new Error('Only the job client can extend bidding'); e.status = 403; throw e; }
    if (!job.biddingClosedAt) { const e = new Error('Bidding has not been closed yet'); e.status = 400; throw e; }
    const currentClose = new Date(job.biddingClosedAt).getTime();
    const now = Date.now();
    const finalWindowMs = 10 * 60 * 1000;
    if ((currentClose - now) > finalWindowMs) { const e = new Error('Bidding can only be extended in the final 10 minutes'); e.status = 400; throw e; }
    const extended = new Date(currentClose + 5 * 60 * 1000);
    job.biddingClosedAt = extended.toISOString();
    store.jobs.set(jobId, job);
    return { jobId, biddingClosedAt: job.biddingClosedAt };
  }

  async function bulkUpdateApplications({ applicationIds, action, clientAddress }) {
    if (!Array.isArray(applicationIds) || applicationIds.length === 0) { const e = new Error('applicationIds must be a non-empty array'); e.status = 400; throw e; }
    const validActions = ['reject', 'shortlist', 'accept'];
    const status = action || 'reject';
    if (!validActions.includes(status)) { const e = new Error('Invalid action'); e.status = 400; throw e; }
    const updated = [];
    for (const id of applicationIds) {
      const app = store.applications.get(id);
      if (!app) continue;
      const job = store.jobs.get(app.jobId);
      if (!job || job.clientAddress !== clientAddress) { const e = new Error('Only the job client can update applications'); e.status = 403; throw e; }
      app.status = status;
      store.applications.set(id, app);
      updated.push(rowToApp(app));
    }
    const jobId = updated.length ? updated[0].jobId : null;
    return { updatedCount: updated.length, status, applications: updated, jobId };
  }

  module.exports = {
    submitApplication,
    getApplicationsForJob: async (jobId, { limit = 20, cursor = null } = {}) => {
      const rows = Array.from(store.applications.values())
        .filter(a => a.jobId === jobId)
        .sort((a, b) => new Date(a.createdAt || a.created_at).getTime() - new Date(b.createdAt || b.created_at).getTime());
      const decodedCursor = cursor ? decodeApplicationCursor(cursor) : null;
      const start = decodedCursor ? rows.findIndex(row => row.id === decodedCursor.id) + 1 : 0;
      const page = rows.slice(start, start + limit + 1);
      const hasNext = page.length > limit;
      const applications = page.slice(0, limit).map(rowToApp);
      applications.nextCursor = hasNext ? encodeApplicationCursor(page[limit - 1]) : null;
      return applications;
    },
    getApplicationsForFreelancer: async (freelancerAddress) => Array.from(store.applications.values()).filter(a => a.freelancerAddress === freelancerAddress).map(rowToApp),
    acceptApplication,
    updateStatus,
    getApplicationStatusHistory,
    withdrawApplication,
    closeBiddingForJob,
    revealApplicationBid,
    extendBiddingClose,
    bulkUpdateApplications,
  };

}
else {
  const pool = require("../db/pool");
  const crypto = require("crypto");
  const { getJob, assignFreelancer } = require("./jobService");
  const { isBlocked } = require("./profileService");
/**
 * Camel-cased application record returned by this service.
 *
 * @typedef {Object} Application
 * @property {string} id                 UUID of the application.
 * @property {string} jobId              UUID of the parent job.
 * @property {string} freelancerAddress  Stellar G-address of the applicant.
 * @property {string} freelancerTier     Computed tier label (see `calculateFreelancerTier`).
 * @property {string} proposal           Cover letter / proposal text (≥50 chars).
 * @property {string} bidAmount          Bid as a fixed-point string (e.g. "450.0000000").
 * @property {("XLM"|"USDC")} currency   Bid currency.
 * @property {("pending"|"accepted"|"rejected")} status
 * @property {Object<string,string>} screeningAnswers  Map of question → answer.
 * @property {string} createdAt          ISO timestamp.
 */

/**
 * Input shape accepted by {@link submitApplication}.
 *
 * @typedef {Object} SubmitApplicationInput
 * @property {string} jobId
 * @property {string} freelancerAddress
 * @property {string} proposal
 * @property {string|number} bidAmount
 * @property {("XLM"|"USDC")} [currency="XLM"]
 * @property {Object<string,string>} [screeningAnswers]  Required only when the parent
 *                                                       job has screening questions.
 */

/**
 * Throws a 400 Error when `key` is not a valid Stellar G-address.
 *
 * @param {string} key  Stellar account public key.
 * @returns {void}
 * @throws {Error}      `status === 400` if the key fails the G-address regex.
 */
function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

/**
 * Convert a snake_case `applications` row (joined with profile/rating
 * aggregates) into the camelCase API object.
 *
 * @param {Object} row  Raw DB row.
 * @returns {Application}
 */
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
    createdAt: row.created_at,
    withdrawnAt: row.withdrawn_at || null,
    bidRevealed: row.bid_revealed ?? false,
    revealedBidAmount: row.revealed_bid_amount || null,
    biddingClosedAt: row.bidding_closed_at || null,
  };
}

/**
 * Submit a freelancer's proposal to a job. Inserts a row in `applications`
 * and increments the parent job's `applicant_count`. Returns the new
 * application as a camel-cased {@link Application}.
 *
 * @param {SubmitApplicationInput} input
 * @returns {Promise<Application>}
 * @throws {Error} 400 — invalid public key, proposal too short, bid not positive,
 *                       or screening answers missing/incomplete.
 * @throws {Error} 400 — job is not `open`.
 * @throws {Error} 400 — applicant is the job's own client.
 * @throws {Error} 404 — job not found.
 * @throws {Error} 409 — duplicate application from the same freelancer.
 *
 * @example
 * const application = await submitApplication({
 *   jobId: "f4d3...e1",
 *   freelancerAddress: "GXYZ...ABC",
 *   proposal: "I have shipped 5 Soroban contracts and...",
 *   bidAmount: "450",
 *   currency: "XLM",
 *   screeningAnswers: { "Years of Rust?": "4" },
 * });
 */
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
      [jobId, freelancerAddress]
    );
    if (!inviteRows.length) {
      const e = new Error("You are not invited to this job");
      e.status = 403;
      throw e;
    }
  }
  if (await isBlocked(freelancerAddress, job.clientAddress)) {
    const e = new Error("This job is not available for applications");
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
      `INSERT INTO applications (job_id, freelancer_address, proposal, bid_amount, currency, screening_answers, bid_commitment, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
       RETURNING *`,
      [
        jobId,
        freelancerAddress,
        proposal.trim(),
        parseFloat(bidAmount).toFixed(7),
        currency,
        JSON.stringify(safeScreeningAnswers),
        bidCommitment || null,
      ]
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
    [jobId]
  );

  return rowToApp(appRow);
}

/**
 * List every application for a given job, oldest first. Joins in profile
 * `completed_jobs` and the freelancer's average rating so the result row can
 * compute a freelancer tier label.
 *
 * @param {string} jobId  UUID of the job.
 * @returns {Promise<Application[]>}
 */
async function getApplicationsForJob(jobId, { limit = 20, cursor = null } = {}) {
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
    values
  );
  const hasNext = rows.length > limit;
  return {
    applications: rows.slice(0, limit).map(rowToApp),
    nextCursor: hasNext ? encodeApplicationCursor(rows[limit - 1]) : null,
  };
}

/**
 * List every application submitted by a freelancer, newest first.
 *
 * @param {string} freelancerAddress  Stellar G-address of the freelancer.
 * @returns {Promise<Application[]>}
 * @throws {Error} 400 — invalid Stellar public key.
 */
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
    [freelancerAddress]
  );
  return rows.map(rowToApp);
}

/**
 * Accept a freelancer's proposal. Atomically marks the chosen application
 * `accepted` and rejects every other pending application on the same job,
 * then assigns the freelancer to the job (which transitions it to
 * `in_progress`).
 *
 * Wrapped in a single Postgres transaction so a partial failure cannot
 * leave two accepted applications on one job.
 *
 * @param {string} applicationId  UUID of the application to accept.
 * @param {string} clientAddress  Stellar G-address of the calling client; must
 *                                match the parent job's `client_address`.
 * @returns {Promise<Application>}  The newly accepted application.
 * @throws {Error} 400 — invalid client public key, or job no longer open.
 * @throws {Error} 403 — caller is not the job's client.
 * @throws {Error} 404 — application or job not found.
 */
  async function acceptApplication(applicationId, clientAddress) {
  validatePublicKey(clientAddress);

  const { rows: appRows } = await pool.query("SELECT * FROM applications WHERE id = $1", [applicationId]);
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
      [applicationId]
    );

    await client.query(
      `UPDATE applications
       SET status = 'rejected'
       WHERE job_id = $1 AND id <> $2 AND status = 'pending'`,
      [app.job_id, applicationId]
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

  async function updateStatus(applicationId, newStatus, changedBy) {
    if (!['pending', 'shortlisted', 'accepted', 'rejected'].includes(newStatus)) {
      const e = new Error('Invalid application status'); e.status = 400; throw e;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, status FROM applications WHERE id = $1 FOR UPDATE', [applicationId],
      );
      if (!rows.length) { const e = new Error('Application not found'); e.status = 404; throw e; }
      const oldStatus = rows[0].status;
      await client.query('UPDATE applications SET status = $1 WHERE id = $2', [newStatus, applicationId]);
      await client.query(
        `INSERT INTO application_status_history (application_id, old_status, new_status, changed_by)
         VALUES ($1, $2, $3, $4)`, [applicationId, oldStatus, newStatus, changedBy || null],
      );
      await client.query('COMMIT');
      const { rows: updated } = await pool.query('SELECT * FROM applications WHERE id = $1', [applicationId]);
      return rowToApp(updated[0]);
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }

  async function getApplicationStatusHistory(applicationId) {
    const { rows: appRows } = await pool.query('SELECT id FROM applications WHERE id = $1', [applicationId]);
    if (!appRows.length) { const e = new Error('Application not found'); e.status = 404; throw e; }
    const { rows } = await pool.query(
      `SELECT id, application_id AS "applicationId", old_status AS "oldStatus",
              new_status AS "newStatus", changed_by AS "changedBy", changed_at AS "changedAt"
       FROM application_status_history WHERE application_id = $1 ORDER BY changed_at ASC`, [applicationId],
    );
    return rows;
  }

  async function withdrawApplication(applicationId, freelancerAddress) {
    validatePublicKey(freelancerAddress);
    const { rows } = await pool.query('SELECT * FROM applications WHERE id = $1', [applicationId]);
    if (!rows.length) { const e = new Error('Application not found'); e.status = 404; throw e; }
    const app = rows[0];
    if (app.freelancer_address !== freelancerAddress) { const e = new Error('Only the freelancer who submitted can withdraw this application'); e.status = 403; throw e; }
    if (app.status === 'accepted') { const e = new Error('Cannot withdraw an already-accepted application'); e.status = 400; throw e; }
    const { rows: updated } = await pool.query('UPDATE applications SET status = $2, withdrawn_at = NOW() WHERE id = $1 RETURNING *', [applicationId, 'withdrawn']);
    return rowToApp(updated[0]);
  }

  async function closeBiddingForJob(jobId, clientAddress) {
    validatePublicKey(clientAddress);
    const { rows: jobRows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (!jobRows.length) { const e = new Error('Job not found'); e.status = 404; throw e; }
    const job = jobRows[0];
    if (job.client_address !== clientAddress) { const e = new Error('Only the client can close bidding'); e.status = 403; throw e; }
    if (job.status !== 'open') { const e = new Error('Bidding can only be closed while job is open'); e.status = 400; throw e; }
    if (job.bidding_closed_at) { const e = new Error('Bidding is already closed'); e.status = 400; throw e; }
    const { rows } = await pool.query('UPDATE jobs SET bidding_closed_at = NOW() WHERE id = $1 RETURNING bidding_closed_at', [jobId]);
    return { jobId, biddingClosedAt: rows[0].bidding_closed_at };
  }

  async function revealApplicationBid(applicationId, freelancerAddress, bidAmount, nonce) {
    validatePublicKey(freelancerAddress);
    if (!nonce || nonce.trim() === '') { const e = new Error('Reveal nonce is required'); e.status = 400; throw e; }
    if (!bidAmount || parseFloat(bidAmount) <= 0) { const e = new Error('Reveal bid amount must be positive'); e.status = 400; throw e; }
    const { rows: appRows } = await pool.query('SELECT * FROM applications WHERE id = $1', [applicationId]);
    if (!appRows.length) { const e = new Error('Application not found'); e.status = 404; throw e; }
    const app = appRows[0];
    if (app.freelancer_address !== freelancerAddress) { const e = new Error('Only the freelancer can reveal this bid'); e.status = 403; throw e; }
    const expectedCommitment = crypto.createHash('sha256').update(`${parseFloat(bidAmount).toFixed(7)}:${nonce}`).digest('hex');
    if (!app.bid_commitment || app.bid_commitment !== expectedCommitment) { const e = new Error('Commitment verification failed'); e.status = 400; throw e; }
    const { rows: updated } = await pool.query('UPDATE applications SET bid_revealed = true, revealed_bid_amount = $2, revealed_at = NOW() WHERE id = $1 RETURNING *', [applicationId, parseFloat(bidAmount).toFixed(7)]);
    return rowToApp(updated[0]);
  }

  async function extendBiddingClose(jobId, clientAddress) {
    validatePublicKey(clientAddress);
    const { rows: jobRows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (!jobRows.length) { const e = new Error('Job not found'); e.status = 404; throw e; }
    const job = jobRows[0];
    if (job.client_address !== clientAddress) { const e = new Error('Only the job client can extend bidding'); e.status = 403; throw e; }
    if (!job.bidding_closed_at) { const e = new Error('Bidding has not been closed yet'); e.status = 400; throw e; }
    const currentClose = new Date(job.bidding_closed_at).getTime();
    const now = Date.now();
    if ((currentClose - now) > 10 * 60 * 1000) { const e = new Error('Bidding can only be extended in the final 10 minutes'); e.status = 400; throw e; }
    const extended = new Date(currentClose + 5 * 60 * 1000);
    const { rows } = await pool.query('UPDATE jobs SET bidding_closed_at = $1 WHERE id = $2 RETURNING bidding_closed_at', [extended.toISOString(), jobId]);
    return { jobId, biddingClosedAt: rows[0].bidding_closed_at };
  }

  async function bulkUpdateApplications({ applicationIds, action, clientAddress }) {
    validatePublicKey(clientAddress);
    if (!Array.isArray(applicationIds) || applicationIds.length === 0) { const e = new Error('applicationIds must be a non-empty array'); e.status = 400; throw e; }
    const actionToStatus = { reject: 'rejected', shortlist: 'shortlisted', accept: 'accepted' };
    const status = actionToStatus[action] || action;
    if (!['rejected', 'shortlisted', 'accepted'].includes(status)) { const e = new Error('Invalid action'); e.status = 400; throw e; }
    const appRows = await pool.query('SELECT a.*, j.client_address FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.id = ANY($1::uuid[])', [applicationIds]);
    const rows = appRows.rows;
    for (const row of rows) {
      if (row.client_address !== clientAddress) { const e = new Error('Only the job client can update applications'); e.status = 403; throw e; }
    }
    const ids = rows.map(r => r.id);
    const { rows: updated } = await pool.query('UPDATE applications SET status = $1 WHERE id = ANY($2::uuid[]) RETURNING *', [status, ids]);
    const applications = updated.map(rowToApp);
    const jobId = applications.length ? applications[0].jobId : null;
    return { updatedCount: applications.length, status, applications, jobId };
  }

  module.exports = {
    submitApplication,
    getApplicationsForJob,
    getApplicationsForFreelancer,
    acceptApplication,
    updateStatus,
    getApplicationStatusHistory,
    withdrawApplication,
    closeBiddingForJob,
    revealApplicationBid,
    extendBiddingClose,
    bulkUpdateApplications,
  };
}
