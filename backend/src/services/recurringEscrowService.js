/**
 * src/services/recurringEscrowService.js
 * Service responsibility: Manages recurring escrow for retainer contracts (Issue #450)
 * Handles creation, ticking, and cancellation of recurring escrows.
 */
"use strict";

const pool = require("../db/pool");
const { getJob } = require("./jobService");
const { logContractInteraction } = require("./contractAuditService");
const {
  notifyEscrowEvent,
  EVENT_TYPES,
} = require("./notificationService");
const { createServiceLogger, logError } = require("../utils/logger");

const LEDGERS_PER_DAY = 17280; // Approximate number of ledgers per day on Stellar

/**
 * Create a recurring escrow record in the database.
 * 
 * @param {Object} params - Parameters for creating recurring escrow
 * @param {string} params.jobId - The job ID
 * @param {string} params.clientAddress - The client's Stellar address
 * @param {string} params.freelancerAddress - The freelancer's Stellar address
 * @param {string} params.contractId - The contract ID
 * @param {number} params.amountPerRelease - Amount to release per interval
 * @param {string} params.currency - Currency (XLM or USDC)
 * @param {number} params.intervalDays - Interval in days between releases
 * @param {number} params.totalReleases - Total number of releases
 * @returns {Promise<Object>} The created recurring escrow record
 */
async function createRecurringEscrow({
  jobId,
  clientAddress,
  freelancerAddress,
  contractId,
  amountPerRelease,
  currency,
  intervalDays,
  totalReleases,
}) {
  const intervalLedgers = intervalDays * LEDGERS_PER_DAY;

  const { rows } = await pool.query(
    `UPDATE escrows
     SET is_recurring = true,
         interval_ledgers = $1,
         releases_remaining = $2,
         last_release_ledger = NULL,
         amount_per_release = $3,
         updated_at = NOW()
     WHERE job_id = $4
     RETURNING *`,
    [intervalLedgers, totalReleases, amountPerRelease, jobId]
  );

  if (!rows.length) {
    const e = new Error("Escrow not found for this job");
    e.status = 404;
    throw e;
  }

  return rows[0];
}

/**
 * Tick a recurring escrow - releases one payment if interval has elapsed.
 * This is called by the cron job.
 * 
 * @param {string} jobId - The job ID
 * @returns {Promise<Object>} Result of the tick operation
 */
async function tickRecurringEscrow(jobId) {
  const { rows } = await pool.query(
    `SELECT * FROM escrows 
     WHERE job_id = $1 AND is_recurring = true AND releases_remaining > 0 AND status = 'funded'`,
    [jobId]
  );

  if (!rows.length) {
    const e = new Error("Active recurring escrow not found");
    e.status = 404;
    throw e;
  }

  const escrow = rows[0];

  // Update the last release ledger and decrement releases remaining
  const { rows: updatedRows } = await pool.query(
    `UPDATE escrows
     SET releases_remaining = releases_remaining - 1,
         last_release_ledger = (SELECT COALESCE(MAX(ledger), 0) FROM ledger_timestamps),
         updated_at = NOW()
     WHERE job_id = $1
     RETURNING *`,
    [jobId]
  );

  const updatedEscrow = updatedRows[0];

  // If no releases remaining, mark as released
  if (updatedEscrow.releases_remaining === 0) {
    await pool.query(
      `UPDATE escrows
       SET status = 'released', released_at = NOW(), updated_at = NOW()
       WHERE job_id = $1`,
      [jobId]
    );
  }

  // Notify both parties
  const job = await getJob(jobId);
  await notifyEscrowEvent({
    eventType: EVENT_TYPES.ESCROW_RELEASED,
    jobId,
    clientAddress: job.clientAddress,
    freelancerAddress: job.freelancerAddress,
    data: {
      jobTitle: job.title,
      jobId,
      amount: escrow.amount_per_release,
      currency: job.currency,
      isRecurring: true,
      releasesRemaining: updatedEscrow.releases_remaining,
    },
  });

  return {
    success: true,
    message: "Recurring escrow ticked successfully",
    releasesRemaining: updatedEscrow.releases_remaining,
    amountReleased: escrow.amount_per_release,
  };
}

/**
 * Cancel a recurring escrow and refund remaining funds.
 * 
 * @param {string} jobId - The job ID
 * @param {string} clientAddress - The client's Stellar address
 * @returns {Promise<Object>} Result of the cancellation
 */
async function cancelRecurringEscrow(jobId, clientAddress) {
  const job = await getJob(jobId);
  if (job.clientAddress !== clientAddress) {
    const e = new Error("Only the client can cancel recurring escrow");
    e.status = 403;
    throw e;
  }

  const { rows } = await pool.query(
    `SELECT * FROM escrows 
     WHERE job_id = $1 AND is_recurring = true AND status = 'funded'`,
    [jobId]
  );

  if (!rows.length) {
    const e = new Error("Active recurring escrow not found");
    e.status = 404;
    throw e;
  }

  const escrow = rows[0];

  // Calculate remaining amount
  const remainingAmount = escrow.amount_per_release * escrow.releases_remaining;

  // Update escrow status
  await pool.query(
    `UPDATE escrows
     SET status = 'refunded',
         releases_remaining = 0,
         updated_at = NOW()
     WHERE job_id = $1`,
    [jobId]
  );

  // Notify both parties
  await notifyEscrowEvent({
    eventType: EVENT_TYPES.REFUND_ISSUED,
    jobId,
    clientAddress: job.clientAddress,
    freelancerAddress: job.freelancerAddress,
    data: {
      jobTitle: job.title,
      jobId,
      amount: remainingAmount,
      currency: job.currency,
      isRecurring: true,
    },
  });

  return {
    success: true,
    message: "Recurring escrow cancelled and refunded",
    refundedAmount: remainingAmount,
  };
}

/**
 * Get recurring escrow details for a job.
 * 
 * @param {string} jobId - The job ID
 * @returns {Promise<Object>} The recurring escrow details
 */
async function getRecurringEscrow(jobId) {
  const { rows } = await pool.query(
    `SELECT * FROM escrows 
     WHERE job_id = $1 AND is_recurring = true`,
    [jobId]
  );

  if (!rows.length) {
    const e = new Error("Recurring escrow not found");
    e.status = 404;
    throw e;
  }

  return rows[0];
}

/**
 * Get all active recurring escrows that need to be ticked.
 * This is used by the cron job.
 * 
 * @returns {Promise<Array>} Array of active recurring escrows
 */
async function getActiveRecurringEscrows() {
  const { rows } = await pool.query(
    `SELECT e.*, j.title, j.client_address, j.freelancer_address, j.currency
     FROM escrows e
     JOIN jobs j ON e.job_id = j.id
     WHERE e.is_recurring = true 
       AND e.releases_remaining > 0 
       AND e.status = 'funded'
     ORDER BY e.updated_at ASC`
  );

  return rows;
}

/**
 * Start the recurring escrow ticker cron job.
 * This runs every hour to check for recurring escrows that need to be ticked.
 */
async function startRecurringEscrowTicker() {
  const tickerLogger = createServiceLogger('recurring-escrow-ticker');

  async function tickAllRecurringEscrows() {
    try {
      const activeEscrows = await getActiveRecurringEscrows();

      for (const escrow of activeEscrows) {
        try {
          // Check if interval has elapsed by comparing with last release ledger
          const currentLedgerResult = await pool.query(
            'SELECT COALESCE(MAX(ledger), 0) as max_ledger FROM ledger_timestamps'
          );
          const currentLedger = currentLedgerResult.rows[0].max_ledger;
          const lastReleaseLedger = escrow.last_release_ledger || 0;
          const ledgersSinceLast = currentLedger - lastReleaseLedger;

          if (ledgersSinceLast >= escrow.interval_ledgers) {
            await tickRecurringEscrow(escrow.job_id);
            tickerLogger.info(
              { jobId: escrow.job_id, releasesRemaining: escrow.releases_remaining - 1 },
              'Ticked recurring escrow'
            );
          }
        } catch (err) {
          logError(tickerLogger, err, { operation: 'tick_recurring_escrow', jobId: escrow.job_id });
        }
      }
    } catch (err) {
      logError(tickerLogger, err, { operation: 'get_active_recurring_escrows' });
    }
  }

  // Run immediately on startup
  await tickAllRecurringEscrows();

  // Schedule every hour (60 * 60 * 1000 ms)
  setInterval(tickAllRecurringEscrows, 60 * 60 * 1000).unref();
}

module.exports = {
  createRecurringEscrow,
  tickRecurringEscrow,
  cancelRecurringEscrow,
  getRecurringEscrow,
  getActiveRecurringEscrows,
  startRecurringEscrowTicker,
  LEDGERS_PER_DAY,
};
