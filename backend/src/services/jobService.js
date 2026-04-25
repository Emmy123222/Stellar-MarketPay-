/**
 * src/services/jobService.js
 */
"use strict";

import pool from "../db/pool.js";

const query = pool.query.bind(pool);


import { getTimezoneOffset } from "date-fns-tz";

// ─── constants ─────────────────────────────────────────

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

// ─── helpers ───────────────────────────────────────────

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

function isTimezoneCompatible(jobTimezone, userTimezone) {
  if (!jobTimezone || !userTimezone) return true;

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── service functions ─────────────────────────────────

async function createJob({
  title,
  description,
  budget,
  currency = "XLM",
  category,
  skills,
  deadline,
  clientAddress,
  timezone = null,
  screeningQuestions = [],
}) {
  validatePublicKey(clientAddress);

  if (!title || title.length < 10) throw new Error("Title must be at least 10 characters");
  if (!description || description.length < 30) throw new Error("Description must be at least 30 characters");
  if (!budget || parseFloat(budget) <= 0) throw new Error("Invalid budget");
  if (!["XLM", "USDC"].includes(currency)) throw new Error("Invalid currency");
  if (!VALID_CATEGORIES.includes(category)) throw new Error("Invalid category");

  const safeSkills = Array.isArray(skills) ? skills.slice(0, 8) : [];
  const safeQuestions = Array.isArray(screeningQuestions)
    ? screeningQuestions.slice(0, 5)
    : [];

  const { rows } = await query(
    `
    INSERT INTO jobs
    (title, description, budget, currency, category, skills, status, client_address, deadline, timezone, screening_questions, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,NOW(),NOW())
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
      timezone,
      safeQuestions,
    ]
  );

  return rowToJob(rows[0]);
}

async function getJob(id) {
  const { rows } = await query("SELECT * FROM jobs WHERE id = $1", [id]);
  if (!rows.length) throw new Error("Job not found");
  return rowToJob(rows[0]);
}

async function listJobs({ category, status = "open", limit = 20, search, cursor, timezone } = {}) {
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

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);

  const { rows } = await query(
    `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );

  let jobs = rows.map(rowToJob);

  if (timezone) {
    jobs = jobs.filter((job) => isTimezoneCompatible(job.timezone, timezone));
  }

  return { jobs };
}

async function listJobsByClient(clientAddress) {
  validatePublicKey(clientAddress);

  const { rows } = await query(
    "SELECT * FROM jobs WHERE client_address = $1 ORDER BY created_at DESC",
    [clientAddress]
  );

  return rows.map(rowToJob);
}

async function updateJobEscrowId(jobId, escrowContractId) {
  const { rows } = await query(
    "UPDATE jobs SET escrow_contract_id=$1 WHERE id=$2 RETURNING *",
    [escrowContractId, jobId]
  );

  if (!rows.length) throw new Error("Job not found");

  return rowToJob(rows[0]);
}

async function deleteJob(jobId) {
  await query("DELETE FROM jobs WHERE id = $1", [jobId]);
}

async function boostJob(jobId) {
  const boostedUntil = new Date();
  boostedUntil.setDate(boostedUntil.getDate() + 7);

  const { rows } = await query(
    "UPDATE jobs SET boosted=true, boosted_until=$1 WHERE id=$2 RETURNING *",
    [boostedUntil.toISOString(), jobId]
  );

  return rowToJob(rows[0]);
}

async function incrementShareCount(jobId) {
  const { rows } = await query(
    "UPDATE jobs SET share_count=COALESCE(share_count,0)+1 WHERE id=$1 RETURNING *",
    [jobId]
  );

  return rowToJob(rows[0]);
}

export default {
  createJob,
  getJob,
  listJobs,
  listJobsByClient,
  updateJobEscrowId,
  deleteJob,
  boostJob,
  incrementShareCount,
};