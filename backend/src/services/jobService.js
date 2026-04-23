/**
 * src/services/jobService.js
 * All data persisted in the `jobs` PostgreSQL table.
 */
"use strict";

import { query } from "../db/pool";

// ─── constants ───────────────────────────────────────────────────────────────

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

// ─── helpers ─────────────────────────────────────────────────────────────────

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

/** Convert snake_case DB row → camelCase API object */
function rowToJob(row) {
  return {
    id:                row.id,
    title:             row.title,
    description:       row.description,
    budget:            row.budget,
    currency:          row.currency || 'XLM',
    category:          row.category,
    skills:            row.skills,
    status:            row.status,
    clientAddress:     row.client_address,
    freelancerAddress: row.freelancer_address,
    escrowContractId:  row.escrow_contract_id,
    applicantCount:    row.applicant_count,
    shareCount:        row.share_count || 0,
    boosted:           row.boosted || false,
    boostedUntil:      row.boosted_until,
    deadline:          row.deadline,
    createdAt:         row.created_at,
    updatedAt:         row.updated_at,
  };
}

// ─── service functions ───────────────────────────────────────────────────────

/**
 * Create a new job listing.
 * Note: client's profile row must already exist (FK constraint).
 */
async function createJob({ title, description, budget, currency = 'XLM', category, skills, deadline, clientAddress }) {
  validatePublicKey(clientAddress);

  if (!title || title.length < 10) {
    const e = new Error("Title must be at least 10 characters"); e.status = 400; throw e;
  }
  if (!description || description.length < 30) {
    const e = new Error("Description must be at least 30 characters"); e.status = 400; throw e;
  }
  if (!budget || isNaN(parseFloat(budget)) || parseFloat(budget) <= 0) {
    const e = new Error("Budget must be a positive number"); e.status = 400; throw e;
  }
  if (!currency || !['XLM', 'USDC'].includes(currency)) {
    const e = new Error("Currency must be XLM or USDC"); e.status = 400; throw e;
  }
  if (!VALID_CATEGORIES.includes(category)) {
    const e = new Error("Invalid category"); e.status = 400; throw e;
  }

  const safeSkills = Array.isArray(skills) ? skills.slice(0, 8) : [];

  const { rows } = await query(
    `
    INSERT INTO jobs
      (title, description, budget, currency, category, skills, status, client_address, deadline, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, NOW(), NOW())
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
    ]
  );

  return rowToJob(rows[0]);
}

async function getJob(id) {
  const { rows } = await query("SELECT * FROM jobs WHERE id = $1", [id]);
  if (!rows.length) {
    const e = new Error("Job not found"); e.status = 404; throw e;
  }
  return rowToJob(rows[0]);
}

function encodeCursor(jobRow) {
  return Buffer.from(JSON.stringify({
    createdAt: jobRow.created_at,
    id: jobRow.id,
  })).toString("base64");
}

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

async function listJobs({ category, status = "open", limit = 50, search, cursor } = {}) {
  const conditions = [];
  const params     = [];

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

  if (cursor) {
    const decoded = decodeCursor(cursor);
    params.push(decoded.createdAt, decoded.id);
    const createdAtIdx = params.length - 1;
    const idIdx = params.length;
    conditions.push(`(created_at < $${createdAtIdx} OR (created_at = $${createdAtIdx} AND id < $${idIdx}))`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  params.push(safeLimit + 1);

  const { rows } = await query(
    `SELECT * FROM jobs ${where} ORDER BY 
       CASE WHEN boosted = true AND (boosted_until IS NULL OR boosted_until > NOW()) THEN 0 ELSE 1 END,
       created_at DESC, id DESC LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > safeLimit;
  const currentRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const nextCursor = hasMore ? encodeCursor(currentRows[currentRows.length - 1]) : null;

  return {
    jobs: currentRows.map(rowToJob),
    nextCursor,
  };
}

async function listJobsByClient(clientAddress) {
  validatePublicKey(clientAddress);
  const { rows } = await query(
    "SELECT * FROM jobs WHERE client_address = $1 ORDER BY created_at DESC",
    [clientAddress]
  );
  return rows.map(rowToJob);
}

async function updateJobStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    const e = new Error("Invalid status"); e.status = 400; throw e;
  }

  const { rows } = await query(
    "UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [status, id]
  );

  if (!rows.length) {
    const e = new Error("Job not found"); e.status = 404; throw e;
  }

  return rowToJob(rows[0]);
}

async function assignFreelancer(jobId, freelancerAddress) {
  validatePublicKey(freelancerAddress);

  const { rows } = await query(
    `UPDATE jobs
     SET freelancer_address = $1, status = 'in_progress', updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [freelancerAddress, jobId]
  );

  if (!rows.length) {
    const e = new Error("Job not found"); e.status = 404; throw e;
  }

  return rowToJob(rows[0]);
}

async function updateJobEscrowId(jobId, escrowContractId) {
  if (!escrowContractId || typeof escrowContractId !== "string") {
    const e = new Error("Invalid escrow contract ID"); e.status = 400; throw e;
  }

  const { rows } = await query(
    "UPDATE jobs SET escrow_contract_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [escrowContractId, jobId]
  );

  if (!rows.length) {
    const e = new Error("Job not found"); e.status = 404; throw e;
  }

  return rowToJob(rows[0]);
}

async function deleteJob(jobId) {
  const { rowCount } = await query("DELETE FROM jobs WHERE id = $1", [jobId]);
  if (!rowCount) {
    const e = new Error("Job not found"); e.status = 404; throw e;
  }
}

async function boostJob(jobId, txHash) {
  // Verify job exists
  const { rows } = await query("SELECT * FROM jobs WHERE id = $1", [jobId]);
  if (!rows.length) {
    const e = new Error("Job not found"); e.status = 404; throw e;
  }

  // Set boost for 7 days from now
  const boostedUntil = new Date();
  boostedUntil.setDate(boostedUntil.getDate() + 7);

  const { rows: updateRows } = await query(
    `UPDATE jobs 
     SET boosted = true, boosted_until = $1, updated_at = NOW() 
     WHERE id = $2 
     RETURNING *`,
    [boostedUntil.toISOString(), jobId]
  );

  return rowToJob(updateRows[0]);
}

async function incrementShareCount(jobId) {
  const { rows } = await query(
    "UPDATE jobs SET share_count = COALESCE(share_count, 0) + 1, updated_at = NOW() WHERE id = $1 RETURNING *",
    [jobId]
  );
  
  if (!rows.length) {
    const e = new Error("Job not found"); e.status = 404; throw e;
  }

  return rowToJob(rows[0]);
}

export default {
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