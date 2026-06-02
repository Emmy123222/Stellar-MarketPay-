/**
 * src/services/applicationService.js
 * Service responsibility: Manages job applications, including submission, retrieval by job or freelancer, and accepting/rejecting applications.
 * All data persisted in the `applications` PostgreSQL table.
 */
"use strict";

const crypto = require("crypto");
const pool = require("../db/pool");
const { getJob, assignFreelancer } = require("./jobService");
const { calculateFreelancerTier, isBlocked } = require("./profileService");
const { createJobNotification, EVENT_TYPES } = require("./notificationService");

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
 * @property {string|null} withdrawnAt   ISO timestamp when withdrawn, or null.
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
  const totalJobs = row.total_jobs ?? completedJobs;
  const freelancerRating =
    row.avg_rating !== null && row.avg_rating !== undefined
      ? parseFloat(row.avg_rating)
      : null;
  const totalEarnedXlm = row.total_earned_xlm ?? 0;

  return {
    id: row.id,
    jobId: row.job_id,
    freelancerAddress: row.freelancer_address,
    freelancerTier: calculateFreelancerTier({
      completedJobs,
      totalJobs,
      rating: freelancerRating,
      totalEarnedXlm,
      createdAt: row.profile_created_at,
    }),
    proposal: row.proposal,
    bidAmount: row.bid_amount,
    currency: row.currency || "XLM",
    status: row.status,
    screeningAnswers: row.screening_answers || {},
    bidCommitment: row.bid_commitment || null,
    bidRevealed: Boolean(row.bid_revealed),
    revealedBidAmount: row.revealed_bid_amount || null,
    revealedAt: row.revealed_at || null,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  };
}

// ─── service functions ───────────────────────────────────────────────────────

// async function submitApplication({ jobId, freelancerAddress, proposal, bidAmount, currency = 'XLM' }) {
/**
 * @typedef {Object} SubmitApplicationInput
 * @property {number|string} jobId - The ID of the job being applied for.
 * @property {string} freelancerAddress - The Stellar public key of the freelancer.
 * @property {string} proposal - The application proposal text (min 50 chars).
 * @property {string|number} bidAmount - The positive bid amount for the application.
 * @property {string} currency - The currency of the bid amount (default: 'XLM').
 * @property {Object} screeningAnswers - The screening answers for the job.
 */

/**
 * Submit an application for a specific job.
 *
 * @param {SubmitApplicationInput} params - The parameters for submitting an application.
 * @returns {Promise<Object>} The created application object.
 * @throws {Error} If validation fails, job is not open, client is applying to own job, or if freelancer already applied.
 *
 * @example
 * const app = await applicationService.submitApplication({
 *   jobId: 10,
 *   freelancerAddress: 'GBX...',
 *   proposal: 'I have 5 years of experience building similar applications...',
 *   bidAmount: 200,
 *   currency: 'XLM',
 *   screeningAnswers: {
 *     question1: 'answer1',
 *     question2: 'answer2',
 *   },
 * });
 */
async function submitApplication({
  jobId,
  freelancerAddress,
  proposal,
  bidAmount,
  // eslint-disable-next-line no-unused-vars
  currency = "XLM",
  screeningAnswers,
  referredBy,
  bidCommitment,
  bidNonce,
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
  if (
    !bidAmount ||
    isNaN(parseFloat(bidAmount)) ||
    parseFloat(bidAmount) <= 0
  ) {
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
      if (
        !screeningAnswers[question] ||
        screeningAnswers[question].trim().length === 0
      ) {
        const e = new Error("All screening questions must be answered");
        e.status = 400;
        throw e;
      }
    }
  }

  // Check if freelancer is blocked by the client
  const blocked = await isBlocked(job.clientAddress, freelancerAddress);
  if (blocked) {
    const e = new Error("This job is not available for applications");
    e.status = 403;
    throw e;
  }

  // Insert; the UNIQUE(job_id, freelancer_address) constraint handles duplicates.
  let appRow;
  try {
    const { rows } = await pool.query(
      `INSERT INTO applications (job_id, freelancer_address, proposal, bid_amount, status, screening_answers, referred_by, bid_commitment, bid_nonce, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, NOW())
       RETURNING *`,
      [
        jobId,
        freelancerAddress,
        proposal.trim(),
        parseFloat(bidAmount).toFixed(7),
        screeningAnswers || {},
        referredBy || null,
        bidCommitment || null,
        bidNonce || null,
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

  await createJobNotification({
    userAddress: job.clientAddress,
    type: EVENT_TYPES.APPLICATION_RECEIVED,
    title: "New application received",
    body: `${freelancerAddress.slice(0, 6)}...${freelancerAddress.slice(-4)} applied to "${job.title}".`,
    jobId,
  });

  return rowToApp(appRow);
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
  if (job.biddingClosedAt) {
    const e = new Error("Bidding is already closed");
    e.status = 409;
    throw e;
  }

  const { rows } = await pool.query(
    "UPDATE jobs SET bidding_closed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING bidding_closed_at",
    [jobId],
  );
  return { jobId, biddingClosedAt: rows[0]?.bidding_closed_at || null };
}

function hashBidReveal(bidAmount, nonce) {
  return crypto
    .createHash("sha256")
    .update(`${parseFloat(bidAmount).toFixed(7)}:${nonce}`)
    .digest("hex");
}

async function revealApplicationBid(applicationId, freelancerAddress, bidAmount, nonce) {
  validatePublicKey(freelancerAddress);
  if (!nonce || typeof nonce !== "string") {
    const e = new Error("Reveal nonce is required");
    e.status = 400;
    throw e;
  }
  if (!bidAmount || isNaN(parseFloat(bidAmount)) || parseFloat(bidAmount) <= 0) {
    const e = new Error("Reveal bid amount must be positive");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query("SELECT * FROM applications WHERE id = $1", [applicationId]);
  if (!rows.length) {
    const e = new Error("Application not found");
    e.status = 404;
    throw e;
  }
  const app = rows[0];
  if (app.freelancer_address !== freelancerAddress) {
    const e = new Error("Only the freelancer can reveal this bid");
    e.status = 403;
    throw e;
  }
  if (app.bid_revealed) {
    const e = new Error("Bid already revealed");
    e.status = 409;
    throw e;
  }
  if (!app.bid_commitment) {
    const e = new Error("No sealed commitment found for this bid");
    e.status = 400;
    throw e;
  }

  const job = await getJob(app.job_id);
  if (!job.biddingClosedAt) {
    const e = new Error("Bidding must be closed before reveal");
    e.status = 400;
    throw e;
  }
  const revealDeadline = new Date(job.biddingClosedAt).getTime() + 24 * 60 * 60 * 1000;
  if (Date.now() > revealDeadline) {
    const e = new Error("Reveal deadline has passed");
    e.status = 400;
    throw e;
  }

  const expected = hashBidReveal(bidAmount, nonce);
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

/**
 * Retrieves all applications for a specific job.
 *
 * @param {number|string} jobId - The ID of the job.
 * @returns {Promise<Object[]>} An array of application objects ordered by creation date ascending.
 */
async function getApplicationsForJob(jobId, filters = {}) {
  const { rows } = await pool.query(
    `SELECT a.*,
            COALESCE(p.completed_jobs, 0) AS completed_jobs,
            COALESCE(p.total_earned_xlm, 0) AS total_earned_xlm,
            p.created_at AS profile_created_at,
            COUNT(DISTINCT fj.id)::int AS total_jobs,
            ROUND(AVG(r.stars)::numeric, 2) AS avg_rating
     FROM applications a
     LEFT JOIN profiles p ON p.public_key = a.freelancer_address
     LEFT JOIN ratings r ON r.rated_address = a.freelancer_address
     LEFT JOIN jobs fj ON fj.freelancer_address = a.freelancer_address
     WHERE a.job_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM profiles cp
         WHERE cp.public_key = (SELECT client_address FROM jobs WHERE id = $1)
           AND a.freelancer_address = ANY(cp.blocked_addresses)
       )
     GROUP BY a.id, p.completed_jobs, p.total_earned_xlm, p.created_at
     ORDER BY a.created_at ASC`,
    [jobId],
  );
  const applications = rows.map(rowToApp);
  if (!filters.tier) return applications;
  return applications.filter((application) => application.freelancerTier === filters.tier);
}

/**
 * Retrieves all applications submitted by a specific freelancer.
 *
 * @param {string} freelancerAddress - The Stellar public key of the freelancer.
 * @returns {Promise<Object[]>} An array of application objects ordered by creation date descending.
 * @throws {Error} If the freelancerAddress is an invalid Stellar public key.
 */
async function getApplicationsForFreelancer(freelancerAddress) {
  validatePublicKey(freelancerAddress);
  const { rows } = await pool.query(
    `SELECT a.*,
            COALESCE(p.completed_jobs, 0) AS completed_jobs,
            COALESCE(p.total_earned_xlm, 0) AS total_earned_xlm,
            p.created_at AS profile_created_at,
            COUNT(DISTINCT fj.id)::int AS total_jobs,
            ROUND(AVG(r.stars)::numeric, 2) AS avg_rating
     FROM applications a
     LEFT JOIN profiles p ON p.public_key = a.freelancer_address
     LEFT JOIN ratings r ON r.rated_address = a.freelancer_address
     LEFT JOIN jobs fj ON fj.freelancer_address = a.freelancer_address
     WHERE a.freelancer_address = $1
     GROUP BY a.id, p.completed_jobs, p.total_earned_xlm, p.created_at
     ORDER BY a.created_at DESC`,
    [freelancerAddress],
  );
  return rows.map(rowToApp);
}

/**
 * Accept a specific application for a job. Also rejects all other pending applications for that job, and assigns the freelancer to the job.
 *
 * @param {number|string} applicationId - The ID of the application to accept.
 * @param {string} clientAddress - The Stellar public key of the client who owns the job.
 * @returns {Promise<Object>} The accepted application object.
 * @throws {Error} If the application is not found, client does not own the job, or the job is no longer open.
 */
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

    const { rows: rejectedApplications } = await client.query(
      `UPDATE applications
       SET status = 'rejected'
       WHERE job_id = $1 AND id <> $2 AND status = 'pending'
       RETURNING freelancer_address`,
      [app.job_id, applicationId],
    );

    await createJobNotification(
      {
        userAddress: app.freelancer_address,
        type: EVENT_TYPES.APPLICATION_ACCEPTED,
        title: "Application accepted",
        body: `Your application for "${job.title}" was accepted.`,
        jobId: app.job_id,
      },
      client,
    );

    for (const rejected of rejectedApplications) {
      await createJobNotification(
        {
          userAddress: rejected.freelancer_address,
          type: EVENT_TYPES.APPLICATION_REJECTED,
          title: "Application rejected",
          body: `Your application for "${job.title}" was not selected.`,
          jobId: app.job_id,
        },
        client,
      );
    }

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

/**
 * Withdraw a freelancer's application. Marks the application as withdrawn
 * by setting the `withdrawn_at` timestamp. Only the freelancer who submitted
 * the application can withdraw it, and only if it hasn't been accepted yet.
 *
 * @param {string} applicationId  UUID of the application to withdraw.
 * @param {string} freelancerAddress  Stellar G-address of the calling freelancer.
 * @returns {Promise<Application>}  The withdrawn application.
 * @throws {Error} 400 — invalid freelancer public key, or application already accepted.
 * @throws {Error} 403 — caller is not the application's freelancer.
 * @throws {Error} 404 — application not found.
 * @throws {Error} 409 — application already withdrawn.
 */
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

module.exports = {
  submitApplication,
  getApplicationsForJob,
  getApplicationsForFreelancer,
  acceptApplication,
  withdrawApplication,
  closeBiddingForJob,
  revealApplicationBid,
};
