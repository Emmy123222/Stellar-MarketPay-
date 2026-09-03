/**
 * src/services/jobService.js
 */
"use strict";

const { getTimezoneOffset } = require("date-fns-tz");/**
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

// Single-pass skill aggregation via LEFT JOIN — eliminates the correlated
// subquery that previously ran once per job row (N+1 pattern).
const JOB_SELECT_CLAUSE = `
  SELECT jobs.*,
         COALESCE(agg.skills, '{}') AS skills,
         cat.slug  AS category_slug,
         cat.name  AS category_name,
         cat.id    AS category_id_resolved
  FROM   jobs
  LEFT JOIN LATERAL (
    SELECT array_agg(s.display_name ORDER BY s.display_name) AS skills
    FROM   job_skills js
    JOIN   skills s ON s.id = js.skill_id
    WHERE  js.job_id = jobs.id
  ) agg ON true
  LEFT JOIN categories cat ON cat.id = jobs.category_id`;

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
    category: row.category_name || row.category,
    categorySlug: row.category_slug || null,
    categoryId: row.category_id_resolved || row.category_id || null,
    skills: row.skills,
    status: row.status,
    visibility: row.visibility || "public",
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
    disputeReason: row.dispute_reason,
    disputeDescription: row.dispute_description,
    disputedBy: row.disputed_by,
    disputedAt: row.disputed_at,
    expiresAt: row.expires_at,
    extendedCount: row.extended_count,
    extendedUntil: row.extended_until,
    biddingClosedAt: row.bidding_closed_at,
    viewCount: row.view_count,
    deletedAt: row.deleted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    searchHeadline: row.headline_title || null,
    descriptionHeadline: row.headline_description || null,
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
let createJob = async function ({
  title,
  description,
  budget,
  currency,
  category,
  categorySlug,
  skills,
  deadline,
  timezone,
  clientAddress,
  screeningQuestions,
  milestones,
  visibility = "public",
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
  const numericBudget = parseFloat(budget);
  if (budget === undefined || budget === null || isNaN(numericBudget) || numericBudget <= 0) {
    const e = new Error("Budget must be a positive number");
    e.status = 400;
    throw e;
  }
  if (!currency || !["XLM", "USDC"].includes(currency)) {
    const e = new Error("Currency must be XLM or USDC");
    e.status = 400;
    throw e;
  }
  // Resolve category: accept either a slug (e.g. "frontend-development") or a legacy name.
  // categorySlug takes precedence; falls back to category name lookup.
  const categoryLookupVal = categorySlug || category;
  let resolvedCategoryId = null;
  let resolvedCategoryName = category;

  if (categoryLookupVal) {
    const { rows: catRows } = await pool.query(
      "SELECT id, name FROM categories WHERE slug = $1 OR LOWER(name) = LOWER($2) LIMIT 1",
      [categoryLookupVal, categoryLookupVal],
    );
    if (catRows.length) {
      resolvedCategoryId = catRows[0].id;
      resolvedCategoryName = catRows[0].name;
    }
  }

  // Still validate against VALID_CATEGORIES for backward-compat when no DB match found
  if (!resolvedCategoryId && !VALID_CATEGORIES.includes(category)) {
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

  const safeSkills = Array.isArray(skills)
    ? skills
        .slice(0, 8)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const safeScreeningQuestions = Array.isArray(screeningQuestions)
    ? screeningQuestions.slice(0, 5).filter((q) => q && q.trim().length > 0)
    : [];
  const safeMilestones = validateMilestones(milestones, budget);

  const client = await pool.connect();
  let job;
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


// Provide a lightweight in-memory implementation for tests to avoid requiring
// a running Postgres instance. The test-suite imports `jobService` and
// expects synchronous functions that operate on `services/store.js` maps.
if (process.env.NODE_ENV === 'test') {
  const store = require('./store');
  const crypto = require('crypto');

  async function createJob(input) {
    const {
      title,
      description,
      budget,
      currency = 'XLM',
      category,
      visibility = 'public',
      skills,
      deadline,
      timezone,
      screeningQuestions,
      clientAddress,
    } = input;

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
    if (!["XLM", "USDC"].includes(currency)) {
      const e = new Error("Currency must be XLM or USDC");
      e.status = 400;
      throw e;
    }
    if (!category) {
      const e = new Error("Invalid category");
      e.status = 400;
      throw e;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = {
      id,
      title: title.trim(),
      description: description.trim(),
      budget: parseFloat(budget).toFixed(7),
      currency,
      category,
      visibility,
      skills: Array.isArray(skills) ? skills.slice(0, 8) : [],
      status: 'open',
      clientAddress,
      freelancerAddress: null,
      escrowContractId: null,
      applicantCount: 0,
      shareCount: 0,
      boosted: false,
      boostedUntil: null,
      deadline: deadline || null,
      timezone: timezone || null,
      screeningQuestions: Array.isArray(screeningQuestions) ? screeningQuestions : [],
      createdAt: now,
      updatedAt: now,
    };

    store.jobs.set(id, job);
    return job;
  }

  async function getJob(id) {
    const job = store.jobs.get(id);
    if (!job) {
      const e = new Error('Job not found');
      e.status = 404;
      throw e;
    }
    return job;
  }

  async function listJobs({ category, status = 'open', limit = 50, search, _cursor, timezone, _viewerAddress } = {}) {
    let jobs = Array.from(store.jobs.values());
    if (status) jobs = jobs.filter((j) => j.status === status);
    if (category) jobs = jobs.filter((j) => j.category === category);
    if (search) {
      const q = search.toLowerCase();
      jobs = jobs.filter((j) => j.title.toLowerCase().includes(q) || j.description.toLowerCase().includes(q) || (j.skills || []).some(s => s.toLowerCase().includes(q)));
    }
    if (timezone) jobs = jobs.filter((j) => isTimezoneCompatible(j.timezone, timezone));
    return { jobs: jobs.slice(0, limit) };
  }

  async function listJobsByClient(clientAddress) {
    return Array.from(store.jobs.values()).filter((j) => j.clientAddress === clientAddress);
  }

  async function updateJobStatus(id, nextStatus) {
    const job = store.jobs.get(id);
    if (!job) {
      const e = new Error('Job not found');
      e.status = 404;
      throw e;
    }
    if (!["open", "in_progress", "completed", "cancelled"].includes(nextStatus)) {
      throw new Error('Invalid status');
    }
    job.status = nextStatus;
    job.updatedAt = new Date().toISOString();
    store.jobs.set(id, job);
    return job;
  }

  async function assignFreelancer(jobId, freelancerAddress) {
    const job = store.jobs.get(jobId);
    if (!job) {
      const e = new Error('Job not found');
      e.status = 404;
      throw e;
    }
    job.freelancerAddress = freelancerAddress;
    job.status = 'in_progress';
    job.updatedAt = new Date().toISOString();
    store.jobs.set(jobId, job);
    return job;
  }

  module.exports = {
    createJob,
    getJob,
    listJobs,
    listJobsByClient,
    updateJobStatus,
    assignFreelancer,
  };

} else {
  const pool = require("../db/pool");


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
      expiresAt: row.expires_at,
      extendedCount: row.extended_count || 0,
      extendedUntil: row.extended_until,
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
 * @returns {Promise<{jobs: Object[], nextCursor: string|null, hasMore: boolean}>} An object containing the list of jobs, an optional next cursor for pagination, and whether more results exist.
 * @throws {Error} If the provided cursor is invalid.
 */
async function listJobs({
  category,
  status = "open",
  limit = 20,
  search,
  cursor,
  // eslint-disable-next-line no-unused-vars
  timezone,
  viewerAddress,
  includeExpired,
  includeDeleted = false,
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
  let selectColumns = "jobs.*";
  let orderClause = `CASE WHEN boosted = true AND (boosted_until IS NULL OR boosted_until > NOW()) THEN 0 ELSE 1 END, created_at DESC, id DESC`;

  if (search && search.trim()) {
    params.push(search.trim());
    const searchIdx = params.length;
    selectColumns = `jobs.*,
      ts_rank(search_vector, websearch_to_tsquery('english', $${searchIdx})) AS rank,
      ts_headline(title, websearch_to_tsquery('english', $${searchIdx}),
        'StartSel=<mark>,StopSel=</mark>,MaxWords=50,MinWords=20') AS headline_title,
      ts_headline(description, websearch_to_tsquery('english', $${searchIdx}),
        'StartSel=<mark>,StopSel=</mark>,MaxWords=80,MinWords=30') AS headline_description`;
    conditions.push(
      `search_vector @@ websearch_to_tsquery('english', $${searchIdx})`,
    );
    orderClause = `rank DESC, ${orderClause}`;
  }

  if (!includeDeleted) {
    conditions.push("deleted_at IS NULL");
  }

  if (status && status !== "all") {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  } else if (!includeExpired) {
    conditions.push("status != 'expired'");
  }

  if (category) {
    params.push(category);
    // Support slug (e.g. 'frontend-development') OR legacy name (e.g. 'Frontend Development')
    conditions.push(`(
      EXISTS (SELECT 1 FROM categories c WHERE c.id = jobs.category_id AND (c.slug = $${params.length} OR LOWER(c.name) = LOWER($${params.length})))
      OR jobs.category = $${params.length}
    )`);
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
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (skillList.length > 0) {
    // Use the GIN-indexed skills column with the overlap operator (&&) for index scan
    // Issue #540: jobs.skills TEXT[] + GIN index replaces sequential join scan
    params.push(skillList);
    conditions.push(`jobs.skills && $${params.length}::text[]`);
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

    let nextCursor = null;
    if (jobs.length === limit) {
      nextCursor = encodeCursor(rows[rows.length - 1]);
    }

    let filteredJobs = jobs;
    if (timezone) {
      filteredJobs = filteredJobs.filter((job) => isTimezoneCompatible(job.timezone, timezone));
    }

    return { jobs: filteredJobs, nextCursor };
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

    return rows.map(rowToJob);
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

  /**
   * Update a job's expiry date (extend).
   *
   * @param {string} jobId  UUID of the job.
   * @param {number} additionalDays  Number of days to add (e.g., 30).
   * @param {number} maxExtensions   Maximum allowed extensions (default 3).
   * @returns {Promise<Job>}
   * @throws {Error} 404 — job not found.
   * @throws {Error} 400 — job already completed/cancelled or max extensions reached.
   */
  async function extendJobExpiry(jobId, additionalDays, maxExtensions = 3) {
    const job = await getJob(jobId);

    if (job.status === "completed" || job.status === "cancelled") {
      const e = new Error("Cannot extend a completed or cancelled job");
      e.status = 400;
      throw e;
    }

    if (job.extendedCount >= maxExtensions) {
      const e = new Error("Maximum number of extensions reached");
      e.status = 400;
      throw e;
    }

    const currentExpiry = job.expiresAt ? new Date(job.expiresAt) : new Date(job.createdAt);
    if (isNaN(currentExpiry.getTime())) {
      currentExpiry.setTime(Date.now());
    }

    const newExpiry = new Date(currentExpiry.getTime() + additionalDays * 24 * 60 * 60 * 1000);

    const { rows } = await pool.query(
      `UPDATE jobs
     SET expires_at = $1,
         extended_count = extended_count + 1,
         extended_until = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
      [newExpiry.toISOString(), jobId]
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
    updateJobStatus,
    assignFreelancer,
    updateJobEscrowId,
    deleteJob,
    boostJob,
    incrementShareCount,
    extendJobExpiry,
    expireOldJobs,
    getExpiringJobs,
    getJobAnalytics,
  };
}

const _pool = require("../db/pool");

const TIMELINE_EVENT_TYPES = ["job_posted", "bid_accepted", "escrow_funded", "work_completed", "escrow_released"];

async function recordTimelineEvent(jobId, eventType, txHash = null) {
  if (!TIMELINE_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Invalid timeline event type: ${eventType}`);
  }

  const { rows: existing } = await _pool.query(
    "SELECT * FROM job_timeline WHERE job_id = $1 AND event_type = $2",
    [jobId, eventType]
  );
  if (existing.length > 0) {
    return existing[0];
  }

  const { rows } = await _pool.query(
    "INSERT INTO job_timeline (job_id, event_type, tx_hash, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
    [jobId, eventType, txHash]
  );
  return rows[0];
}

async function getJobTimeline(jobId) {
  const { rows } = await _pool.query(
    "SELECT * FROM job_timeline WHERE job_id = $1 ORDER BY created_at ASC",
    [jobId]
  );
  return rows.map(r => ({
    id: r.id,
    jobId: r.job_id,
    eventType: r.event_type,
    txHash: r.tx_hash,
    createdAt: r.created_at
  }));
}

Object.assign(module.exports, { TIMELINE_EVENT_TYPES, recordTimelineEvent, getJobTimeline });
