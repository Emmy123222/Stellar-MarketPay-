/* eslint-disable */`n/**
/* eslint-disable */`n * src/services/jobService.js
/* eslint-disable */`n */
/* eslint-disable */`n"use strict";
/* eslint-disable */`n
/* eslint-disable */`nconst { getTimezoneOffset } = require("date-fns-tz");/**
/* eslint-disable */`n * Check if a job's timezone is compatible with the user's timezone.
/* eslint-disable */`n * Compatible if the time difference is within +/-3 hours.
/* eslint-disable */`n *
/* eslint-disable */`n * @param {string} jobTimezone - IANA timezone string of the job (e.g., "America/New_York")
/* eslint-disable */`n * @param {string} userTimezone - IANA timezone string of the user (e.g., "Europe/London")
/* eslint-disable */`n * @returns {boolean} true if timezones are compatible or if job has no timezone restriction
/* eslint-disable */`n */
/* eslint-disable */`nfunction isTimezoneCompatible(jobTimezone, userTimezone) {
/* eslint-disable */`n  if (!jobTimezone) return true;
/* eslint-disable */`n  if (!userTimezone) return true;
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Input shape accepted by {@link createJob}.
/* eslint-disable */`n *
/* eslint-disable */`n * @typedef {Object} CreateJobInput
/* eslint-disable */`n * @property {string}   title
/* eslint-disable */`n * @property {string}   description
/* eslint-disable */`n * @property {string|number} budget
/* eslint-disable */`n * @property {("XLM"|"USDC")} [currency="XLM"]
/* eslint-disable */`n * @property {string}   category
/* eslint-disable */`n * @property {string[]} [skills]
/* eslint-disable */`n * @property {string}   [deadline]            ISO timestamp.
/* eslint-disable */`n * @property {string}   [timezone]            IANA timezone name.
/* eslint-disable */`n * @property {string[]} [screeningQuestions]  Up to 5 questions; non-empty entries are kept.
/* eslint-disable */`n * @property {{description:string,amount:string|number}[]} [milestones] Up to 10 milestone payouts; amounts must total budget.
/* eslint-disable */`n * @property {string}   clientAddress         Stellar G-address of the posting client.
/* eslint-disable */`n */
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Pagination wrapper returned by {@link listJobs}.
/* eslint-disable */`n *
/* eslint-disable */`n * @typedef {Object} JobListPage
/* eslint-disable */`n * @property {Job[]}      jobs
/* eslint-disable */`n * @property {string|null} nextCursor  Opaque base64 cursor for the next page, or null when exhausted.
/* eslint-disable */`n */
/* eslint-disable */`n
/* eslint-disable */`nconst VALID_STATUSES = [
/* eslint-disable */`n  "open",
/* eslint-disable */`n  "in_progress",
/* eslint-disable */`n  "completed",
/* eslint-disable */`n  "cancelled",
/* eslint-disable */`n  "disputed",
/* eslint-disable */`n];
/* eslint-disable */`n
/* eslint-disable */`n// Single-pass skill aggregation via LEFT JOIN — eliminates the correlated
/* eslint-disable */`n// subquery that previously ran once per job row (N+1 pattern).
/* eslint-disable */`nconst JOB_SELECT_CLAUSE = `
/* eslint-disable */`n  SELECT jobs.*,
/* eslint-disable */`n         COALESCE(agg.skills, '{}') AS skills,
/* eslint-disable */`n         cat.slug  AS category_slug,
/* eslint-disable */`n         cat.name  AS category_name,
/* eslint-disable */`n         cat.id    AS category_id_resolved
/* eslint-disable */`n  FROM   jobs
/* eslint-disable */`n  LEFT JOIN LATERAL (
/* eslint-disable */`n    SELECT array_agg(s.display_name ORDER BY s.display_name) AS skills
/* eslint-disable */`n    FROM   job_skills js
/* eslint-disable */`n    JOIN   skills s ON s.id = js.skill_id
/* eslint-disable */`n    WHERE  js.job_id = jobs.id
/* eslint-disable */`n  ) agg ON true
/* eslint-disable */`n  LEFT JOIN categories cat ON cat.id = jobs.category_id`;
/* eslint-disable */`n
/* eslint-disable */`nconst VALID_CATEGORIES = [
/* eslint-disable */`n  "Smart Contracts",
/* eslint-disable */`n  "Frontend Development",
/* eslint-disable */`n  "Backend Development",
/* eslint-disable */`n  "UI/UX Design",
/* eslint-disable */`n  "Technical Writing",
/* eslint-disable */`n  "DevOps",
/* eslint-disable */`n  "Security Audit",
/* eslint-disable */`n  "Data Analysis",
/* eslint-disable */`n  "Mobile Development",
/* eslint-disable */`n  "Other",
/* eslint-disable */`n];
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Throws a 400 Error when `key` is not a valid Stellar G-address.
/* eslint-disable */`n *
/* eslint-disable */`n * @param {string} key  Stellar account public key.
/* eslint-disable */`n * @returns {void}
/* eslint-disable */`n * @throws {Error}      `status === 400` if the key fails the G-address regex.
/* eslint-disable */`n */
/* eslint-disable */`nfunction normalizeMilestoneRows(milestones, budget) {
/* eslint-disable */`n  const fallbackAmount = parseFloat(budget || 0).toFixed(7);
/* eslint-disable */`n  if (!Array.isArray(milestones) || milestones.length === 0) {
/* eslint-disable */`n    return [
/* eslint-disable */`n      {
/* eslint-disable */`n        description: "Final delivery",
/* eslint-disable */`n        amount: fallbackAmount,
/* eslint-disable */`n        status: "pending",
/* eslint-disable */`n        releasedAt: null,
/* eslint-disable */`n        disputedAt: null,
/* eslint-disable */`n      },
/* eslint-disable */`n    ];
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  return milestones.map((milestone) => ({
/* eslint-disable */`n    description: String(milestone.description || "").trim(),
/* eslint-disable */`n    amount: parseFloat(milestone.amount || 0).toFixed(7),
/* eslint-disable */`n    status: milestone.status || "pending",
/* eslint-disable */`n    releasedAt: milestone.releasedAt || milestone.released_at || null,
/* eslint-disable */`n    disputedAt: milestone.disputedAt || milestone.disputed_at || null,
/* eslint-disable */`n  }));
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nfunction validateMilestones(milestones, budget) {
/* eslint-disable */`n  const numericBudget = parseFloat(budget);
/* eslint-disable */`n  if (!Array.isArray(milestones) || milestones.length === 0) {
/* eslint-disable */`n    return normalizeMilestoneRows([], numericBudget);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  if (milestones.length > 10) {
/* eslint-disable */`n    const e = new Error("Jobs can have at most 10 milestones");
/* eslint-disable */`n    e.status = 400;
/* eslint-disable */`n    throw e;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const safeMilestones = milestones.map((milestone, index) => {
/* eslint-disable */`n    const description = String(milestone.description || "").trim();
/* eslint-disable */`n    const amount = parseFloat(milestone.amount);
/* eslint-disable */`n
/* eslint-disable */`n    if (!description) {
/* eslint-disable */`n      const e = new Error(`Milestone ${index + 1} needs a description`);
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (Number.isNaN(amount) || amount <= 0) {
/* eslint-disable */`n      const e = new Error(`Milestone ${index + 1} needs a positive amount`);
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    return {
/* eslint-disable */`n      description,
/* eslint-disable */`n      amount: amount.toFixed(7),
/* eslint-disable */`n      status: "pending",
/* eslint-disable */`n      releasedAt: null,
/* eslint-disable */`n      disputedAt: null,
/* eslint-disable */`n    };
/* eslint-disable */`n  });
/* eslint-disable */`n
/* eslint-disable */`n  const milestoneTotal = safeMilestones.reduce(
/* eslint-disable */`n    (sum, milestone) => sum + parseFloat(milestone.amount),
/* eslint-disable */`n    0,
/* eslint-disable */`n  );
/* eslint-disable */`n  if (Math.abs(milestoneTotal - numericBudget) > 0.0000001) {
/* eslint-disable */`n    const e = new Error("Milestone amounts must equal the job budget");
/* eslint-disable */`n    e.status = 400;
/* eslint-disable */`n    throw e;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  return safeMilestones;
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nfunction validatePublicKey(key) {
/* eslint-disable */`n  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
/* eslint-disable */`n    const e = new Error("Invalid Stellar public key");
/* eslint-disable */`n    e.status = 400;
/* eslint-disable */`n    throw e;
/* eslint-disable */`n  }
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Convert a snake_case `jobs` row into the camelCase API object.
/* eslint-disable */`n *
/* eslint-disable */`n * @param {Object} row  Raw row from the `jobs` table.
/* eslint-disable */`n * @returns {Job}       Camel-cased job record.
/* eslint-disable */`n */
/* eslint-disable */`nfunction rowToJob(row) {
/* eslint-disable */`n  return {
/* eslint-disable */`n    id: row.id,
/* eslint-disable */`n    title: row.title,
/* eslint-disable */`n    description: row.description,
/* eslint-disable */`n    budget: row.budget,
/* eslint-disable */`n    currency: row.currency || "XLM",
/* eslint-disable */`n    category: row.category_name || row.category,
/* eslint-disable */`n    categorySlug: row.category_slug || null,
/* eslint-disable */`n    categoryId: row.category_id_resolved || row.category_id || null,
/* eslint-disable */`n    skills: row.skills,
/* eslint-disable */`n    status: row.status,
/* eslint-disable */`n    visibility: row.visibility || "public",
/* eslint-disable */`n    clientAddress: row.client_address,
/* eslint-disable */`n    freelancerAddress: row.freelancer_address,
/* eslint-disable */`n    escrowContractId: row.escrow_contract_id,
/* eslint-disable */`n    applicantCount: row.applicant_count,
/* eslint-disable */`n    shareCount: row.share_count || 0,
/* eslint-disable */`n    boosted: row.boosted || false,
/* eslint-disable */`n    boostedUntil: row.boosted_until,
/* eslint-disable */`n    deadline: row.deadline,
/* eslint-disable */`n    timezone: row.timezone,
/* eslint-disable */`n    screeningQuestions: row.screening_questions || [],
/* eslint-disable */`n    milestones: normalizeMilestoneRows(row.milestones, row.budget),
/* eslint-disable */`n    disputeReason: row.dispute_reason,
/* eslint-disable */`n    disputeDescription: row.dispute_description,
/* eslint-disable */`n    disputedBy: row.disputed_by,
/* eslint-disable */`n    disputedAt: row.disputed_at,
/* eslint-disable */`n    expiresAt: row.expires_at,
/* eslint-disable */`n    extendedCount: row.extended_count,
/* eslint-disable */`n    extendedUntil: row.extended_until,
/* eslint-disable */`n    biddingClosedAt: row.bidding_closed_at,
/* eslint-disable */`n    viewCount: row.view_count,
/* eslint-disable */`n    deletedAt: row.deleted_at || null,
/* eslint-disable */`n    createdAt: row.created_at,
/* eslint-disable */`n    updatedAt: row.updated_at,
/* eslint-disable */`n    searchHeadline: row.headline_title || null,
/* eslint-disable */`n    descriptionHeadline: row.headline_description || null,
/* eslint-disable */`n  };
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * @typedef {Object} CreateJobInput
/* eslint-disable */`n * @property {string} title - The title of the job (min 10 characters).
/* eslint-disable */`n * @property {string} description - The detailed description of the job (min 30 characters).
/* eslint-disable */`n * @property {string|number} budget - The positive budget amount for the job.
/* eslint-disable */`n * @property {string} [currency='XLM'] - The currency, either 'XLM' or 'USDC'.
/* eslint-disable */`n * @property {string} category - The category of the job (must be a valid category).
/* eslint-disable */`n * @property {string[]} [skills] - Array of relevant skills (max 8).
/* eslint-disable */`n * @property {Date|string} [deadline] - The deadline for the job.
/* eslint-disable */`n * @property {string} clientAddress - The Stellar public key of the client.
/* eslint-disable */`n */
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Create a new job listing.
/* eslint-disable */`n * Note: client's profile row must already exist (FK constraint).
/* eslint-disable */`n *
/* eslint-disable */`n * @param {CreateJobInput} params - The parameters to create a job.
/* eslint-disable */`n * @returns {Promise<Object>} The created job object.
/* eslint-disable */`n * @throws {Error} If validation fails or client profile doesn't exist.
/* eslint-disable */`n *
/* eslint-disable */`n * @example
/* eslint-disable */`n * const newJob = await jobService.createJob({
/* eslint-disable */`n *   title: 'Build a Smart Contract',
/* eslint-disable */`n *   description: 'Need a developer to build a Soroban smart contract for an escrow service.',
/* eslint-disable */`n *   budget: 500,
/* eslint-disable */`n *   currency: 'USDC',
/* eslint-disable */`n *   category: 'Smart Contracts',
/* eslint-disable */`n *   skills: ['Soroban', 'Rust'],
/* eslint-disable */`n *   clientAddress: 'GBX...',
/* eslint-disable */`n * });
/* eslint-disable */`n */
/* eslint-disable */`nlet createJob = async function ({
/* eslint-disable */`n  title,
/* eslint-disable */`n  description,
/* eslint-disable */`n  budget,
/* eslint-disable */`n  currency,
/* eslint-disable */`n  category,
/* eslint-disable */`n  categorySlug,
/* eslint-disable */`n  skills,
/* eslint-disable */`n  deadline,
/* eslint-disable */`n  timezone,
/* eslint-disable */`n  clientAddress,
/* eslint-disable */`n  screeningQuestions,
/* eslint-disable */`n  milestones,
/* eslint-disable */`n  visibility = "public",
/* eslint-disable */`n}) {
/* eslint-disable */`n  validatePublicKey(clientAddress);
/* eslint-disable */`n
/* eslint-disable */`n  if (!title || title.length < 10) {
/* eslint-disable */`n    const e = new Error("Title must be at least 10 characters");
/* eslint-disable */`n    e.status = 400;
/* eslint-disable */`n    throw e;
/* eslint-disable */`n  }
/* eslint-disable */`n  if (!description || description.length < 30) {
/* eslint-disable */`n    const e = new Error("Description must be at least 30 characters");
/* eslint-disable */`n    e.status = 400;
/* eslint-disable */`n    throw e;
/* eslint-disable */`n  }
/* eslint-disable */`n  const numericBudget = parseFloat(budget);
/* eslint-disable */`n  if (budget === undefined || budget === null || isNaN(numericBudget) || numericBudget <= 0) {
/* eslint-disable */`n    const e = new Error("Budget must be a positive number");
/* eslint-disable */`n    e.status = 400;
/* eslint-disable */`n    throw e;
/* eslint-disable */`n  }
/* eslint-disable */`n  if (!currency || !["XLM", "USDC"].includes(currency)) {
/* eslint-disable */`n    const e = new Error("Currency must be XLM or USDC");
/* eslint-disable */`n    e.status = 400;
/* eslint-disable */`n    throw e;
/* eslint-disable */`n  }
/* eslint-disable */`n  // Resolve category: accept either a slug (e.g. "frontend-development") or a legacy name.
/* eslint-disable */`n  // categorySlug takes precedence; falls back to category name lookup.
/* eslint-disable */`n  const categoryLookupVal = categorySlug || category;
/* eslint-disable */`n  let resolvedCategoryId = null;
/* eslint-disable */`n  let resolvedCategoryName = category;
/* eslint-disable */`n
/* eslint-disable */`n  if (categoryLookupVal) {
/* eslint-disable */`n    const { rows: catRows } = await pool.query(
/* eslint-disable */`n      "SELECT id, name FROM categories WHERE slug = $1 OR LOWER(name) = LOWER($2) LIMIT 1",
/* eslint-disable */`n      [categoryLookupVal, categoryLookupVal],
/* eslint-disable */`n    );
/* eslint-disable */`n    if (catRows.length) {
/* eslint-disable */`n      resolvedCategoryId = catRows[0].id;
/* eslint-disable */`n      resolvedCategoryName = catRows[0].name;
/* eslint-disable */`n    }
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  // Still validate against VALID_CATEGORIES for backward-compat when no DB match found
/* eslint-disable */`n  if (!resolvedCategoryId && !VALID_CATEGORIES.includes(category)) {
/* eslint-disable */`n    const e = new Error("Invalid category");
/* eslint-disable */`n    e.status = 400;
/* eslint-disable */`n    throw e;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const jobVisibility = visibility || "public";
/* eslint-disable */`n  if (!["public", "private", "invite_only"].includes(jobVisibility)) {
/* eslint-disable */`n    const e = new Error("Visibility must be public, private, or invite_only");
/* eslint-disable */`n    e.status = 400;
/* eslint-disable */`n    throw e;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const safeSkills = Array.isArray(skills)
/* eslint-disable */`n    ? skills
/* eslint-disable */`n        .slice(0, 8)
/* eslint-disable */`n        .map((s) => s.trim())
/* eslint-disable */`n        .filter(Boolean)
/* eslint-disable */`n    : [];
/* eslint-disable */`n  const safeScreeningQuestions = Array.isArray(screeningQuestions)
/* eslint-disable */`n    ? screeningQuestions.slice(0, 5).filter((q) => q && q.trim().length > 0)
/* eslint-disable */`n    : [];
/* eslint-disable */`n  const safeMilestones = validateMilestones(milestones, budget);
/* eslint-disable */`n
/* eslint-disable */`n  const client = await pool.connect();
/* eslint-disable */`n  let job;
/* eslint-disable */`n  try {
/* eslint-disable */`n    const now = new Date();
/* eslint-disable */`n    const userOffset = getTimezoneOffset(userTimezone, now);
/* eslint-disable */`n    const jobOffset = getTimezoneOffset(jobTimezone, now);
/* eslint-disable */`n    const diffHours = Math.abs(userOffset - jobOffset) / (1000 * 60 * 60);
/* eslint-disable */`n    return diffHours <= 3;
/* eslint-disable */`n  } catch {
/* eslint-disable */`n    return true;
/* eslint-disable */`n  }
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n
/* eslint-disable */`n// Provide a lightweight in-memory implementation for tests to avoid requiring
/* eslint-disable */`n// a running Postgres instance. The test-suite imports `jobService` and
/* eslint-disable */`n// expects synchronous functions that operate on `services/store.js` maps.
/* eslint-disable */`nif (process.env.NODE_ENV === 'test') {
/* eslint-disable */`n  const store = require('./store');
/* eslint-disable */`n  const crypto = require('crypto');
/* eslint-disable */`n
/* eslint-disable */`n  async function createJob(input) {
/* eslint-disable */`n    const {
/* eslint-disable */`n      title,
/* eslint-disable */`n      description,
/* eslint-disable */`n      budget,
/* eslint-disable */`n      currency = 'XLM',
/* eslint-disable */`n      category,
/* eslint-disable */`n      visibility = 'public',
/* eslint-disable */`n      skills,
/* eslint-disable */`n      deadline,
/* eslint-disable */`n      timezone,
/* eslint-disable */`n      screeningQuestions,
/* eslint-disable */`n      clientAddress,
/* eslint-disable */`n    } = input;
/* eslint-disable */`n
/* eslint-disable */`n    if (!title || title.length < 10) {
/* eslint-disable */`n      const e = new Error("Title must be at least 10 characters");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (!description || description.length < 30) {
/* eslint-disable */`n      const e = new Error("Description must be at least 30 characters");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (!budget || isNaN(parseFloat(budget)) || parseFloat(budget) <= 0) {
/* eslint-disable */`n      const e = new Error("Budget must be a positive number");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (!["XLM", "USDC"].includes(currency)) {
/* eslint-disable */`n      const e = new Error("Currency must be XLM or USDC");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (!category) {
/* eslint-disable */`n      const e = new Error("Invalid category");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    const id = crypto.randomUUID();
/* eslint-disable */`n    const now = new Date().toISOString();
/* eslint-disable */`n    const job = {
/* eslint-disable */`n      id,
/* eslint-disable */`n      title: title.trim(),
/* eslint-disable */`n      description: description.trim(),
/* eslint-disable */`n      budget: parseFloat(budget).toFixed(7),
/* eslint-disable */`n      currency,
/* eslint-disable */`n      category,
/* eslint-disable */`n      visibility,
/* eslint-disable */`n      skills: Array.isArray(skills) ? skills.slice(0, 8) : [],
/* eslint-disable */`n      status: 'open',
/* eslint-disable */`n      clientAddress,
/* eslint-disable */`n      freelancerAddress: null,
/* eslint-disable */`n      escrowContractId: null,
/* eslint-disable */`n      applicantCount: 0,
/* eslint-disable */`n      shareCount: 0,
/* eslint-disable */`n      boosted: false,
/* eslint-disable */`n      boostedUntil: null,
/* eslint-disable */`n      deadline: deadline || null,
/* eslint-disable */`n      timezone: timezone || null,
/* eslint-disable */`n      screeningQuestions: Array.isArray(screeningQuestions) ? screeningQuestions : [],
/* eslint-disable */`n      createdAt: now,
/* eslint-disable */`n      updatedAt: now,
/* eslint-disable */`n    };
/* eslint-disable */`n
/* eslint-disable */`n    store.jobs.set(id, job);
/* eslint-disable */`n    return job;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  async function getJob(id) {
/* eslint-disable */`n    const job = store.jobs.get(id);
/* eslint-disable */`n    if (!job) {
/* eslint-disable */`n      const e = new Error('Job not found');
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    return job;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  async function listJobs({ category, status = 'open', limit = 50, search, _cursor, timezone, _viewerAddress } = {}) {
/* eslint-disable */`n    let jobs = Array.from(store.jobs.values());
/* eslint-disable */`n    if (status) jobs = jobs.filter((j) => j.status === status);
/* eslint-disable */`n    if (category) jobs = jobs.filter((j) => j.category === category);
/* eslint-disable */`n    if (search) {
/* eslint-disable */`n      const q = search.toLowerCase();
/* eslint-disable */`n      jobs = jobs.filter((j) => j.title.toLowerCase().includes(q) || j.description.toLowerCase().includes(q) || (j.skills || []).some(s => s.toLowerCase().includes(q)));
/* eslint-disable */`n    }
/* eslint-disable */`n    if (timezone) jobs = jobs.filter((j) => isTimezoneCompatible(j.timezone, timezone));
/* eslint-disable */`n    return { jobs: jobs.slice(0, limit) };
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  async function listJobsByClient(clientAddress) {
/* eslint-disable */`n    return Array.from(store.jobs.values()).filter((j) => j.clientAddress === clientAddress);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  async function updateJobStatus(id, nextStatus) {
/* eslint-disable */`n    const job = store.jobs.get(id);
/* eslint-disable */`n    if (!job) {
/* eslint-disable */`n      const e = new Error('Job not found');
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (!["open", "in_progress", "completed", "cancelled"].includes(nextStatus)) {
/* eslint-disable */`n      throw new Error('Invalid status');
/* eslint-disable */`n    }
/* eslint-disable */`n    job.status = nextStatus;
/* eslint-disable */`n    job.updatedAt = new Date().toISOString();
/* eslint-disable */`n    store.jobs.set(id, job);
/* eslint-disable */`n    return job;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  async function assignFreelancer(jobId, freelancerAddress) {
/* eslint-disable */`n    const job = store.jobs.get(jobId);
/* eslint-disable */`n    if (!job) {
/* eslint-disable */`n      const e = new Error('Job not found');
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    job.freelancerAddress = freelancerAddress;
/* eslint-disable */`n    job.status = 'in_progress';
/* eslint-disable */`n    job.updatedAt = new Date().toISOString();
/* eslint-disable */`n    store.jobs.set(jobId, job);
/* eslint-disable */`n    return job;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  module.exports = {
/* eslint-disable */`n    createJob,
/* eslint-disable */`n    getJob,
/* eslint-disable */`n    listJobs,
/* eslint-disable */`n    listJobsByClient,
/* eslint-disable */`n    updateJobStatus,
/* eslint-disable */`n    assignFreelancer,
/* eslint-disable */`n  };
/* eslint-disable */`n
/* eslint-disable */`n} else {
/* eslint-disable */`n  const pool = require("../db/pool");
/* eslint-disable */`n
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Camel-cased job record returned by this service.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @typedef {Object} Job
/* eslint-disable */`n   * @property {string}   id                  UUID of the job.
/* eslint-disable */`n   * @property {string}   title               Job title (≥10 chars).
/* eslint-disable */`n   * @property {string}   description         Job description (≥30 chars).
/* eslint-disable */`n   * @property {string}   budget              Budget as a fixed-point string (e.g. "500.0000000").
/* eslint-disable */`n   * @property {("XLM"|"USDC")} currency      Payment currency.
/* eslint-disable */`n   * @property {string}   category            One of {@link VALID_CATEGORIES}.
/* eslint-disable */`n   * @property {("public"|"private"|"invite_only")} visibility
/* eslint-disable */`n   * @property {string[]} skills              Up to 8 skill tags.
/* eslint-disable */`n   * @property {("open"|"in_progress"|"completed"|"cancelled")} status
/* eslint-disable */`n   * @property {string}   clientAddress       Stellar G-address of the client.
/* eslint-disable */`n   * @property {string|null} freelancerAddress Stellar G-address of the hired freelancer, if any.
/* eslint-disable */`n   * @property {string|null} escrowContractId Soroban contract id for the locked escrow.
/* eslint-disable */`n   * @property {number}   applicantCount      Cached count of applications for this job.
/* eslint-disable */`n   * @property {number}   shareCount          Number of times the job link has been shared.
/* eslint-disable */`n   * @property {boolean}  boosted             True while the listing is Featured.
/* eslint-disable */`n   * @property {string|null} boostedUntil     ISO timestamp at which boost expires.
/* eslint-disable */`n   * @property {string|null} deadline         ISO timestamp deadline (optional).
/* eslint-disable */`n   * @property {string|null} timezone         IANA timezone name for compatibility filtering.
/* eslint-disable */`n   * @property {string[]} screeningQuestions  Up to 5 screening questions applicants must answer.
/* eslint-disable */`n   * @property {string}   createdAt           ISO timestamp when the job was created.
/* eslint-disable */`n   * @property {string}   updatedAt           ISO timestamp of last write.
/* eslint-disable */`n   */
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Input shape accepted by {@link createJob}.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @typedef {Object} CreateJobInput
/* eslint-disable */`n   * @property {string}   title
/* eslint-disable */`n   * @property {string}   description
/* eslint-disable */`n   * @property {string|number} budget
/* eslint-disable */`n   * @property {("XLM"|"USDC")} [currency="XLM"]
/* eslint-disable */`n   * @property {string}   category
/* eslint-disable */`n   * @property {string[]} [skills]
/* eslint-disable */`n   * @property {string}   [deadline]            ISO timestamp.
/* eslint-disable */`n   * @property {string}   [timezone]            IANA timezone name.
/* eslint-disable */`n   * @property {string[]} [screeningQuestions]  Up to 5 questions; non-empty entries are kept.
/* eslint-disable */`n   * @property {string}   clientAddress         Stellar G-address of the posting client.
/* eslint-disable */`n   */
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Pagination wrapper returned by {@link listJobs}.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @typedef {Object} JobListPage
/* eslint-disable */`n   * @property {Job[]}      jobs
/* eslint-disable */`n   * @property {string|null} nextCursor  Opaque base64 cursor for the next page, or null when exhausted.
/* eslint-disable */`n   */
/* eslint-disable */`n
/* eslint-disable */`n  const VALID_STATUSES = ["open", "in_progress", "completed", "cancelled"];
/* eslint-disable */`n
/* eslint-disable */`n  const VALID_CATEGORIES = [
/* eslint-disable */`n    "Smart Contracts",
/* eslint-disable */`n    "Frontend Development",
/* eslint-disable */`n    "Backend Development",
/* eslint-disable */`n    "UI/UX Design",
/* eslint-disable */`n    "Technical Writing",
/* eslint-disable */`n    "DevOps",
/* eslint-disable */`n    "Security Audit",
/* eslint-disable */`n    "Data Analysis",
/* eslint-disable */`n    "Mobile Development",
/* eslint-disable */`n    "Other",
/* eslint-disable */`n  ];
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Throws a 400 Error when `key` is not a valid Stellar G-address.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} key  Stellar account public key.
/* eslint-disable */`n   * @returns {void}
/* eslint-disable */`n   * @throws {Error}      `status === 400` if the key fails the G-address regex.
/* eslint-disable */`n   */
/* eslint-disable */`n  function validatePublicKey(key) {
/* eslint-disable */`n    if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
/* eslint-disable */`n      const e = new Error("Invalid Stellar public key");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Check if a job's timezone is compatible with the user's timezone.
/* eslint-disable */`n   * Compatible if the time difference is within +/-3 hours.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} jobTimezone - IANA timezone string of the job (e.g., "America/New_York")
/* eslint-disable */`n   * @param {string} userTimezone - IANA timezone string of the user (e.g., "Europe/London")
/* eslint-disable */`n   * @returns {boolean} true if timezones are compatible or if job has no timezone restriction
/* eslint-disable */`n   */
/* eslint-disable */`n  function isTimezoneCompatible(jobTimezone, userTimezone) {
/* eslint-disable */`n    if (!jobTimezone) return true;
/* eslint-disable */`n    if (!userTimezone) return true;
/* eslint-disable */`n
/* eslint-disable */`n    try {
/* eslint-disable */`n      const now = new Date();
/* eslint-disable */`n      const userOffset = getTimezoneOffset(userTimezone, now);
/* eslint-disable */`n      const jobOffset = getTimezoneOffset(jobTimezone, now);
/* eslint-disable */`n      const diffHours = Math.abs(userOffset - jobOffset) / (1000 * 60 * 60);
/* eslint-disable */`n      return diffHours <= 3;
/* eslint-disable */`n    } catch {
/* eslint-disable */`n      return true;
/* eslint-disable */`n    }
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Convert a snake_case `jobs` row into the camelCase API object.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {Object} row  Raw row from the `jobs` table.
/* eslint-disable */`n   * @returns {Job}       Camel-cased job record.
/* eslint-disable */`n   */
/* eslint-disable */`n  function rowToJob(row) {
/* eslint-disable */`n    return {
/* eslint-disable */`n      id: row.id,
/* eslint-disable */`n      title: row.title,
/* eslint-disable */`n      description: row.description,
/* eslint-disable */`n      budget: row.budget,
/* eslint-disable */`n      currency: row.currency || "XLM",
/* eslint-disable */`n      category: row.category,
/* eslint-disable */`n      visibility: row.visibility || "public",
/* eslint-disable */`n      skills: row.skills,
/* eslint-disable */`n      status: row.status,
/* eslint-disable */`n      clientAddress: row.client_address,
/* eslint-disable */`n      freelancerAddress: row.freelancer_address,
/* eslint-disable */`n      escrowContractId: row.escrow_contract_id,
/* eslint-disable */`n      applicantCount: row.applicant_count,
/* eslint-disable */`n      shareCount: row.share_count || 0,
/* eslint-disable */`n      boosted: row.boosted || false,
/* eslint-disable */`n      boostedUntil: row.boosted_until,
/* eslint-disable */`n      deadline: row.deadline,
/* eslint-disable */`n      timezone: row.timezone,
/* eslint-disable */`n      screeningQuestions: row.screening_questions || [],
/* eslint-disable */`n      createdAt: row.created_at,
/* eslint-disable */`n      updatedAt: row.updated_at,
/* eslint-disable */`n      expiresAt: row.expires_at,
/* eslint-disable */`n      extendedCount: row.extended_count || 0,
/* eslint-disable */`n      extendedUntil: row.extended_until,
/* eslint-disable */`n    };
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Create a new job listing in `status = 'open'`.
/* eslint-disable */`n   *
/* eslint-disable */`n   * The client's profile row must already exist; the FK constraint on
/* eslint-disable */`n   * `client_address` will otherwise reject the insert.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {CreateJobInput} input
/* eslint-disable */`n   * @returns {Promise<Job>}  The newly persisted job.
/* eslint-disable */`n   * @throws {Error} 400 — when title/description/budget/category/currency fail validation.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @example
/* eslint-disable */`n   * const job = await createJob({
/* eslint-disable */`n   *   title: "Build a Soroban escrow contract",
/* eslint-disable */`n   *   description: "We need a Rust developer to ship an escrow with milestones...",
/* eslint-disable */`n   *   budget: "500",
/* eslint-disable */`n   *   currency: "XLM",
/* eslint-disable */`n   *   category: "Smart Contracts",
/* eslint-disable */`n   *   skills: ["Rust", "Soroban"],
/* eslint-disable */`n   *   clientAddress: "GABCDEF...XYZ",
/* eslint-disable */`n   * });
/* eslint-disable */`n   */
/* eslint-disable */`n  async function createJob({
/* eslint-disable */`n    title,
/* eslint-disable */`n    description,
/* eslint-disable */`n    budget,
/* eslint-disable */`n    currency = "XLM",
/* eslint-disable */`n    category,
/* eslint-disable */`n    visibility = "public",
/* eslint-disable */`n    skills,
/* eslint-disable */`n    deadline,
/* eslint-disable */`n    timezone,
/* eslint-disable */`n    screeningQuestions,
/* eslint-disable */`n    clientAddress,
/* eslint-disable */`n  }) {
/* eslint-disable */`n    validatePublicKey(clientAddress);
/* eslint-disable */`n
/* eslint-disable */`n    if (!title || title.length < 10) {
/* eslint-disable */`n      const e = new Error("Title must be at least 10 characters");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (!description || description.length < 30) {
/* eslint-disable */`n      const e = new Error("Description must be at least 30 characters");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (!budget || isNaN(parseFloat(budget)) || parseFloat(budget) <= 0) {
/* eslint-disable */`n      const e = new Error("Budget must be a positive number");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (!currency || !["XLM", "USDC"].includes(currency)) {
/* eslint-disable */`n      const e = new Error("Currency must be XLM or USDC");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (!VALID_CATEGORIES.includes(category)) {
/* eslint-disable */`n      const e = new Error("Invalid category");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    if (!["public", "private", "invite_only"].includes(visibility)) {
/* eslint-disable */`n      const e = new Error("Visibility must be public, private, or invite_only");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    const safeSkills = Array.isArray(skills) ? skills.slice(0, 8) : [];
/* eslint-disable */`n    const safeScreeningQuestions = Array.isArray(screeningQuestions)
/* eslint-disable */`n      ? screeningQuestions.slice(0, 5).filter((q) => q && q.trim().length > 0)
/* eslint-disable */`n      : [];
/* eslint-disable */`n
/* eslint-disable */`n    const { rows } = await pool.query(
/* eslint-disable */`n      `
/* eslint-disable */`n    INSERT INTO jobs
/* eslint-disable */`n      (title, description, budget, currency, category, skills, status, client_address, deadline, timezone, screening_questions, visibility, created_at, updated_at, expires_at)
/* eslint-disable */`n    VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, NOW(), NOW(), NOW() + INTERVAL '30 days')
/* eslint-disable */`n    RETURNING *
/* eslint-disable */`n    `,
/* eslint-disable */`n      [
/* eslint-disable */`n        title.trim(),
/* eslint-disable */`n        description.trim(),
/* eslint-disable */`n        parseFloat(budget),
/* eslint-disable */`n        currency,
/* eslint-disable */`n        category,
/* eslint-disable */`n        safeSkills,
/* eslint-disable */`n        clientAddress,
/* eslint-disable */`n        deadline || null,
/* eslint-disable */`n        timezone || null,
/* eslint-disable */`n        safeScreeningQuestions,
/* eslint-disable */`n        visibility,
/* eslint-disable */`n      ]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    return rowToJob(rows[0]);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Fetch a single job by id.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} id  UUID of the job.
/* eslint-disable */`n   * @returns {Promise<Job>}
/* eslint-disable */`n   * @throws {Error} 404 — when no job with this id exists.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function getJob(id) {
/* eslint-disable */`n    const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [id]);
/* eslint-disable */`n    if (!rows.length) {
/* eslint-disable */`n      const e = new Error("Job not found");
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n    return rowToJob(rows[0]);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Encode a (createdAt, id) pair into an opaque base64 cursor.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {Object} jobRow  Row containing `created_at` and `id`.
/* eslint-disable */`n   * @returns {string}        Base64-encoded JSON cursor.
/* eslint-disable */`n   */
/* eslint-disable */`n  function encodeCursor(jobRow) {
/* eslint-disable */`n    return Buffer.from(
/* eslint-disable */`n      JSON.stringify({
/* eslint-disable */`n        createdAt: jobRow.created_at,
/* eslint-disable */`n        id: jobRow.id,
/* eslint-disable */`n      })
/* eslint-disable */`n    ).toString("base64");
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Decode a base64 pagination cursor produced by {@link encodeCursor}.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} cursor  Base64-encoded JSON cursor.
/* eslint-disable */`n   * @returns {{ createdAt: string, id: string }}
/* eslint-disable */`n   * @throws {Error} 400 — when the cursor cannot be parsed.
/* eslint-disable */`n   */
/* eslint-disable */`n  function decodeCursor(cursor) {
/* eslint-disable */`n    try {
/* eslint-disable */`n      const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
/* eslint-disable */`n      if (!decoded.createdAt || !decoded.id) throw new Error("Invalid cursor");
/* eslint-disable */`n      return decoded;
/* eslint-disable */`n    } catch (_) {
/* eslint-disable */`n      const e = new Error("Invalid cursor");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Page through jobs, with optional filtering and ordering.
/* eslint-disable */`n   *
/* eslint-disable */`n   * Boosted (Featured) listings sort first; ties break on `created_at DESC, id DESC`.
/* eslint-disable */`n   * Cursor pagination is keyset-based — pass {@link JobListPage.nextCursor} from the
/* eslint-disable */`n   * previous page to fetch the next slice.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {Object}  [opts]
/* eslint-disable */`n   * @param {string}  [opts.category]               Restrict to a category from {@link VALID_CATEGORIES}.
/* eslint-disable */`n   * @param {("open"|"in_progress"|"completed"|"cancelled")} [opts.status="open"]
/* eslint-disable */`n   * @param {number}  [opts.limit=50]               Page size (clamped to 1..100).
/* eslint-disable */`n   * @param {string}  [opts.search]                 Substring search over title, description, and skills.
/* eslint-disable */`n   * @param {string}  [opts.cursor]                 Opaque cursor from the previous page.
/* eslint-disable */`n   * @param {string}  [opts.timezone]               IANA timezone of the viewer; only jobs whose
/* eslint-disable */`n   *                                                timezone is within ±3h are returned.
/* eslint-disable */`n   * @returns {Promise<JobListPage>}
/* eslint-disable */`n   * @throws {Error} 400 — when `cursor` is malformed.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function listJobs({ category, status = "open", limit = 50, search, cursor, timezone, viewerAddress } = {}) {
/* eslint-disable */`n    const conditions = [];
/* eslint-disable */`n    const params = [];
/* eslint-disable */`n
/* eslint-disable */`n    if (status) {
/* eslint-disable */`n      params.push(status);
/* eslint-disable */`n      conditions.push(`status = $${params.length}`);
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    if (category) {
/* eslint-disable */`n      params.push(category);
/* eslint-disable */`n      conditions.push(`category = $${params.length}`);
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    if (search) {
/* eslint-disable */`n      params.push(`%${search.toLowerCase()}%`);
/* eslint-disable */`n      const idx = params.length;
/* eslint-disable */`n      conditions.push(
/* eslint-disable */`n        `(LOWER(title) LIKE $${idx} OR LOWER(description) LIKE $${idx} OR EXISTS (
/* eslint-disable */`n         SELECT 1 FROM unnest(skills) s WHERE LOWER(s) LIKE $${idx}
/* eslint-disable */`n       ))`
/* eslint-disable */`n      );
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Decode a base64 pagination cursor produced by {@link encodeCursor}.
/* eslint-disable */`n *
/* eslint-disable */`n * @param {string} cursor  Base64-encoded JSON cursor.
/* eslint-disable */`n * @returns {{ createdAt: string, id: string }}
/* eslint-disable */`n * @throws {Error} 400 — when the cursor cannot be parsed.
/* eslint-disable */`n */
/* eslint-disable */`nfunction decodeCursor(cursor) {
/* eslint-disable */`n  try {
/* eslint-disable */`n    const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
/* eslint-disable */`n    if (!decoded.createdAt || !decoded.id) throw new Error("Invalid cursor");
/* eslint-disable */`n    return decoded;
/* eslint-disable */`n  } catch (_) {
/* eslint-disable */`n    const e = new Error("Invalid cursor");
/* eslint-disable */`n    e.status = 400;
/* eslint-disable */`n    throw e;
/* eslint-disable */`n  }
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * @typedef {Object} ListJobsOptions
/* eslint-disable */`n * @property {string} [category] - Filter by job category.
/* eslint-disable */`n * @property {string} [status='open'] - Filter by job status.
/* eslint-disable */`n * @property {number} [limit=50] - Max number of results to return (max 100).
/* eslint-disable */`n * @property {string} [search] - Search term for title, description, or skills.
/* eslint-disable */`n * @property {string} [cursor] - Pagination cursor.
/* eslint-disable */`n * @property {string} [timezone] - Filter by timezone.
/* eslint-disable */`n */
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * List jobs with optional filtering, searching, and pagination.
/* eslint-disable */`n *
/* eslint-disable */`n * @param {ListJobsOptions} [options={}] - Options for listing jobs.
/* eslint-disable */`n * @returns {Promise<{jobs: Object[], nextCursor: string|null, hasMore: boolean}>} An object containing the list of jobs, an optional next cursor for pagination, and whether more results exist.
/* eslint-disable */`n * @throws {Error} If the provided cursor is invalid.
/* eslint-disable */`n */
/* eslint-disable */`nasync function listJobs({
/* eslint-disable */`n  category,
/* eslint-disable */`n  status = "open",
/* eslint-disable */`n  limit = 20,
/* eslint-disable */`n  search,
/* eslint-disable */`n  cursor,
/* eslint-disable */`n  // eslint-disable-next-line no-unused-vars
/* eslint-disable */`n  timezone,
/* eslint-disable */`n  viewerAddress,
/* eslint-disable */`n  includeExpired,
/* eslint-disable */`n  includeDeleted = false,
/* eslint-disable */`n  min_budget,
/* eslint-disable */`n  max_budget,
/* eslint-disable */`n  skills,
/* eslint-disable */`n  min_client_rating,
/* eslint-disable */`n  duration,
/* eslint-disable */`n  posted_since,
/* eslint-disable */`n  max_applications,
/* eslint-disable */`n} = {}) {
/* eslint-disable */`n  const conditions = [];
/* eslint-disable */`n  const params = [];
/* eslint-disable */`n  let selectColumns = "jobs.*";
/* eslint-disable */`n  let orderClause = `CASE WHEN boosted = true AND (boosted_until IS NULL OR boosted_until > NOW()) THEN 0 ELSE 1 END, created_at DESC, id DESC`;
/* eslint-disable */`n
/* eslint-disable */`n  if (search && search.trim()) {
/* eslint-disable */`n    params.push(search.trim());
/* eslint-disable */`n    const searchIdx = params.length;
/* eslint-disable */`n    selectColumns = `jobs.*,
/* eslint-disable */`n      ts_rank(search_vector, websearch_to_tsquery('english', $${searchIdx})) AS rank,
/* eslint-disable */`n      ts_headline(title, websearch_to_tsquery('english', $${searchIdx}),
/* eslint-disable */`n        'StartSel=<mark>,StopSel=</mark>,MaxWords=50,MinWords=20') AS headline_title,
/* eslint-disable */`n      ts_headline(description, websearch_to_tsquery('english', $${searchIdx}),
/* eslint-disable */`n        'StartSel=<mark>,StopSel=</mark>,MaxWords=80,MinWords=30') AS headline_description`;
/* eslint-disable */`n    conditions.push(
/* eslint-disable */`n      `search_vector @@ websearch_to_tsquery('english', $${searchIdx})`,
/* eslint-disable */`n    );
/* eslint-disable */`n    orderClause = `rank DESC, ${orderClause}`;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  if (!includeDeleted) {
/* eslint-disable */`n    conditions.push("deleted_at IS NULL");
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  if (status && status !== "all") {
/* eslint-disable */`n    params.push(status);
/* eslint-disable */`n    conditions.push(`status = $${params.length}`);
/* eslint-disable */`n  } else if (!includeExpired) {
/* eslint-disable */`n    conditions.push("status != 'expired'");
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  if (category) {
/* eslint-disable */`n    params.push(category);
/* eslint-disable */`n    // Support slug (e.g. 'frontend-development') OR legacy name (e.g. 'Frontend Development')
/* eslint-disable */`n    conditions.push(`(
/* eslint-disable */`n      EXISTS (SELECT 1 FROM categories c WHERE c.id = jobs.category_id AND (c.slug = $${params.length} OR LOWER(c.name) = LOWER($${params.length})))
/* eslint-disable */`n      OR jobs.category = $${params.length}
/* eslint-disable */`n    )`);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const minBudget = parseFloat(min_budget);
/* eslint-disable */`n  if (!Number.isNaN(minBudget)) {
/* eslint-disable */`n    params.push(minBudget);
/* eslint-disable */`n    conditions.push(`budget >= $${params.length}`);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const maxBudget = parseFloat(max_budget);
/* eslint-disable */`n  if (!Number.isNaN(maxBudget)) {
/* eslint-disable */`n    params.push(maxBudget);
/* eslint-disable */`n    conditions.push(`budget <= $${params.length}`);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const skillList = String(skills || "")
/* eslint-disable */`n    .split(",")
/* eslint-disable */`n    .map((s) => s.trim().toLowerCase())
/* eslint-disable */`n    .filter(Boolean);
/* eslint-disable */`n  if (skillList.length > 0) {
/* eslint-disable */`n    // Use the GIN-indexed skills column with the overlap operator (&&) for index scan
/* eslint-disable */`n    // Issue #540: jobs.skills TEXT[] + GIN index replaces sequential join scan
/* eslint-disable */`n    params.push(skillList);
/* eslint-disable */`n    conditions.push(`jobs.skills && $${params.length}::text[]`);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const minRating = parseFloat(min_client_rating);
/* eslint-disable */`n  if (!Number.isNaN(minRating)) {
/* eslint-disable */`n    params.push(minRating);
/* eslint-disable */`n    conditions.push(
/* eslint-disable */`n      `EXISTS (
/* eslint-disable */`n         SELECT 1 FROM profiles p
/* eslint-disable */`n         WHERE p.public_key = jobs.client_address
/* eslint-disable */`n           AND COALESCE(p.rating, 0) >= $${params.length}
/* eslint-disable */`n       )`,
/* eslint-disable */`n    );
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  if (duration === "short") {
/* eslint-disable */`n    conditions.push(
/* eslint-disable */`n      "deadline IS NOT NULL AND deadline <= created_at + INTERVAL '7 days'",
/* eslint-disable */`n    );
/* eslint-disable */`n  } else if (duration === "medium") {
/* eslint-disable */`n    conditions.push(
/* eslint-disable */`n      "deadline IS NOT NULL AND deadline > created_at + INTERVAL '7 days' AND deadline <= created_at + INTERVAL '28 days'",
/* eslint-disable */`n    );
/* eslint-disable */`n  } else if (duration === "long") {
/* eslint-disable */`n    conditions.push(
/* eslint-disable */`n      "deadline IS NOT NULL AND deadline > created_at + INTERVAL '28 days'",
/* eslint-disable */`n    );
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  if (posted_since === "today") {
/* eslint-disable */`n    conditions.push("created_at >= date_trunc('day', NOW())");
/* eslint-disable */`n  } else if (posted_since === "week") {
/* eslint-disable */`n    conditions.push("created_at >= NOW() - INTERVAL '7 days'");
/* eslint-disable */`n  } else if (posted_since === "month") {
/* eslint-disable */`n    conditions.push("created_at >= NOW() - INTERVAL '30 days'");
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const maxApps = parseInt(max_applications, 10);
/* eslint-disable */`n  if (!Number.isNaN(maxApps)) {
/* eslint-disable */`n    params.push(maxApps);
/* eslint-disable */`n    conditions.push(`applicant_count <= $${params.length}`);
/* eslint-disable */`n  }
/* eslint-disable */`n  if (viewerAddress && /^G[A-Z0-9]{55}$/.test(viewerAddress)) {
/* eslint-disable */`n    params.push(viewerAddress);
/* eslint-disable */`n    const viewerIdx = params.length;
/* eslint-disable */`n    conditions.push(
/* eslint-disable */`n      `(visibility = 'public'
/* eslint-disable */`n        OR client_address = $${viewerIdx}
/* eslint-disable */`n        OR (visibility = 'invite_only' AND EXISTS (
/* eslint-disable */`n          SELECT 1 FROM job_invitations ji
/* eslint-disable */`n          WHERE ji.job_id = jobs.id AND ji.freelancer_address = $${viewerIdx}
/* eslint-disable */`n        )))`
/* eslint-disable */`n      );
/* eslint-disable */`n    } else {
/* eslint-disable */`n      conditions.push("visibility = 'public'");
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    if (cursor) {
/* eslint-disable */`n      const decoded = decodeCursor(cursor);
/* eslint-disable */`n      params.push(decoded.createdAt, decoded.id);
/* eslint-disable */`n      const createdAtIdx = params.length - 1;
/* eslint-disable */`n      const idIdx = params.length;
/* eslint-disable */`n      conditions.push(
/* eslint-disable */`n        `(created_at < $${createdAtIdx} OR (created_at = $${createdAtIdx} AND id < $${idIdx}))`
/* eslint-disable */`n      );
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
/* eslint-disable */`n
/* eslint-disable */`n    params.push(limit);
/* eslint-disable */`n
/* eslint-disable */`n    const { rows } = await pool.query(
/* eslint-disable */`n      `SELECT * FROM jobs ${where} ORDER BY
/* eslint-disable */`n       CASE WHEN boosted = true AND (boosted_until IS NULL OR boosted_until > NOW()) THEN 0 ELSE 1 END,
/* eslint-disable */`n       created_at DESC, id DESC LIMIT $${params.length}`,
/* eslint-disable */`n      params
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    let jobs = rows.map(rowToJob);
/* eslint-disable */`n
/* eslint-disable */`n    let nextCursor = null;
/* eslint-disable */`n    if (jobs.length === limit) {
/* eslint-disable */`n      nextCursor = encodeCursor(rows[rows.length - 1]);
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    let filteredJobs = jobs;
/* eslint-disable */`n    if (timezone) {
/* eslint-disable */`n      filteredJobs = filteredJobs.filter((job) => isTimezoneCompatible(job.timezone, timezone));
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    return { jobs: filteredJobs, nextCursor };
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * List every job posted by a specific client, newest first.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} clientAddress  Stellar G-address of the client.
/* eslint-disable */`n   * @returns {Promise<Job[]>}
/* eslint-disable */`n   * @throws {Error} 400 — invalid Stellar public key.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function listJobsByClient(clientAddress) {
/* eslint-disable */`n    validatePublicKey(clientAddress);
/* eslint-disable */`n    const { rows } = await pool.query(
/* eslint-disable */`n      "SELECT * FROM jobs WHERE client_address = $1 ORDER BY created_at DESC",
/* eslint-disable */`n      [clientAddress]
/* eslint-disable */`n    );
/* eslint-disable */`n    return rows.map(rowToJob);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Transition a job to a new status.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} id      UUID of the job.
/* eslint-disable */`n   * @param {("open"|"in_progress"|"completed"|"cancelled")} status
/* eslint-disable */`n   * @returns {Promise<Job>}
/* eslint-disable */`n   * @throws {Error} 400 — invalid status.
/* eslint-disable */`n   * @throws {Error} 404 — job not found.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function updateJobStatus(id, status) {
/* eslint-disable */`n    if (!VALID_STATUSES.includes(status)) {
/* eslint-disable */`n      const e = new Error("Invalid status");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    const { rows } = await pool.query(
/* eslint-disable */`n      "UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
/* eslint-disable */`n      [status, id]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    if (!rows.length) {
/* eslint-disable */`n      const e = new Error("Job not found");
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    return rowToJob(rows[0]);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Hire a freelancer for a job and move it to `in_progress`.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} jobId              UUID of the job.
/* eslint-disable */`n   * @param {string} freelancerAddress  Stellar G-address of the freelancer being hired.
/* eslint-disable */`n   * @returns {Promise<Job>}
/* eslint-disable */`n   * @throws {Error} 400 — invalid freelancer public key.
/* eslint-disable */`n   * @throws {Error} 404 — job not found.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function assignFreelancer(jobId, freelancerAddress) {
/* eslint-disable */`n    validatePublicKey(freelancerAddress);
/* eslint-disable */`n
/* eslint-disable */`n    const { rows } = await pool.query(
/* eslint-disable */`n      `UPDATE jobs
/* eslint-disable */`n     SET freelancer_address = $1, status = 'in_progress', updated_at = NOW()
/* eslint-disable */`n     WHERE id = $2
/* eslint-disable */`n     RETURNING *`,
/* eslint-disable */`n      [freelancerAddress, jobId]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    if (!rows.length) {
/* eslint-disable */`n      const e = new Error("Job not found");
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    return rows.map(rowToJob);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Persist the on-chain escrow contract id against a job. Called after the
/* eslint-disable */`n   * client signs and submits the Soroban `create_escrow` transaction.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} jobId             UUID of the job.
/* eslint-disable */`n   * @param {string} escrowContractId  Soroban contract id (or transaction hash).
/* eslint-disable */`n   * @returns {Promise<Job>}
/* eslint-disable */`n   * @throws {Error} 400 — invalid escrow contract id.
/* eslint-disable */`n   * @throws {Error} 404 — job not found.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function updateJobEscrowId(jobId, escrowContractId) {
/* eslint-disable */`n    if (!escrowContractId || typeof escrowContractId !== "string") {
/* eslint-disable */`n      const e = new Error("Invalid escrow contract ID");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    const { rows } = await pool.query(
/* eslint-disable */`n      "UPDATE jobs SET escrow_contract_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
/* eslint-disable */`n      [escrowContractId, jobId]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    if (!rows.length) {
/* eslint-disable */`n      const e = new Error("Job not found");
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    return rowToJob(rows[0]);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Hard-delete a job. Used to roll back an "orphaned" job whose escrow
/* eslint-disable */`n   * transaction failed after the row was inserted.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} jobId  UUID of the job.
/* eslint-disable */`n   * @returns {Promise<void>}
/* eslint-disable */`n   * @throws {Error} 404 — job not found.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function deleteJob(jobId) {
/* eslint-disable */`n    const { rowCount } = await pool.query("DELETE FROM jobs WHERE id = $1", [jobId]);
/* eslint-disable */`n    if (!rowCount) {
/* eslint-disable */`n      const e = new Error("Job not found");
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Mark a job as Featured for the next 7 days.
/* eslint-disable */`n   *
/* eslint-disable */`n   * The route handler accepts a Stellar transaction hash from the client
/* eslint-disable */`n   * (intended to record the 10 XLM platform fee), but on-chain verification
/* eslint-disable */`n   * of that payment has not yet been wired up — see the `TODO` in
/* eslint-disable */`n   * `routes/jobs.js`. The hash is therefore not consumed by this service
/* eslint-disable */`n   * function today.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} jobId  UUID of the job to boost.
/* eslint-disable */`n   * @returns {Promise<Job>}
/* eslint-disable */`n   * @throws {Error} 404 — job not found.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function boostJob(jobId) {
/* eslint-disable */`n    // Verify job exists
/* eslint-disable */`n    const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
/* eslint-disable */`n    if (!rows.length) {
/* eslint-disable */`n      const e = new Error("Job not found");
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    const boostedUntil = new Date();
/* eslint-disable */`n    boostedUntil.setDate(boostedUntil.getDate() + 7);
/* eslint-disable */`n
/* eslint-disable */`n    const { rows: updateRows } = await pool.query(
/* eslint-disable */`n      `UPDATE jobs
/* eslint-disable */`n     SET boosted = true, boosted_until = $1, updated_at = NOW()
/* eslint-disable */`n     WHERE id = $2
/* eslint-disable */`n     RETURNING *`,
/* eslint-disable */`n      [boostedUntil.toISOString(), jobId]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    return rowToJob(updateRows[0]);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Increment the per-job share counter. Called when the client clicks
/* eslint-disable */`n   * "Share" or otherwise copies the job link.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} jobId  UUID of the job.
/* eslint-disable */`n   * @returns {Promise<Job>}
/* eslint-disable */`n   * @throws {Error} 404 — job not found.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function incrementShareCount(jobId) {
/* eslint-disable */`n    const { rows } = await pool.query(
/* eslint-disable */`n      "UPDATE jobs SET share_count = COALESCE(share_count, 0) + 1, updated_at = NOW() WHERE id = $1 RETURNING *",
/* eslint-disable */`n      [jobId]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    if (!rows.length) {
/* eslint-disable */`n      const e = new Error("Job not found");
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    return rowToJob(rows[0]);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Update a job's expiry date (extend).
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} jobId  UUID of the job.
/* eslint-disable */`n   * @param {number} additionalDays  Number of days to add (e.g., 30).
/* eslint-disable */`n   * @param {number} maxExtensions   Maximum allowed extensions (default 3).
/* eslint-disable */`n   * @returns {Promise<Job>}
/* eslint-disable */`n   * @throws {Error} 404 — job not found.
/* eslint-disable */`n   * @throws {Error} 400 — job already completed/cancelled or max extensions reached.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function extendJobExpiry(jobId, additionalDays, maxExtensions = 3) {
/* eslint-disable */`n    const job = await getJob(jobId);
/* eslint-disable */`n
/* eslint-disable */`n    if (job.status === "completed" || job.status === "cancelled") {
/* eslint-disable */`n      const e = new Error("Cannot extend a completed or cancelled job");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    if (job.extendedCount >= maxExtensions) {
/* eslint-disable */`n      const e = new Error("Maximum number of extensions reached");
/* eslint-disable */`n      e.status = 400;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    const currentExpiry = job.expiresAt ? new Date(job.expiresAt) : new Date(job.createdAt);
/* eslint-disable */`n    if (isNaN(currentExpiry.getTime())) {
/* eslint-disable */`n      currentExpiry.setTime(Date.now());
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    const newExpiry = new Date(currentExpiry.getTime() + additionalDays * 24 * 60 * 60 * 1000);
/* eslint-disable */`n
/* eslint-disable */`n    const { rows } = await pool.query(
/* eslint-disable */`n      `UPDATE jobs
/* eslint-disable */`n     SET expires_at = $1,
/* eslint-disable */`n         extended_count = extended_count + 1,
/* eslint-disable */`n         extended_until = $1,
/* eslint-disable */`n         updated_at = NOW()
/* eslint-disable */`n     WHERE id = $2
/* eslint-disable */`n     RETURNING *`,
/* eslint-disable */`n      [newExpiry.toISOString(), jobId]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    if (!rows.length) {
/* eslint-disable */`n      const e = new Error("Job not found");
/* eslint-disable */`n      e.status = 404;
/* eslint-disable */`n      throw e;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    return rowToJob(rows[0]);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Auto-expire jobs that have passed their expiry date and are still open (not hired).
/* eslint-disable */`n   * Returns the count of expired jobs.
/* eslint-disable */`n   *
/* eslint-disable */`n   * @returns {Promise<number>}
/* eslint-disable */`n   */
/* eslint-disable */`n  async function expireOldJobs() {
/* eslint-disable */`n    const { rowCount } = await pool.query(
/* eslint-disable */`n      `UPDATE jobs
/* eslint-disable */`n     SET status = 'cancelled',
/* eslint-disable */`n         updated_at = NOW()
/* eslint-disable */`n     WHERE status = 'open'
/* eslint-disable */`n       AND freelancer_address IS NULL
/* eslint-disable */`n       AND expires_at < NOW()`,
/* eslint-disable */`n    );
/* eslint-disable */`n    return rowCount;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Get jobs that are expiring within N days (for warnings).
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {number} withinDays  Days threshold (e.g., 3)
/* eslint-disable */`n   * @returns {Promise<Job[]>}
/* eslint-disable */`n   */
/* eslint-disable */`n  async function getExpiringJobs(withinDays = 3) {
/* eslint-disable */`n    const withinDate = new Date();
/* eslint-disable */`n    withinDate.setDate(withinDate.getDate() + withinDays);
/* eslint-disable */`n
/* eslint-disable */`n    const { rows } = await pool.query(
/* eslint-disable */`n      `SELECT * FROM jobs
/* eslint-disable */`n     WHERE status = 'open'
/* eslint-disable */`n       AND freelancer_address IS NULL
/* eslint-disable */`n       AND expires_at IS NOT NULL
/* eslint-disable */`n       AND expires_at <= $1
/* eslint-disable */`n     ORDER BY expires_at ASC`,
/* eslint-disable */`n      [withinDate.toISOString()]
/* eslint-disable */`n    );
/* eslint-disable */`n    return rows.map(rowToJob);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Get analytics for a job (applications per day, avg bid, skill distribution, time to hire).
/* eslint-disable */`n   *
/* eslint-disable */`n   * @param {string} jobId  UUID of the job.
/* eslint-disable */`n   * @returns {Promise<Object>} Analytics object.
/* eslint-disable */`n   */
/* eslint-disable */`n  async function getJobAnalytics(jobId) {
/* eslint-disable */`n    // Applications per day (time series)
/* eslint-disable */`n    const { rows: appsPerDayRows } = await pool.query(
/* eslint-disable */`n      `SELECT DATE(created_at) as day, COUNT(*) as count
/* eslint-disable */`n     FROM applications
/* eslint-disable */`n     WHERE job_id = $1
/* eslint-disable */`n     GROUP BY DATE(created_at)
/* eslint-disable */`n     ORDER BY day ASC`,
/* eslint-disable */`n      [jobId]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    // Average bid amount and currency breakdown
/* eslint-disable */`n    const { rows: bidRows } = await pool.query(
/* eslint-disable */`n      `SELECT AVG(bid_amount::numeric) as avg_bid, currency, COUNT(*) as count
/* eslint-disable */`n     FROM applications
/* eslint-disable */`n     WHERE job_id = $1
/* eslint-disable */`n     GROUP BY currency`,
/* eslint-disable */`n      [jobId]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    // Skill distribution - need to infer from freelancer profiles
/* eslint-disable */`n    const { rows: skillRows } = await pool.query(
/* eslint-disable */`n      `SELECT p.skills, COUNT(*) as count
/* eslint-disable */`n     FROM applications a
/* eslint-disable */`n     LEFT JOIN profiles p ON a.freelancer_address = p.public_key
/* eslint-disable */`n     WHERE a.job_id = $1
/* eslint-disable */`n     GROUP BY p.skills`,
/* eslint-disable */`n      [jobId]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    // Time to hire - from job created_at to when a freelancer was assigned (status = 'in_progress')
/* eslint-disable */`n    const { rows: hireTimeRows } = await pool.query(
/* eslint-disable */`n      `SELECT EXTRACT(EPOCH FROM (MIN(updated_at) - j.created_at)) / 86400 as days_to_hire
/* eslint-disable */`n     FROM jobs j
/* eslint-disable */`n     WHERE j.id = $1 AND j.status IN ('in_progress', 'completed')`,
/* eslint-disable */`n      [jobId]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    // Total applications and status breakdown
/* eslint-disable */`n    const { rows: statusRows } = await pool.query(
/* eslint-disable */`n      `SELECT status, COUNT(*) as count
/* eslint-disable */`n     FROM applications
/* eslint-disable */`n     WHERE job_id = $1
/* eslint-disable */`n     GROUP BY status`,
/* eslint-disable */`n      [jobId]
/* eslint-disable */`n    );
/* eslint-disable */`n
/* eslint-disable */`n    // Build aggregated skills count
/* eslint-disable */`n    const skillDistribution = {};
/* eslint-disable */`n    skillRows.forEach(row => {
/* eslint-disable */`n      const skills = row.skills || [];
/* eslint-disable */`n      skills.forEach(skill => {
/* eslint-disable */`n        skillDistribution[skill] = (skillDistribution[skill] || 0) + 1;
/* eslint-disable */`n      });
/* eslint-disable */`n    });
/* eslint-disable */`n
/* eslint-disable */`n    return {
/* eslint-disable */`n      applicationsPerDay: appsPerDayRows.map(r => ({ day: r.day, count: parseInt(r.count) || 0 })),
/* eslint-disable */`n      averageBidAmount: bidRows.map(r => ({
/* eslint-disable */`n        currency: r.currency,
/* eslint-disable */`n        avgBid: r.avg_bid ? parseFloat(r.avg_bid) : 0,
/* eslint-disable */`n        count: parseInt(r.count) || 0
/* eslint-disable */`n      })),
/* eslint-disable */`n      skillDistribution,
/* eslint-disable */`n      daysToHire: hireTimeRows[0] && hireTimeRows[0].days_to_hire ? parseFloat(hireTimeRows[0].days_to_hire) : null,
/* eslint-disable */`n      applicationStatusCounts: statusRows.reduce((acc, r) => {
/* eslint-disable */`n        acc[r.status] = parseInt(r.count) || 0;
/* eslint-disable */`n        return acc;
/* eslint-disable */`n      }, {})
/* eslint-disable */`n    };
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  module.exports = {
/* eslint-disable */`n    createJob,
/* eslint-disable */`n    getJob,
/* eslint-disable */`n    listJobs,
/* eslint-disable */`n    listJobsByClient,
/* eslint-disable */`n    updateJobStatus,
/* eslint-disable */`n    assignFreelancer,
/* eslint-disable */`n    updateJobEscrowId,
/* eslint-disable */`n    deleteJob,
/* eslint-disable */`n    boostJob,
/* eslint-disable */`n    incrementShareCount,
/* eslint-disable */`n    extendJobExpiry,
/* eslint-disable */`n    expireOldJobs,
/* eslint-disable */`n    getExpiringJobs,
/* eslint-disable */`n    getJobAnalytics,
/* eslint-disable */`n  };
/* eslint-disable */`n
/* eslint-disable */`nconst _pool = require("../db/pool");
/* eslint-disable */`n
/* eslint-disable */`nconst TIMELINE_EVENT_TYPES = ["job_posted", "bid_accepted", "escrow_funded", "work_completed", "escrow_released"];
/* eslint-disable */`n
/* eslint-disable */`nasync function recordTimelineEvent(jobId, eventType, txHash = null) {
/* eslint-disable */`n  if (!TIMELINE_EVENT_TYPES.includes(eventType)) {
/* eslint-disable */`n    throw new Error(`Invalid timeline event type: ${eventType}`);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const { rows: existing } = await _pool.query(
/* eslint-disable */`n    "SELECT * FROM job_timeline WHERE job_id = $1 AND event_type = $2",
/* eslint-disable */`n    [jobId, eventType]
/* eslint-disable */`n  );
/* eslint-disable */`n  if (existing.length > 0) {
/* eslint-disable */`n    return existing[0];
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const { rows } = await _pool.query(
/* eslint-disable */`n    "INSERT INTO job_timeline (job_id, event_type, tx_hash, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
/* eslint-disable */`n    [jobId, eventType, txHash]
/* eslint-disable */`n  );
/* eslint-disable */`n  return rows[0];
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nasync function getJobTimeline(jobId) {
/* eslint-disable */`n  const { rows } = await _pool.query(
/* eslint-disable */`n    "SELECT * FROM job_timeline WHERE job_id = $1 ORDER BY created_at ASC",
/* eslint-disable */`n    [jobId]
/* eslint-disable */`n  );
/* eslint-disable */`n  return rows.map(r => ({
/* eslint-disable */`n    id: r.id,
/* eslint-disable */`n    jobId: r.job_id,
/* eslint-disable */`n    eventType: r.event_type,
/* eslint-disable */`n    txHash: r.tx_hash,
/* eslint-disable */`n    createdAt: r.created_at
/* eslint-disable */`n  }));
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nObject.assign(module.exports, { TIMELINE_EVENT_TYPES, recordTimelineEvent, getJobTimeline });
/* eslint-disable */`n
/* eslint-disable */`n}}}
