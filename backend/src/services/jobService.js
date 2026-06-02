/**
 * src/services/jobService.js
 * Service responsibility: Manages job listings, including creation, retrieval, searching, status updates, freelancer assignment, escrow integration, and visibility boosting.
 * All data persisted in the `jobs` PostgreSQL table.
 */
"use strict";

const pool = require("../db/pool");
const { refreshFreelancerTier } = require("./profileService");

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
 * @property {{description:string,amount:string|number}[]} [milestones] Up to 10 milestone payouts; amounts must total budget.
 * @property {string}   clientAddress         Stellar G-address of the posting client.
 */

/**
 * Pagination wrapper returned by {@link listJobs}.
 *
 * @typedef {Object} JobListPage
 * @property {Job[]}      jobs
 * @property {string|null} nextCursor  Opaque base64 cursor for the next page, or null when exhausted.
 */

const VALID_STATUSES = [
  "open",
  "in_progress",
  "completed",
  "cancelled",
  "disputed",
];

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
function normalizeMilestoneRows(milestones, budget) {
  const fallbackAmount = parseFloat(budget || 0).toFixed(7);
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return [
      {
        description: "Final delivery",
        amount: fallbackAmount,
        status: "pending",
        releasedAt: null,
        disputedAt: null,
      },
    ];
  }

  return milestones.map((milestone) => ({
    description: String(milestone.description || "").trim(),
    amount: parseFloat(milestone.amount || 0).toFixed(7),
    status: milestone.status || "pending",
    releasedAt: milestone.releasedAt || milestone.released_at || null,
    disputedAt: milestone.disputedAt || milestone.disputed_at || null,
  }));
}

function validateMilestones(milestones, budget) {
  const numericBudget = parseFloat(budget);
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return normalizeMilestoneRows([], numericBudget);
  }

  if (milestones.length > 10) {
    const e = new Error("Jobs can have at most 10 milestones");
    e.status = 400;
    throw e;
  }

  const safeMilestones = milestones.map((milestone, index) => {
    const description = String(milestone.description || "").trim();
    const amount = parseFloat(milestone.amount);

    if (!description) {
      const e = new Error(`Milestone ${index + 1} needs a description`);
      e.status = 400;
      throw e;
    }
    if (Number.isNaN(amount) || amount <= 0) {
      const e = new Error(`Milestone ${index + 1} needs a positive amount`);
      e.status = 400;
      throw e;
    }

    return {
      description,
      amount: amount.toFixed(7),
      status: "pending",
      releasedAt: null,
      disputedAt: null,
    };
  });

  const milestoneTotal = safeMilestones.reduce(
    (sum, milestone) => sum + parseFloat(milestone.amount),
    0,
  );
  if (Math.abs(milestoneTotal - numericBudget) > 0.0000001) {
    const e = new Error("Milestone amounts must equal the job budget");
    e.status = 400;
    throw e;
  }

  return safeMilestones;
}

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
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
    milestones: normalizeMilestoneRows(row.milestones, row.budget),
    disputeReason:      row.dispute_reason,
    disputeDescription: row.dispute_description,
    disputedBy: row.disputed_by,
    disputedAt: row.disputed_at,
    expiresAt: row.expires_at,
    extendedCount: row.extended_count,
    extendedUntil: row.extended_until,
    biddingClosedAt: row.bidding_closed_at,
    viewCount: row.view_count,
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
  currency,
  category,
  skills,
  deadline,
  timezone,
  clientAddress,
  screeningQuestions,
  milestones,
  visibility,
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
  const jobVisibility = visibility || "public";
  if (!["public", "private", "invite_only"].includes(jobVisibility)) {
    const e = new Error("Visibility must be public, private, or invite_only");
    e.status = 400;
    throw e;
  }

  const safeSkills = Array.isArray(skills) ? skills.slice(0, 8) : [];
  const safeScreeningQuestions = Array.isArray(screeningQuestions)
    ? screeningQuestions.slice(0, 5).filter((q) => q && q.trim().length > 0)
    : [];
  const safeMilestones = validateMilestones(milestones, budget);

  const { rows } = await pool.query(
    `
    INSERT INTO jobs
      (title, description, budget, currency, category, skills, status, client_address, deadline, timezone, screening_questions, milestones, visibility, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, $12, NOW(), NOW())
    RETURNING *
    `,
    [
      title.trim(),
      description.trim(),
      parseFloat(budget).toFixed(7),
      currency || "XLM",
      category,
      safeSkills,
      clientAddress,
      deadline || null,
      timezone || null,
      safeScreeningQuestions,
      JSON.stringify(safeMilestones),
      jobVisibility,
    ],
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
 * Currently unused but kept for future pagination implementation.
 *
 * @param {Object} jobRow  Row containing `created_at` and `id`.
 * @returns {string}        Base64-encoded JSON cursor.
 */
// eslint-disable-next-line no-unused-vars
function encodeCursor(jobRow) {
  return Buffer.from(
    JSON.stringify({
      createdAt: jobRow.created_at,
      id: jobRow.id,
    }),
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
async function listJobs({
  category,
  status = "open",
  limit = 50,
  search,
  cursor,
  // eslint-disable-next-line no-unused-vars
  timezone,
  includeExpired,
  viewerAddress,
  min_budget,
  max_budget,
  skills,
  min_client_rating,
  duration,
  posted_since,
  max_applications,
} = {}) {
  const conditions = [];
  const params = [];

  if (status && status !== "all") {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  } else if (!includeExpired) {
    conditions.push("status != 'expired'");
  }

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  const minBudget = parseFloat(min_budget);
  if (!Number.isNaN(minBudget)) {
    params.push(minBudget);
    conditions.push(`budget >= $${params.length}`);
  }

  const maxBudget = parseFloat(max_budget);
  if (!Number.isNaN(maxBudget)) {
    params.push(maxBudget);
    conditions.push(`budget <= $${params.length}`);
  }

  const skillList = String(skills || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (skillList.length > 0) {
    params.push(skillList);
    conditions.push(`skills && $${params.length}::text[]`);
  }

  const minRating = parseFloat(min_client_rating);
  if (!Number.isNaN(minRating)) {
    params.push(minRating);
    conditions.push(
      `EXISTS (
         SELECT 1 FROM profiles p
         WHERE p.public_key = jobs.client_address
           AND COALESCE(p.rating, 0) >= $${params.length}
       )`,
    );
  }

  if (duration === "short") {
    conditions.push(
      "deadline IS NOT NULL AND deadline <= created_at + INTERVAL '7 days'",
    );
  } else if (duration === "medium") {
    conditions.push(
      "deadline IS NOT NULL AND deadline > created_at + INTERVAL '7 days' AND deadline <= created_at + INTERVAL '28 days'",
    );
  } else if (duration === "long") {
    conditions.push(
      "deadline IS NOT NULL AND deadline > created_at + INTERVAL '28 days'",
    );
  }

  if (posted_since === "today") {
    conditions.push("created_at >= date_trunc('day', NOW())");
  } else if (posted_since === "week") {
    conditions.push("created_at >= NOW() - INTERVAL '7 days'");
  } else if (posted_since === "month") {
    conditions.push("created_at >= NOW() - INTERVAL '30 days'");
  }

  const maxApps = parseInt(max_applications, 10);
  if (!Number.isNaN(maxApps)) {
    params.push(maxApps);
    conditions.push(`applicant_count <= $${params.length}`);
  }

  if (search) {
    const normalizedSearch = String(search).trim().toLowerCase();
    const tsQuery = normalizedSearch
      .split(/\s+/)
      .filter(Boolean)
      .join(" & ");
    params.push(tsQuery || normalizedSearch);
    const tsIdx = params.length;
    params.push(`%${normalizedSearch}%`);
    const likeIdx = params.length;
    conditions.push(
      `(
        job_search_vector @@ to_tsquery('simple', $${tsIdx})
        OR LOWER(title) LIKE $${likeIdx}
        OR LOWER(description) LIKE $${likeIdx}
      )`,
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
        )))`,
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
      `(created_at < $${createdAtIdx} OR (created_at = $${createdAtIdx} AND id < $${idIdx}))`,
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);

  const { rows } = await pool.query(
    `SELECT * FROM jobs ${where} ORDER BY
       CASE WHEN boosted = true AND (boosted_until IS NULL OR boosted_until > NOW()) THEN 0 ELSE 1 END,
       created_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );

  const jobs = rows.map(rowToJob);
  let nextCursor = null;

  if (rows.length === limit) {
    nextCursor = encodeCursor(rows[rows.length - 1]);
  }

  return { jobs, nextCursor };
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
    [status, id],
  );

  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const job = rowToJob(rows[0]);
  if (status === "completed" && job.freelancerAddress) {
    await refreshFreelancerTier(job.freelancerAddress);
  }

  return job;
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
    [freelancerAddress, jobId],
  );

  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  return rowToJob(rows[0]);
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
    [escrowContractId, jobId],
  );

  if (rows.length) {
    const job = rowToJob(rows[0]);
    await pool.query(
      `INSERT INTO escrows (job_id, contract_id, amount_xlm, milestones, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'funded', NOW(), NOW())
       ON CONFLICT (job_id) DO UPDATE
       SET contract_id = EXCLUDED.contract_id,
           amount_xlm = EXCLUDED.amount_xlm,
           milestones = EXCLUDED.milestones,
           updated_at = NOW()`,
      [job.id, escrowContractId, job.budget, JSON.stringify(job.milestones)],
    );
    return job;
  }

  const e = new Error("Job not found");
  e.status = 404;
  throw e;
}

/**
 * Delete a job by its ID.
 *
 * @param {number|string} jobId - The ID of the job to delete.
 * @returns {Promise<void>} Resolves when the job is deleted.
 * @throws {Error} If the job is not found.
 */
async function deleteJob(jobId) {
  const { rowCount } = await pool.query("DELETE FROM jobs WHERE id = $1", [
    jobId,
  ]);
  if (!rowCount) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }
}

/**
 * Boost a job to increase its visibility.
 * Duration is determined by the XLM payment amount:
 *   5 XLM  → 7 days
 *   15 XLM → 30 days
 *
 * @param {number|string} jobId - The ID of the job to boost.
 * @param {string} txHash - The transaction hash of the boost payment.
 * @param {number} [boostDays=7] - Number of days to boost (7 or 30).
 * @returns {Promise<Object>} The updated job object.
 * @throws {Error} If the job is not found.
 */
async function boostJob(jobId, txHash, boostDays = 7) {
  // Verify job exists
  const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [
    jobId,
  ]);
  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const boostedUntil = new Date();
  boostedUntil.setDate(boostedUntil.getDate() + boostDays);

  const { rows: updateRows } = await pool.query(
    `UPDATE jobs
     SET boosted = true, boosted_until = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [boostedUntil.toISOString(), jobId],
  );

  return rowToJob(updateRows[0]);
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
    [jobId],
  );

  const e = new Error("Job not found");
  e.status = 404;
  throw e;
}

async function raiseDispute(jobId, { reason, description, raisedBy }) {
  const { rows } = await pool.query(
    `UPDATE jobs 
     SET status = 'disputed', 
         dispute_reason = $1, 
         dispute_description = $2, 
         disputed_by = $3, 
         disputed_at = NOW(), 
         updated_at = NOW() 
     WHERE id = $4 AND status = 'in_progress'
     RETURNING *`,
    [reason, description, raisedBy, jobId],
  );

  if (!rows.length) {
    const e = new Error("Job not found or not in progress");
    e.status = 404;
    throw e;
  }

  const job = rowToJob(rows[0]);
  const recipients = new Set(
    [job.clientAddress, job.freelancerAddress].filter(Boolean),
  );

  for (const userAddress of recipients) {
    await createJobNotification({
      userAddress,
      type: EVENT_TYPES.DISPUTE_OPENED,
      title: "Dispute filed",
      body: `${raisedBy.slice(0, 6)}...${raisedBy.slice(-4)} filed a dispute for "${job.title}".`,
      jobId,
      linkPath: `/disputes/${jobId}`,
    });
  }

  return job;
}

async function resolveDispute(jobId) {
  const { rows } = await pool.query(
    `UPDATE jobs 
     SET status = 'in_progress', 
         dispute_reason = NULL, 
         dispute_description = NULL, 
         disputed_by = NULL, 
         disputed_at = NULL, 
         updated_at = NOW() 
     WHERE id = $1 AND status = 'disputed'
     RETURNING *`,
    [jobId],
  );

  if (!rows.length) {
    const e = new Error("Job not found or not disputed");
    e.status = 404;
    throw e;
  }

  return rowToJob(rows[0]);
}

async function getCategoryAnalytics() {
  const { rows } = await pool.query(`
    SELECT
      category,
      COUNT(*)                                                        AS job_count,
      AVG(budget)                                                     AS avg_budget_xlm,
      COUNT(*) FILTER (WHERE freelancer_address IS NOT NULL)          AS filled_count,
      AVG(
        EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400.0
      ) FILTER (WHERE freelancer_address IS NOT NULL)                 AS avg_days_to_fill
    FROM jobs
    GROUP BY category
    ORDER BY job_count DESC
  `);

  return rows.map((r) => ({
    category: r.category,
    jobCount: parseInt(r.job_count, 10),
    avgBudgetXLM: r.avg_budget_xlm
      ? parseFloat(parseFloat(r.avg_budget_xlm).toFixed(2))
      : 0,
    filledCount: parseInt(r.filled_count, 10),
    avgDaysToFill: r.avg_days_to_fill
      ? parseFloat(parseFloat(r.avg_days_to_fill).toFixed(1))
      : null,
  }));
}

async function getAnalyticsOverview() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                                                        AS total_jobs,
      COUNT(*) FILTER (WHERE status = 'open')                        AS open_jobs,
      COUNT(*) FILTER (WHERE status = 'in_progress')                 AS in_progress_jobs,
      COUNT(*) FILTER (WHERE status = 'completed')                   AS completed_jobs,
      AVG(budget)                                                     AS avg_budget_xlm,
      COUNT(*) FILTER (WHERE freelancer_address IS NOT NULL)          AS total_filled,
      AVG(
        EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400.0
      ) FILTER (WHERE freelancer_address IS NOT NULL)                 AS avg_days_to_fill
    FROM jobs
  `);

  const r = rows[0];
  return {
    totalJobs: parseInt(r.total_jobs, 10),
    openJobs: parseInt(r.open_jobs, 10),
    inProgressJobs: parseInt(r.in_progress_jobs, 10),
    completedJobs: parseInt(r.completed_jobs, 10),
    avgBudgetXLM: r.avg_budget_xlm
      ? parseFloat(parseFloat(r.avg_budget_xlm).toFixed(2))
      : 0,
    totalFilled: parseInt(r.total_filled, 10),
    avgDaysToFill: r.avg_days_to_fill
      ? parseFloat(parseFloat(r.avg_days_to_fill).toFixed(1))
      : null,
  };
}

/**
 * Extend a job's expiry by the given number of days.
 * Validates ownership, max 90-day total extension limit, and charges a 0.5 XLM fee per 7-day block.
 *
 * @param {string} jobId - Job UUID.
 * @param {number} days - Number of days to extend (7, 14, or 30).
 * @param {string} clientAddress - The client's Stellar address for ownership validation.
 * @returns {Promise<Object>} The updated job object.
 * @throws {Error} 400 — invalid input, 403 — not the owner, 404 — not found.
 */
async function extendJobExpiry(jobId, days = 30, clientAddress) {
  const daysNum = parseInt(days, 10);
  if (![7, 14, 30].includes(daysNum)) {
    const e = new Error("Extension days must be 7, 14, or 30");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const job = rows[0];

  if (clientAddress && job.client_address !== clientAddress) {
    const e = new Error("Only the job owner can extend expiry");
    e.status = 403;
    throw e;
  }

  // Calculate total extension from original expires_at (or created_at if never set)
  const originalDate = job.expires_at || job.created_at;
  const originalTime = new Date(originalDate).getTime();
  const currentTime = Date.now();
  const alreadyExtendedMs = currentTime - originalTime;
  const alreadyExtendedDays = alreadyExtendedMs / (1000 * 60 * 60 * 24);

  if (alreadyExtendedDays + daysNum > 90) {
    const e = new Error("Maximum total extension is 90 days from the original expiry");
    e.status = 400;
    throw e;
  }

  // Calculate fee: 0.5 XLM per 7-day block
  const feeBlocks = Math.ceil(daysNum / 7);
  const feeXlm = (0.5 * feeBlocks).toFixed(7);

  // Update the job
  const newExpiry = new Date();
  newExpiry.setDate(newExpiry.getDate() + daysNum);

  const { rows: updateRows } = await pool.query(
    `UPDATE jobs
     SET expires_at = $1,
         extended_count = COALESCE(extended_count, 0) + 1,
         extended_until = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [newExpiry.toISOString(), jobId]
  );

  const updatedJob = rowToJob(updateRows[0]);
  updatedJob.extensionFeeXlm = feeXlm;

  return updatedJob;
}

/**
 * Increment view count for a job.
 * @param {string} jobId
 * @returns {Promise<number>} New view count.
 */
async function incrementViewCount(jobId) {
  const { rows } = await pool.query(
    `UPDATE jobs SET view_count = COALESCE(view_count, 0) + 1, updated_at = NOW()
     WHERE id = $1 RETURNING view_count`,
    [jobId]
  );
  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }
  return rows[0].view_count;
}

/**
 * Get job analytics for a specific job.
 * @param {string} jobId
 * @returns {Promise<Object>}
 */
async function getJobAnalytics(jobId) {
  const { rows: jobRows } = await pool.query(
    "SELECT * FROM jobs WHERE id = $1",
    [jobId]
  );
  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const { rows: appRows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total_applications,
       COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_applications,
       ROUND(AVG(bid_amount)::numeric, 7) AS avg_bid,
       MIN(bid_amount) AS min_bid,
       MAX(bid_amount) AS max_bid
     FROM applications WHERE job_id = $1`,
    [jobId]
  );

  const { rows: viewRows } = await pool.query(
    `SELECT COUNT(*)::int AS total_views,
            COUNT(DISTINCT ip_hash)::int AS unique_views
     FROM job_views WHERE job_id = $1`,
    [jobId]
  );

  return {
    jobId,
    totalApplications: appRows[0]?.total_applications || 0,
    acceptedApplications: appRows[0]?.accepted_applications || 0,
    avgBid: appRows[0]?.avg_bid || "0",
    minBid: appRows[0]?.min_bid || "0",
    maxBid: appRows[0]?.max_bid || "0",
    totalViews: viewRows[0]?.total_views || 0,
    uniqueViews: viewRows[0]?.unique_views || 0,
  };
}

/**
 * Auto-expire jobs past their expiry date.
 * @returns {Promise<number>} Count of expired jobs.
 */
async function expireOldJobs() {
  const { rowCount } = await pool.query(
    `UPDATE jobs
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'open'
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`
  );
  return rowCount || 0;
}

/**
 * Get jobs expiring within the given number of days.
 * @param {number} daysFromNow
 * @returns {Promise<Object[]>}
 */
async function getExpiringJobs(daysFromNow = 3) {
  const { rows } = await pool.query(
    `SELECT * FROM jobs
     WHERE status = 'open'
       AND expires_at IS NOT NULL
       AND expires_at > NOW()
       AND expires_at <= NOW() + INTERVAL '1 day' * $1
     ORDER BY expires_at ASC`,
    [daysFromNow]
  );
  return rows.map(rowToJob);
}

/**
 * Bulk cancel multiple jobs owned by a client.
 * @param {string[]} jobIds
 * @param {string} clientAddress
 * @returns {Promise<Object[]>}
 */
async function bulkCancelJobs(jobIds, clientAddress) {
  const results = [];
  for (const id of jobIds) {
    try {
      const { rows } = await pool.query(
        `UPDATE jobs SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND client_address = $2 AND status = 'open'
         RETURNING id`,
        [id, clientAddress]
      );
      results.push({ id, success: rows.length > 0 });
    } catch {
      results.push({ id, success: false });
    }
  }
  return results;
}

/**
 * Bulk extend expiry for multiple jobs owned by a client.
 * @param {string[]} jobIds
 * @param {string} clientAddress
 * @param {number} days
 * @returns {Promise<Object[]>}
 */
async function bulkExtendJobs(jobIds, clientAddress, days = 30) {
  const results = [];
  for (const id of jobIds) {
    try {
      const job = await extendJobExpiry(id, days, clientAddress);
      results.push({ id, success: true, ...job });
    } catch {
      results.push({ id, success: false });
    }
  }
  return results;
}

/**
 * Bulk boost multiple jobs.
 * @param {string[]} jobIds
 * @param {string} clientAddress
 * @param {string} txHash
 * @returns {Promise<Object[]>}
 */
async function bulkBoostJobs(jobIds, clientAddress, txHash) {
  const results = [];
  for (const id of jobIds) {
    try {
      const job = await boostJob(id, txHash);
      results.push({ id, success: true, boostedUntil: job.boostedUntil });
    } catch {
      results.push({ id, success: false });
    }
  }
  return results;
}

/**
 * Get recommended jobs for a freelancer based on their skills.
 * Excludes jobs the freelancer has already applied to, been accepted for, or rejected from.
 * @param {string} publicKey
 * @returns {Promise<Object[]>}
 */
async function getRecommendedJobs(publicKey) {
  const { rows: profileRows } = await pool.query(
    "SELECT skills FROM profiles WHERE public_key = $1",
    [publicKey]
  );
  const skills = profileRows.length ? profileRows[0].skills || [] : [];

  if (!skills.length) {
    // No skills, return recent open jobs excluding applied ones
    const { rows } = await pool.query(
      `SELECT j.* FROM jobs j
       WHERE j.status = 'open'
         AND j.visibility = 'public'
         AND NOT EXISTS (
           SELECT 1 FROM applications a
           WHERE a.job_id = j.id AND a.freelancer_address = $1
         )
       ORDER BY j.created_at DESC
       LIMIT 5`,
      [publicKey]
    );
    return rows.map(rowToJob);
  }

  const { rows } = await pool.query(
    `SELECT j.* FROM jobs j
     WHERE j.status = 'open'
       AND j.visibility = 'public'
       AND j.skills && $1
       AND NOT EXISTS (
         SELECT 1 FROM applications a
         WHERE a.job_id = j.id AND a.freelancer_address = $2
       )
     ORDER BY j.created_at DESC
     LIMIT 5`,
    [skills, publicKey]
  );

  return rows.map(rowToJob);
}

async function getSuggestions(query) {
  if (!query || query.length < 2) {
    return { titles: [], skills: [], categories: [] };
  }

  const q = query.trim();
  const likePattern = `%${q}%`;

  try {
    const [titleResults, skillResults] = await Promise.all([
      pool.query(
        `SELECT DISTINCT title FROM jobs WHERE title ILIKE $1 AND status = 'open' ORDER BY title LIMIT 5`,
        [likePattern]
      ),
      pool.query(
        `SELECT DISTINCT skill FROM (SELECT unnest(skills) as skill FROM jobs WHERE status = 'open') skills WHERE skill ILIKE $1 ORDER BY skill LIMIT 3`,
        [likePattern]
      ),
    ]);

    const categoryMatches = VALID_CATEGORIES.filter((cat) =>
      cat.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 2);

    return {
      titles: titleResults.rows.map((r) => r.title),
      skills: skillResults.rows.map((r) => r.skill),
      categories: categoryMatches,
    };
  } catch (err) {
    console.error("Error fetching suggestions:", err);
    return { titles: [], skills: [], categories: [] };
  }
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
  raiseDispute,
  resolveDispute,
  getCategoryAnalytics,
  getAnalyticsOverview,
  extendJobExpiry,
  incrementViewCount,
  getJobAnalytics,
  expireOldJobs,
  getExpiringJobs,
  bulkCancelJobs,
  bulkExtendJobs,
  bulkBoostJobs,
  getRecommendedJobs,
  getSuggestions,
};
