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

const pool = require("../db/pool");
const { getJob, assignFreelancer } = require("./jobService");
const { calculateFreelancerTier } = require("./profileService");

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
      `INSERT INTO applications (job_id, freelancer_address, proposal, bid_amount, currency, screening_answers, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
       RETURNING *`,
      [
        jobId,
        freelancerAddress,
        proposal.trim(),
        parseFloat(bidAmount).toFixed(7),
        currency,
        JSON.stringify(safeScreeningAnswers),
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
async function getApplicationsForJob(jobId) {
  const { rows } = await pool.query(
    `SELECT a.*,
            COALESCE(p.completed_jobs, 0) AS completed_jobs,
            ROUND(AVG(r.stars)::numeric, 2) AS avg_rating
     FROM applications a
     LEFT JOIN profiles p ON p.public_key = a.freelancer_address
     LEFT JOIN ratings r ON r.rated_address = a.freelancer_address
     WHERE a.job_id = $1
     GROUP BY a.id, p.completed_jobs
     ORDER BY a.created_at ASC`,
    [jobId]
  );
  return rows.map(rowToApp);
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

module.exports = {
  submitApplication,
  getApplicationsForJob,
  getApplicationsForFreelancer,
  acceptApplication,
};
