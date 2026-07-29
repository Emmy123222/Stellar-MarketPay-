/**
 * src/services/timeTrackingService.js
 * Service: time entry logging and invoice generation for hourly jobs.
 *
 * Tables used:
 *   time_entries  — individual tracked or manually-entered work sessions
 *   time_invoices — grouped invoice submitted by freelancer for client approval
 */
"use strict";

const pool = require("../db/pool");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

function rowToEntry(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    freelancerAddress: row.freelancer_address,
    durationMinutes: row.duration_minutes,
    description: row.description,
    startedAt: row.started_at,
    createdAt: row.created_at,
  };
}

function rowToInvoice(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    freelancerAddress: row.freelancer_address,
    clientAddress: row.client_address,
    totalMinutes: row.total_minutes,
    hourlyRateXlm: row.hourly_rate_xlm,
    totalAmountXlm: row.total_amount_xlm,
    status: row.status,
    entryIds: row.entry_ids || [],
    contractTxHash: row.contract_tx_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Time Entries ─────────────────────────────────────────────────────────────

/**
 * Log a single time entry for a job.
 *
 * @param {Object} params
 * @param {string} params.jobId            UUID of the job.
 * @param {string} params.freelancerAddress Stellar G-address of the freelancer.
 * @param {number} params.durationMinutes  Positive integer minutes worked.
 * @param {string} [params.description]    Optional description of work done.
 * @param {string} [params.startedAt]      ISO timestamp when work started (defaults to NOW).
 * @returns {Promise<Object>} The created time entry.
 */
async function logTimeEntry({ jobId, freelancerAddress, durationMinutes, description, startedAt }) {
  validatePublicKey(freelancerAddress);

  if (!jobId) {
    const e = new Error("jobId is required");
    e.status = 400;
    throw e;
  }

  const minutes = parseInt(durationMinutes, 10);
  if (!minutes || minutes <= 0 || minutes > 1440) {
    const e = new Error("durationMinutes must be a positive integer no greater than 1440 (24 h)");
    e.status = 400;
    throw e;
  }

  // Verify the job exists and the caller is the assigned freelancer
  const { rows: jobRows } = await pool.query(
    "SELECT id, freelancer_address, status FROM jobs WHERE id = $1",
    [jobId]
  );
  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }
  const job = jobRows[0];
  if (job.freelancer_address !== freelancerAddress) {
    const e = new Error("Only the assigned freelancer can log time for this job");
    e.status = 403;
    throw e;
  }
  if (!["in_progress", "completed"].includes(job.status)) {
    const e = new Error("Time can only be logged for jobs that are in progress or completed");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `INSERT INTO time_entries
       (job_id, freelancer_address, duration_minutes, description, started_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [
      jobId,
      freelancerAddress,
      minutes,
      description ? description.trim().slice(0, 500) : null,
      startedAt || null,
    ]
  );

  return rowToEntry(rows[0]);
}

/**
 * Retrieve all time entries for a job.
 *
 * @param {string} jobId UUID of the job.
 * @returns {Promise<Object[]>} Array of time entries ordered oldest-first.
 */
async function getTimeEntriesForJob(jobId) {
  if (!jobId) {
    const e = new Error("jobId is required");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `SELECT * FROM time_entries
     WHERE job_id = $1
     ORDER BY created_at ASC`,
    [jobId]
  );

  return rows.map(rowToEntry);
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

/**
 * Generate an invoice from a set of time entries.
 *
 * The invoice captures the total minutes, the agreed hourly rate, and the
 * calculated XLM amount.  It starts in `pending` status awaiting client
 * approval.
 *
 * @param {Object} params
 * @param {string}   params.jobId              UUID of the job.
 * @param {string}   params.freelancerAddress  Stellar G-address of the freelancer.
 * @param {number}   params.hourlyRateXlm      Agreed hourly rate in XLM (positive).
 * @param {string[]} [params.entryIds]         Specific entry UUIDs to include.
 *                                             Defaults to all un-invoiced entries.
 * @returns {Promise<Object>} The created invoice.
 */
async function generateInvoice({ jobId, freelancerAddress, hourlyRateXlm, entryIds }) {
  validatePublicKey(freelancerAddress);

  if (!jobId) {
    const e = new Error("jobId is required");
    e.status = 400;
    throw e;
  }

  const rate = parseFloat(hourlyRateXlm);
  if (!rate || rate <= 0) {
    const e = new Error("hourlyRateXlm must be a positive number");
    e.status = 400;
    throw e;
  }

  // Verify job and participants
  const { rows: jobRows } = await pool.query(
    "SELECT id, freelancer_address, client_address, status FROM jobs WHERE id = $1",
    [jobId]
  );
  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }
  const job = jobRows[0];
  if (job.freelancer_address !== freelancerAddress) {
    const e = new Error("Only the assigned freelancer can generate an invoice for this job");
    e.status = 403;
    throw e;
  }

  // Fetch the entries to include
  let entries;
  if (Array.isArray(entryIds) && entryIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT * FROM time_entries
       WHERE id = ANY($1::uuid[]) AND job_id = $2 AND freelancer_address = $3`,
      [entryIds, jobId, freelancerAddress]
    );
    entries = rows;
    if (!entries.length) {
      const e = new Error("No matching time entries found for the provided IDs");
      e.status = 400;
      throw e;
    }
  } else {
    // Default: all entries not yet included in an approved/pending invoice
    const { rows } = await pool.query(
      `SELECT te.* FROM time_entries te
       WHERE te.job_id = $1
         AND te.freelancer_address = $2
         AND NOT EXISTS (
           SELECT 1 FROM time_invoices ti
           WHERE ti.job_id = $1
             AND ti.status IN ('pending', 'approved')
             AND te.id = ANY(ti.entry_ids)
         )
       ORDER BY te.created_at ASC`,
      [jobId, freelancerAddress]
    );
    entries = rows;
    if (!entries.length) {
      const e = new Error("No un-invoiced time entries found for this job");
      e.status = 400;
      throw e;
    }
  }

  const totalMinutes = entries.reduce((sum, e) => sum + e.duration_minutes, 0);
  const totalHours = totalMinutes / 60;
  const totalAmountXlm = (totalHours * rate).toFixed(7);
  const includedIds = entries.map((e) => e.id);

  const { rows: invoiceRows } = await pool.query(
    `INSERT INTO time_invoices
       (job_id, freelancer_address, client_address, total_minutes, hourly_rate_xlm,
        total_amount_xlm, status, entry_ids, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW(), NOW())
     RETURNING *`,
    [
      jobId,
      freelancerAddress,
      job.client_address,
      totalMinutes,
      rate.toFixed(7),
      totalAmountXlm,
      includedIds,
    ]
  );

  return rowToInvoice(invoiceRows[0]);
}

/**
 * Retrieve all invoices for a job.
 *
 * @param {string} jobId UUID of the job.
 * @returns {Promise<Object[]>} Array of invoices ordered newest-first.
 */
async function getInvoicesForJob(jobId) {
  if (!jobId) {
    const e = new Error("jobId is required");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `SELECT * FROM time_invoices WHERE job_id = $1 ORDER BY created_at DESC`,
    [jobId]
  );

  return rows.map(rowToInvoice);
}

/**
 * Client approves or rejects an invoice.
 *
 * Approving an invoice records the optional on-chain tx hash and marks the
 * invoice as approved.  The actual escrow partial_release is handled by the
 * existing escrow route — this service only tracks the approval decision.
 *
 * @param {Object} params
 * @param {string}  params.invoiceId      UUID of the invoice.
 * @param {string}  params.clientAddress  Stellar G-address of the client.
 * @param {"approved"|"rejected"} params.decision
 * @param {string}  [params.contractTxHash] On-chain tx hash (for approved invoices).
 * @returns {Promise<Object>} The updated invoice.
 */
async function reviewInvoice({ invoiceId, clientAddress, decision, contractTxHash }) {
  validatePublicKey(clientAddress);

  if (!["approved", "rejected"].includes(decision)) {
    const e = new Error("decision must be 'approved' or 'rejected'");
    e.status = 400;
    throw e;
  }

  const { rows: invRows } = await pool.query(
    "SELECT * FROM time_invoices WHERE id = $1",
    [invoiceId]
  );
  if (!invRows.length) {
    const e = new Error("Invoice not found");
    e.status = 404;
    throw e;
  }
  const invoice = invRows[0];

  if (invoice.client_address !== clientAddress) {
    const e = new Error("Only the job client can review this invoice");
    e.status = 403;
    throw e;
  }
  if (invoice.status !== "pending") {
    const e = new Error(`Invoice is already ${invoice.status}`);
    e.status = 400;
    throw e;
  }

  const { rows: updated } = await pool.query(
    `UPDATE time_invoices
     SET status = $1,
         contract_tx_hash = $2,
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [decision, contractTxHash || null, invoiceId]
  );

  return rowToInvoice(updated[0]);
}

module.exports = {
  logTimeEntry,
  getTimeEntriesForJob,
  generateInvoice,
  getInvoicesForJob,
  reviewInvoice,
};
