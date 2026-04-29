/**
 * src/services/jobService.js
 * Service responsibility: Manages job listings, including creation, retrieval, searching, status updates, freelancer assignment, escrow integration, and visibility boosting.
 * All data persisted in the `jobs` PostgreSQL table.
 */
"use strict";

const pool = require("../db/pool");
const { getTimezoneOffset } = require("date-fns-tz");

/**
 * Camel-cased job record returned by this service.
 *
 * @typedef {Object} Job
 * @property {string}   id                  UUID of the job.
 * @property {string}   title               Job title (≥10 chars).
 * @property {string}   description         Job description (≥30 chars).
 * @property {string}   budget              Budget as a fixed-point string (e.g. "500.0000000").
 * @property {("XLM"|"USDC")} currency      Payment currency.
 * @property {string}   category            One of {@link VALID_CATEGORIES}.
 * @property {("public"|"private"|"invite_only")} visibility
 * @property {string[]} skills              Up to 8 skill tags.
 * @property {("open"|"in_progress"|"completed"|"cancelled")} status
 * @property {string}   clientAddress       Stellar G-address of the client.
 * @property {string|null} freelancerAddress Stellar G-address of the hired freelancer, if any.
 * @property {string|null} escrowContractId Soroban contract id for the locked escrow.
 * @property {number}   applicantCount      Cached count of applications for this job.
 * @property {number}   shareCount          Number of times the job link has been shared.
 * @property {boolean}  boosted             True while the listing is Featured.
 * @property {string|null} boostedUntil     ISO timestamp at which boost expires.
 * @property {string|null} deadline         ISO timestamp deadline (optional).
 * @property {string|null} timezone         IANA timezone name for compatibility filtering.
 * @property {string[]} screeningQuestions  Up to 5 screening questions applicants must answer.
 * @property {string}   createdAt           ISO timestamp when the job was created.
 * @property {string}   updatedAt           ISO timestamp of last write.
 */

/**
 * Input shape accepted by {@link createJob}.
 *
 * @typedef {Object} CreateJobInput
 * @property {string}   title
 * @property {string}   description
 * @property {string|number} budget
 * @property {("XLM"|"USDC")} [currency="XLM"]
 * @property {string}   category
 * @property {string[]} [skills]
 * @property {string}   [deadline]            ISO timestamp.
 * @property {string}   [timezone]            IANA timezone name.
 * @property {string[]} [screeningQuestions]  Up to 5 questions; non-empty entries are kept.
 * @property {string}   clientAddress         Stellar G-address of the posting client.
 */

/**
 * Pagination wrapper returned by {@link listJobs}.
 *
 * @typedef {Object} JobListPage
 * @property {Job[]}      jobs
 * @property {string|null} nextCursor  Opaque base64 cursor for the next page, or null when exhausted.
 */

const VALID_STATUSES = ["open", "in_progress", "completed", "cancelled"];

const VALID_CATEGORIES = [
  "Smart Contracts",
  "Frontend Development",
  "Backend Development",
  "UI/UX Design",
  "Technical Writing",
  "DevOps",
  "Security Audit",
  "Data Analysis",
  "Mobile Development",
  "Other",
];

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
 * Check if a job's timezone is compatible with the user's timezone.
 * Compatible if the time difference is within +/-3 hours.
 *
 * @param {string} jobTimezone - IANA timezone string of the job (e.g., "America/New_York")
 * @param {string} userTimezone - IANA timezone string of the user (e.g., "Europe/London")
 * @returns {boolean} true if timezones are compatible or if job has no timezone restriction
 */
function isTimezoneCompatible(jobTimezone, userTimezone) {
  if (!jobTimezone) return true;
  if (!userTimezone) return true;

  try {
    const now = new Date();
    const userOffset = getTimezoneOffset(userTimezone, now);
    const jobOffset = getTimezoneOffset(jobTimezone, now);

    // Calculate the absolute difference in hours
    const diffHours = Math.abs(userOffset - jobOffset) / (1000 * 60 * 60);

    // Return true if within ±3 hour range
    return diffHours <= 3;
  } catch {
    return true;
  }
}

/**
 * Convert a snake_case `jobs` row into the camelCase API object.
 *
 * @param {Object} row  Raw row from the `jobs` table.
 * @returns {Job}       Camel-cased job record.
 */
function rowToJob(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    budget: row.budget,
    currency: row.currency || 'XLM',
    category: row.category,
    skills: row.skills,
    status: row.status,
    clientAddress: row.client_address,
    freelancerAddress: row.freelancer_address,
    escrowContractId: row.escrow_contract_id,
    applicantCount: row.applicant_count,
    shareCount: row.share_count || 0,
    boosted: row.boosted || false,
    boostedUntil: row.boosted_until,
    deadline: row.deadline,
    timezone: row.timezone,
    screeningQuestions: row.screening_questions || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @typedef {Object} CreateJobInput
 * @property {string} title - The title of the job (min 10 characters).
 * @property {string} description - The detailed description of the job (min 30 characters).
 * @property {string|number} budget - The positive budget amount for the job.
 * @property {string} [currency='XLM'] - The currency, either 'XLM' or 'USDC'.
 * @property {string} category - The category of the job (must be a valid category).
 * @property {string[]} [skills] - Array of relevant skills (max 8).
 * @property {Date|string} [deadline] - The deadline for the job.
 * @property {string} clientAddress - The Stellar public key of the client.
 */

/**
 * Create a new job listing.
 * Note: client's profile row must already exist (FK constraint).
 *
 * @param {CreateJobInput} params - The parameters to create a job.
 * @returns {Promise<Object>} The created job object.
 * @throws {Error} If validation fails or client profile doesn't exist.
 *
 * @example
 * const newJob = await jobService.createJob({
 *   title: 'Build a Smart Contract',
 *   description: 'Need a developer to build a Soroban smart contract for an escrow service.',
 *   budget: 500,
 *   currency: 'USDC',
 *   category: 'Smart Contracts',
 *   skills: ['Soroban', 'Rust'],
 *   clientAddress: 'GBX...',
 * });
 */
async function createJob({
  title,
  description,
  budget,
  currency = "XLM",
  category,
  visibility = "public",
  skills,
  deadline,
  timezone,
  screeningQuestions,
  clientAddress,
}) {
  validatePublicKey(clientAddress);

  if (!title || title.length < 10) {
    const e = new Error("Title must be at least 10 characters");
    e.status = 400;
    throw e;
  }
  if (!description || description.length < 30) {
    const e = new Error("Description must be at least 30 characters");
    e.status = 400;
    throw e;
  }
  if (!budget || isNaN(parseFloat(budget)) || parseFloat(budget) <= 0) {
    const e = new Error("Budget must be a positive number");
    e.status = 400;
    throw e;
  }
  if (!currency || !["XLM", "USDC"].includes(currency)) {
    const e = new Error("Currency must be XLM or USDC");
    e.status = 400;
    throw e;
  }
  if (!VALID_CATEGORIES.includes(category)) {
    const e = new Error("Invalid category");
    e.status = 400;
    throw e;
  }
  if (!["public", "private", "invite_only"].includes(visibility)) {
    const e = new Error("Visibility must be public, private, or invite_only");
    e.status = 400;
    throw e;
  }

  const safeSkills = Array.isArray(skills) ? skills.slice(0, 8) : [];
  const safeScreeningQuestions = Array.isArray(screeningQuestions)
    ? screeningQuestions.slice(0, 5).filter((q) => q && q.trim().length > 0)
    : [];

  const { rows } = await pool.query(
    `
    INSERT INTO jobs
      (title, description, budget, currency, category, skills, status, client_address, deadline, timezone, screening_questions, visibility, created_at, updated_at, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, NOW(), NOW(), NOW() + INTERVAL '30 days')
    RETURNING *
    `,
    [
      title.trim(),
      description.trim(),
      parseFloat(budget),
      currency,
      category,
      safeSkills,
      clientAddress,
      deadline || null,
      timezone || null,
      safeScreeningQuestions,
      visibility,
    ]
  );

  return rowToJob(rows[0]);
}

/**
 * Retrieves a job by its ID.
 *
 * @param {number|string} id - The ID of the job to retrieve.
 * @returns {Promise<Object>} The job object.
 * @throws {Error} If the job is not found.
 */
async function getJob(id) {
  const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [id]);
  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }
  return rowToJob(rows[0]);
}

/**
 * Encode a (createdAt, id) pair into an opaque base64 cursor.
 *
 * @param {Object} jobRow  Row containing `created_at` and `id`.
 * @returns {string}        Base64-encoded JSON cursor.
 */
function encodeCursor(jobRow) {
  return Buffer.from(
    JSON.stringify({
      createdAt: jobRow.created_at,
      id: jobRow.id,
    })
  ).toString("base64");
}

/**
 * Decode a base64 pagination cursor produced by {@link encodeCursor}.
 *
 * @param {string} cursor  Base64-encoded JSON cursor.
 * @returns {{ createdAt: string, id: string }}
 * @throws {Error} 400 — when the cursor cannot be parsed.
 */
function decodeCursor(cursor) {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    if (!decoded.createdAt || !decoded.id) throw new Error("Invalid cursor");
    return decoded;
  } catch (_) {
    const e = new Error("Invalid cursor");
    e.status = 400;
    throw e;
  }
}

/**
 * @typedef {Object} ListJobsOptions
 * @property {string} [category] - Filter by job category.
 * @property {string} [status='open'] - Filter by job status.
 * @property {number} [limit=50] - Max number of results to return (max 100).
 * @property {string} [search] - Search term for title, description, or skills.
 * @property {string} [cursor] - Pagination cursor.
 * @property {string} [timezone] - Filter by timezone.
 */

/**
 * List jobs with optional filtering, searching, and pagination.
 *
 * @param {ListJobsOptions} [options={}] - Options for listing jobs.
 * @returns {Promise<{jobs: Object[], nextCursor: string|null}>} An object containing the list of jobs and an optional next cursor for pagination.
 * @throws {Error} If the provided cursor is invalid.
 */
async function listJobs({ category, status = "open", limit = 50, search, cursor, timezone } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    const idx = params.length;
    conditions.push(
      `(LOWER(title) LIKE $${idx} OR LOWER(description) LIKE $${idx} OR EXISTS (
         SELECT 1 FROM unnest(skills) s WHERE LOWER(s) LIKE $${idx}
       ))`
    );
  }

  if (viewerAddress && /^G[A-Z0-9]{55}$/.test(viewerAddress)) {
    params.push(viewerAddress);
    const viewerIdx = params.length;
    conditions.push(
      `(visibility = 'public'
        OR client_address = $${viewerIdx}
        OR (visibility = 'invite_only' AND EXISTS (
          SELECT 1 FROM job_invitations ji
          WHERE ji.job_id = jobs.id AND ji.freelancer_address = $${viewerIdx}
        )))`
    );
  } else {
    conditions.push("visibility = 'public'");
  }

  if (cursor) {
    const decoded = decodeCursor(cursor);
    params.push(decoded.createdAt, decoded.id);
    const createdAtIdx = params.length - 1;
    const idIdx = params.length;
    conditions.push(
      `(created_at < $${createdAtIdx} OR (created_at = $${createdAtIdx} AND id < $${idIdx}))`
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);

  const { rows } = await pool.query(
    `SELECT * FROM jobs ${where} ORDER BY
       CASE WHEN boosted = true AND (boosted_until IS NULL OR boosted_until > NOW()) THEN 0 ELSE 1 END,
       created_at DESC, id DESC LIMIT $${params.length}`,
    params
  );

  let jobs = rows.map(rowToJob);

  let filteredJobs = currentRows.map(rowToJob);
  if (timezone) {
    filteredJobs = filteredJobs.filter((job) => isTimezoneCompatible(job.timezone, timezone));
  }

  return { jobs };
}

/**
 * Retrieve all jobs posted by a specific client.
 *
 * @param {string} clientAddress - The Stellar public key of the client.
 * @returns {Promise<Object[]>} An array of job objects.
 * @throws {Error} If the clientAddress is an invalid Stellar public key.
 */
async function listJobsByClient(clientAddress) {
  validatePublicKey(clientAddress);
  const { rows } = await pool.query(
    "SELECT * FROM jobs WHERE client_address = $1 ORDER BY created_at DESC",
    [clientAddress]
  );
  return rows.map(rowToJob);
}

/**
 * Update the status of a specific job.
 *
 * @param {number|string} id - The ID of the job.
 * @param {string} status - The new status (must be one of VALID_STATUSES).
 * @returns {Promise<Object>} The updated job object.
 * @throws {Error} If the status is invalid or the job is not found.
 */
async function updateJobStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    const e = new Error("Invalid status");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    "UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [status, id]
  );

  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  return rowToJob(rows[0]);
}

/**
 * Assign a freelancer to a job and update its status to 'in_progress'.
 *
 * @param {number|string} jobId - The ID of the job.
 * @param {string} freelancerAddress - The Stellar public key of the freelancer.
 * @returns {Promise<Object>} The updated job object.
 * @throws {Error} If the freelancerAddress is invalid or the job is not found.
 */
async function assignFreelancer(jobId, freelancerAddress) {
  validatePublicKey(freelancerAddress);

  const { rows } = await pool.query(
    `UPDATE jobs
     SET freelancer_address = $1, status = 'in_progress', updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [freelancerAddress, jobId]
  );

  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  return rows.map(rowToJob);
}

/**
 * Update the escrow contract ID associated with a job.
 *
 * @param {number|string} jobId - The ID of the job.
 * @param {string} escrowContractId - The escrow contract ID.
 * @returns {Promise<Object>} The updated job object.
 * @throws {Error} If the escrowContractId is invalid or the job is not found.
 */
async function updateJobEscrowId(jobId, escrowContractId) {
  if (!escrowContractId || typeof escrowContractId !== "string") {
    const e = new Error("Invalid escrow contract ID");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    "UPDATE jobs SET escrow_contract_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [escrowContractId, jobId]
  );

  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  return rowToJob(rows[0]);
}

/**
 * Delete a job by its ID.
 *
 * @param {number|string} jobId - The ID of the job to delete.
 * @returns {Promise<void>} Resolves when the job is deleted.
 * @throws {Error} If the job is not found.
 */
async function deleteJob(jobId) {
  const { rowCount } = await pool.query("DELETE FROM jobs WHERE id = $1", [jobId]);
  if (!rowCount) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }
}

/**
 * Boost a job to increase its visibility for 7 days.
 *
 * @param {number|string} jobId - The ID of the job to boost.
 * @param {string} txHash - The transaction hash of the payment for boosting.
 * @returns {Promise<Object>} The updated job object.
 * @throws {Error} If the job is not found.
 */
async function boostJob(jobId, txHash) {
  // Verify job exists
  const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const boostedUntil = new Date();
  boostedUntil.setDate(boostedUntil.getDate() + 7);

  const { rows: updateRows } = await pool.query(
    `UPDATE jobs
     SET boosted = true, boosted_until = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [boostedUntil.toISOString(), jobId]
  );

  return rowToJob(rows[0]);
}

/**
 * Increment the share count for a specific job.
 *
 * @param {number|string} jobId - The ID of the job.
 * @returns {Promise<Object>} The updated job object.
 * @throws {Error} If the job is not found.
 */
async function incrementShareCount(jobId) {
  const { rows } = await pool.query(
    "UPDATE jobs SET share_count = COALESCE(share_count, 0) + 1, updated_at = NOW() WHERE id = $1 RETURNING *",
    [jobId]
  );

  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  return rowToJob(rows[0]);
}

/**
 * Auto-expire jobs that have passed their expiry date and are still open (not hired).
 * Returns the count of expired jobs.
 *
 * @returns {Promise<number>}
 */
async function expireOldJobs() {
  const { rowCount } = await pool.query(
    `UPDATE jobs
     SET status = 'cancelled',
         updated_at = NOW()
     WHERE status = 'open'
       AND freelancer_address IS NULL
       AND expires_at < NOW()`,
  );
  return rowCount;
}

/**
 * Get jobs that are expiring within N days (for warnings).
 *
 * @param {number} withinDays  Days threshold (e.g., 3)
 * @returns {Promise<Job[]>}
 */
async function getExpiringJobs(withinDays = 3) {
  const withinDate = new Date();
  withinDate.setDate(withinDate.getDate() + withinDays);

  const { rows } = await pool.query(
    `SELECT * FROM jobs
     WHERE status = 'open'
       AND freelancer_address IS NULL
       AND expires_at IS NOT NULL
       AND expires_at <= $1
     ORDER BY expires_at ASC`,
    [withinDate.toISOString()]
  );
  return rows.map(rowToJob);
}

/**
 * Get analytics for a job (applications per day, avg bid, skill distribution, time to hire).
 *
 * @param {string} jobId  UUID of the job.
 * @returns {Promise<Object>} Analytics object.
 */
async function getJobAnalytics(jobId) {
  // Applications per day (time series)
  const { rows: appsPerDayRows } = await pool.query(
    `SELECT DATE(created_at) as day, COUNT(*) as count
     FROM applications
     WHERE job_id = $1
     GROUP BY DATE(created_at)
     ORDER BY day ASC`,
    [jobId]
  );

  // Average bid amount and currency breakdown
  const { rows: bidRows } = await pool.query(
    `SELECT AVG(bid_amount::numeric) as avg_bid, currency, COUNT(*) as count
     FROM applications
     WHERE job_id = $1
     GROUP BY currency`,
    [jobId]
  );

  // Skill distribution - need to infer from freelancer profiles
  const { rows: skillRows } = await pool.query(
    `SELECT p.skills, COUNT(*) as count
     FROM applications a
     LEFT JOIN profiles p ON a.freelancer_address = p.public_key
     WHERE a.job_id = $1
     GROUP BY p.skills`,
    [jobId]
  );

  // Time to hire - from job created_at to when a freelancer was assigned (status = 'in_progress')
  const { rows: hireTimeRows } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (MIN(updated_at) - j.created_at)) / 86400 as days_to_hire
     FROM jobs j
     WHERE j.id = $1 AND j.status IN ('in_progress', 'completed')`,
    [jobId]
  );

  // Total applications and status breakdown
  const { rows: statusRows } = await pool.query(
    `SELECT status, COUNT(*) as count
     FROM applications
     WHERE job_id = $1
     GROUP BY status`,
    [jobId]
  );

  // Build aggregated skills count
  const skillDistribution = {};
  skillRows.forEach(row => {
    const skills = row.skills || [];
    skills.forEach(skill => {
      skillDistribution[skill] = (skillDistribution[skill] || 0) + 1;
    });
  });

  return {
    applicationsPerDay: appsPerDayRows.map(r => ({ day: r.day, count: parseInt(r.count) || 0 })),
    averageBidAmount: bidRows.map(r => ({
      currency: r.currency,
      avgBid: r.avg_bid ? parseFloat(r.avg_bid) : 0,
      count: parseInt(r.count) || 0
    })),
    skillDistribution,
    daysToHire: hireTimeRows[0] && hireTimeRows[0].days_to_hire ? parseFloat(hireTimeRows[0].days_to_hire) : null,
    applicationStatusCounts: statusRows.reduce((acc, r) => {
      acc[r.status] = parseInt(r.count) || 0;
      return acc;
    }, {})
  };
}

module.exports = {
  createJob,
  getJob,
  listJobs,
  listJobsByClient,
  updateJobEscrowId,
  deleteJob,
  boostJob,
  incrementShareCount,
  extendJobExpiry,
  expireOldJobs,
  getExpiringJobs,
  getJobAnalytics,
};
