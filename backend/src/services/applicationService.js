/**
 * src/services/applicationService.js
 * All data persisted in the `applications` PostgreSQL table.
 */
"use strict";

const pool = require("../db/pool");
const { getJob, assignFreelancer } = require("./jobService");
const { calculateFreelancerTier } = require("./profileService");

// ─── helpers ─────────────────────────────────────────────────────────────────

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

/** Convert snake_case DB row → camelCase API object */
function rowToApp(row) {
  const completedJobs = row.completed_jobs ?? 0;
  const freelancerRating = row.avg_rating !== null && row.avg_rating !== undefined
    ? parseFloat(row.avg_rating)
    : null;

  return {
    id:                row.id,
    jobId:             row.job_id,
    freelancerAddress: row.freelancer_address,
    freelancerTier:    calculateFreelancerTier(completedJobs, freelancerRating),
    proposal:          row.proposal,
    bidAmount:         row.bid_amount,
    currency:          row.currency || 'XLM',
    status:            row.status,
    screeningAnswers:  row.screening_answers || {},
    createdAt:         row.created_at,
  };
}

// ─── service functions ───────────────────────────────────────────────────────

async function submitApplication({ jobId, freelancerAddress, proposal, bidAmount, screeningAnswers }) {
  validatePublicKey(freelancerAddress);

  // Validate the job (throws 404 if missing)
  const job = await getJob(jobId);

  if (job.status !== "open") {
    const e = new Error("Job is not open for applications"); e.status = 400; throw e;
  }
  if (job.clientAddress === freelancerAddress) {
    const e = new Error("You cannot apply to your own job"); e.status = 400; throw e;
  }
  if (!proposal || proposal.length < 50) {
    const e = new Error("Proposal must be at least 50 characters"); e.status = 400; throw e;
  }
  if (!bidAmount || isNaN(parseFloat(bidAmount)) || parseFloat(bidAmount) <= 0) {
    const e = new Error("Bid must be a positive number"); e.status = 400; throw e;
  }

  // Validate screening answers if job has screening questions
  if (job.screeningQuestions && job.screeningQuestions.length > 0) {
    if (!screeningAnswers || typeof screeningAnswers !== "object") {
      const e = new Error("Screening answers are required for this job"); e.status = 400; throw e;
    }
    for (const question of job.screeningQuestions) {
      if (!screeningAnswers[question] || screeningAnswers[question].trim().length === 0) {
        const e = new Error("All screening questions must be answered"); e.status = 400; throw e;
      }
    }
  }

  // Insert; the UNIQUE(job_id, freelancer_address) constraint handles duplicates.
  let appRow;
  try {
    const { rows } = await query(
      `INSERT INTO applications (job_id, freelancer_address, proposal, bid_amount, status, screening_answers, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW())
       RETURNING *`,
      [jobId, freelancerAddress, proposal.trim(), parseFloat(bidAmount).toFixed(7), screeningAnswers || {}]
    );
    appRow = rows[0];
  } catch (err) {
    // Postgres unique-violation code
    if (err.code === "23505") {
      const e = new Error("You have already applied to this job"); e.status = 409; throw e;
    }
    throw err;
  }

  // Increment applicant count
  await pool.query(
    "UPDATE jobs SET applicant_count = applicant_count + 1, updated_at = NOW() WHERE id = $1",
    [jobId]
  );

  return rowToApp(appRow);
}

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

async function acceptApplication(applicationId, clientAddress) {
  validatePublicKey(clientAddress);

  // Fetch the application
  const { rows: appRows } = await pool.query(
    "SELECT * FROM applications WHERE id = $1",
    [applicationId]
  );
  if (!appRows.length) {
    const e = new Error("Application not found"); e.status = 404; throw e;
  }
  const app = appRows[0];

  // Verify the calling client owns the job
  const job = await getJob(app.job_id);
  if (job.clientAddress !== clientAddress) {
    const e = new Error("Only the job client can accept applications"); e.status = 403; throw e;
  }
  if (job.status !== "open") {
    const e = new Error("Job is no longer accepting applications"); e.status = 400; throw e;
  }

  // Run accept + mass-reject atomically
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Accept this one
    const { rows: updated } = await client.query(
      "UPDATE applications SET status = 'accepted', accepted_at = NOW() WHERE id = $1 RETURNING *",
      [applicationId]
    );

    // Reject all other pending applications for the same job
    await client.query(
      `UPDATE applications
       SET status = 'rejected'
       WHERE job_id = $1 AND id <> $2 AND status = 'pending'`,
      [app.job_id, applicationId]
    );

    await client.query("COMMIT");
    app.status = "accepted";  // reflect in-memory before returning

    // Assign freelancer (updates jobs table; runs outside the transaction above
    // because jobService manages its own queries via the shared pool)
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
