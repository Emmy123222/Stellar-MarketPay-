"use strict";

const DataLoader = require("dataloader");
const pool = require("../db/pool");

function rowToProfile(row) {
  return {
    publicKey: row.public_key,
    displayName: row.display_name,
    bio: row.bio,
    skills: row.skills || [],
    rating: row.rating ? parseFloat(row.rating) : null,
    completedJobs: row.completed_jobs || 0,
  };
}

function rowToApplication(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    freelancerAddress: row.freelancer_address,
    proposal: row.proposal,
    bidAmount: row.bid_amount ? String(row.bid_amount) : "0",
    currency: row.currency || "XLM",
    status: row.status,
    screeningAnswers: row.screening_answers ? JSON.stringify(row.screening_answers) : null,
    createdAt: row.created_at,
  };
}

function rowToEscrow(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    contractId: row.contract_id,
    amountXlm: row.amount_xlm ? String(row.amount_xlm) : "0",
    status: row.status,
    releasedAt: row.released_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createLoaders() {
  const profileLoader = new DataLoader(async (keys) => {
    if (keys.length === 0) return [];
    const { rows } = await pool.query(
      "SELECT * FROM profiles WHERE public_key = ANY($1)",
      [keys],
    );
    const map = new Map();
    for (const row of rows) {
      map.set(row.public_key, rowToProfile(row));
    }
    return keys.map((k) => map.get(k) || null);
  });

  const applicationsByJobLoader = new DataLoader(async (jobIds) => {
    if (jobIds.length === 0) return [];
    const { rows } = await pool.query(
      "SELECT * FROM applications WHERE job_id = ANY($1) ORDER BY created_at DESC",
      [jobIds],
    );
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.job_id)) map.set(row.job_id, []);
      map.get(row.job_id).push(rowToApplication(row));
    }
    return jobIds.map((id) => map.get(id) || []);
  });

  const escrowByJobLoader = new DataLoader(async (jobIds) => {
    if (jobIds.length === 0) return [];
    const { rows } = await pool.query(
      "SELECT * FROM escrows WHERE job_id = ANY($1)",
      [jobIds],
    );
    const map = new Map();
    for (const row of rows) {
      map.set(row.job_id, rowToEscrow(row));
    }
    return jobIds.map((id) => map.get(id) || null);
  });

  return {
    profile: profileLoader,
    applicationsByJob: applicationsByJobLoader,
    escrowByJob: escrowByJobLoader,
  };
}

module.exports = { createLoaders };
