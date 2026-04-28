/**
 * src/services/jobService.js
 *
 * Job listings service — owns all reads and writes against the `jobs`
 * PostgreSQL table. Responsible for validation of job inputs, cursor-based
 * pagination, status transitions, escrow contract id linkage, listing-boost
 * (Featured) state, and timezone-aware filtering of the job feed.
 *
 * @module services/jobService
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
    const diffHours = Math.abs(userOffset - jobOffset) / (1000 * 60 * 60);
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
    currency: row.currency || "XLM",
    category: row.category,
    visibility: row.visibility || "public",
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
 * Create a new job listing in `status = 'open'`.
 *
 * The client's profile row must already exist; the FK constraint on
 * `client_address` will otherwise reject the insert.
 *
 * @param {CreateJobInput} input
 * @returns {Promise<Job>}  The newly persisted job.
 * @throws {Error} 400 — when title/description/budget/category/currency fail validation.
 *
 * @example
 * const job = await createJob({
 *   title: "Build a Soroban escrow contract",
 *   description: "We need a Rust developer to ship an escrow with milestones...",
 *   budget: "500",
 *   currency: "XLM",
 *   category: "Smart Contracts",
 *   skills: ["Rust", "Soroban"],
 *   clientAddress: "GABCDEF...XYZ",
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
      (title, description, budget, currency, category, skills, status, client_address, deadline, timezone, screening_questions, visibility, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, NOW(), NOW())
    RETURNING *
    `,
    [
      title.trim(),
      description.trim(),
      parseFloat(budget).toFixed(7),
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
 * Fetch a single job by id.
 *
 * @param {string} id  UUID of the job.
 * @returns {Promise<Job>}
 * @throws {Error} 404 — when no job with this id exists.
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
 * Page through jobs, with optional filtering and ordering.
 *
 * Boosted (Featured) listings sort first; ties break on `created_at DESC, id DESC`.
 * Cursor pagination is keyset-based — pass {@link JobListPage.nextCursor} from the
 * previous page to fetch the next slice.
 *
 * @param {Object}  [opts]
 * @param {string}  [opts.category]               Restrict to a category from {@link VALID_CATEGORIES}.
 * @param {("open"|"in_progress"|"completed"|"cancelled")} [opts.status="open"]
 * @param {number}  [opts.limit=50]               Page size (clamped to 1..100).
 * @param {string}  [opts.search]                 Substring search over title, description, and skills.
 * @param {string}  [opts.cursor]                 Opaque cursor from the previous page.
 * @param {string}  [opts.timezone]               IANA timezone of the viewer; only jobs whose
 *                                                timezone is within ±3h are returned.
 * @returns {Promise<JobListPage>}
 * @throws {Error} 400 — when `cursor` is malformed.
 */
async function listJobs({ category, status = "open", limit = 50, search, cursor, timezone, viewerAddress } = {}) {
  const conditions = [];
  const params = [];

  if (status && VALID_STATUSES.includes(status)) {
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
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  params.push(safeLimit + 1);

  const { rows } = await pool.query(
    `SELECT * FROM jobs ${where} ORDER BY
       CASE WHEN boosted = true AND (boosted_until IS NULL OR boosted_until > NOW()) THEN 0 ELSE 1 END,
       created_at DESC, id DESC LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > safeLimit;
  const currentRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const nextCursor = hasMore ? encodeCursor(currentRows[currentRows.length - 1]) : null;

  let filteredJobs = currentRows.map(rowToJob);
  if (timezone) {
    filteredJobs = filteredJobs.filter((job) => isTimezoneCompatible(job.timezone, timezone));
  }

  return {
    jobs: filteredJobs,
    nextCursor,
  };
}

/**
 * List every job posted by a specific client, newest first.
 *
 * @param {string} clientAddress  Stellar G-address of the client.
 * @returns {Promise<Job[]>}
 * @throws {Error} 400 — invalid Stellar public key.
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
 * Transition a job to a new status.
 *
 * @param {string} id      UUID of the job.
 * @param {("open"|"in_progress"|"completed"|"cancelled")} status
 * @returns {Promise<Job>}
 * @throws {Error} 400 — invalid status.
 * @throws {Error} 404 — job not found.
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
 * Hire a freelancer for a job and move it to `in_progress`.
 *
 * @param {string} jobId              UUID of the job.
 * @param {string} freelancerAddress  Stellar G-address of the freelancer being hired.
 * @returns {Promise<Job>}
 * @throws {Error} 400 — invalid freelancer public key.
 * @throws {Error} 404 — job not found.
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

  return rowToJob(rows[0]);
}

/**
 * Persist the on-chain escrow contract id against a job. Called after the
 * client signs and submits the Soroban `create_escrow` transaction.
 *
 * @param {string} jobId             UUID of the job.
 * @param {string} escrowContractId  Soroban contract id (or transaction hash).
 * @returns {Promise<Job>}
 * @throws {Error} 400 — invalid escrow contract id.
 * @throws {Error} 404 — job not found.
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
 * Hard-delete a job. Used to roll back an "orphaned" job whose escrow
 * transaction failed after the row was inserted.
 *
 * @param {string} jobId  UUID of the job.
 * @returns {Promise<void>}
 * @throws {Error} 404 — job not found.
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
 * Mark a job as Featured for the next 7 days.
 *
 * The route handler accepts a Stellar transaction hash from the client
 * (intended to record the 10 XLM platform fee), but on-chain verification
 * of that payment has not yet been wired up — see the `TODO` in
 * `routes/jobs.js`. The hash is therefore not consumed by this service
 * function today.
 *
 * @param {string} jobId  UUID of the job to boost.
 * @returns {Promise<Job>}
 * @throws {Error} 404 — job not found.
 */
async function boostJob(jobId) {
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

  return rowToJob(updateRows[0]);
}

/**
 * Increment the per-job share counter. Called when the client clicks
 * "Share" or otherwise copies the job link.
 *
 * @param {string} jobId  UUID of the job.
 * @returns {Promise<Job>}
 * @throws {Error} 404 — job not found.
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

module.exports = {
  createJob,
  getJob,
  listJobs,
  listJobsByClient,
  updateJobStatus,
  assignFreelancer,
  updateJobEscrowId,
  deleteJob,
  boostJob,
  incrementShareCount,
};
