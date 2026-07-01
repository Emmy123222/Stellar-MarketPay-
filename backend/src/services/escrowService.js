"use strict";

const pool = require("../db/pool");
const { getJob } = require("./jobService");
const { logContractInteraction } = require("./contractAuditService");
const {
  notifyEscrowEvent,
  EVENT_TYPES,
} = require("./notificationService");
const { processReferralPayout } = require("./referralService");
const { createServiceLogger, logError } = require("../utils/logger");
const { getClientIp } = require("../utils/clientIp");
const { signWithServiceKey, getServicePublicKey } = require("./stellarServiceKey");

const ESCROW_TIMEOUT_DAYS = 7;
const logger = createServiceLogger('escrowService');

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

/**
 * Verify that a Stellar account exists on the network by checking Horizon.
 * Throws a 400 error with a descriptive message if the account is not found.
 * Returns true if the account exists.
 */
async function verifyFreelancerAccount(freelancerAddress) {
  if (!freelancerAddress || !/^G[A-Z0-9]{55}$/.test(freelancerAddress)) {
    const e = new Error("Invalid Stellar address");
    e.status = 400;
    throw e;
  }

  try {
    const res = await fetch(
      `${HORIZON_URL}/accounts/${encodeURIComponent(freelancerAddress)}`,
    );
    if (!res.ok) {
      if (res.status === 404) {
        const e = new Error("Freelancer account not found on Stellar network");
        e.status = 400;
        throw e;
      }
      const body = await res.text();
      const e = new Error(`Horizon request failed: ${res.status} ${body}`);
      e.status = 502;
      throw e;
    }
    return true;
  } catch (err) {
    if (err.status) throw err;
    const e = new Error("Failed to verify freelancer account on Stellar network");
    e.status = 502;
    throw e;
  }
}

function normalizeMilestones(milestones, fallbackAmount) {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return [
      {
        description: "Final delivery",
        amount: parseFloat(fallbackAmount || 0).toFixed(7),
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

async function getMilestonesForJob(jobId, job) {
  const { rows } = await pool.query(
    "SELECT milestones, amount_xlm FROM escrows WHERE job_id = $1",
    [jobId],
  );

  const escrow = rows[0];
  const source = Array.isArray(escrow?.milestones) && escrow.milestones.length
    ? escrow.milestones
    : job.milestones;
  return normalizeMilestones(source, escrow?.amount_xlm || job.budget);
}

async function persistMilestones(jobId, milestones) {
  await pool.query(
    `UPDATE escrows
       SET milestones = $2,
           status = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements($2::jsonb) AS milestone
               WHERE milestone->>'status' <> 'released'
             ) THEN 'released'
             ELSE status
           END,
           released_at = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements($2::jsonb) AS milestone
               WHERE milestone->>'status' <> 'released'
             ) THEN NOW()
             ELSE released_at
           END,
           updated_at = NOW()
     WHERE job_id = $1`,
    [jobId, JSON.stringify(milestones)],
  );

  await pool.query(
    "UPDATE jobs SET milestones = $2, updated_at = NOW() WHERE id = $1",
    [jobId, JSON.stringify(milestones)],
  );
}

function validateMilestoneIndex(milestones, milestoneIndex) {
  const index = Number(milestoneIndex);
  if (!Number.isInteger(index) || index < 0 || index >= milestones.length) {
    const e = new Error("Invalid milestone index");
    e.status = 400;
    throw e;
  }
  return index;
}

async function releaseFunds(jobId, clientAddress, contractTxHash) {
  const job = await getJob(jobId);
  if (job.clientAddress !== clientAddress) {
    const e = new Error("Only the job client can release escrow");
    e.status = 403;
    throw e;
  }

  if (job.status !== "in_progress") {
    const e = new Error("Job is not in progress");
    e.status = 400;
    throw e;
  }

  const { rows: existing } = await pool.query(
    "SELECT status FROM escrow_releases WHERE job_id = $1",
    [jobId],
  );
  if (existing.length > 0) {
    const e = new Error("Escrow already released");
    e.status = 400;
    throw e;
  }

  const { rows: escrowRows } = await pool.query(
    "SELECT amount_xlm FROM escrows WHERE job_id = $1",
    [jobId],
  );

  await pool.query(
    `INSERT INTO escrow_releases (job_id, released_by, tx_hash, released_at)
     VALUES ($1, $2, $3, NOW())`,
    [jobId, clientAddress, contractTxHash || `offchain-${Date.now()}`],
  );

  await logContractInteraction({
    functionName: "release_escrow",
    callerAddress: clientAddress,
    jobId,
    txHash: contractTxHash || `offchain-${Date.now()}`,
  });

  await notifyEscrowEvent({
    eventType: EVENT_TYPES.ESCROW_RELEASED,
    jobId,
    clientAddress: job.clientAddress,
    freelancerAddress: job.freelancerAddress,
    data: {
      jobTitle: job.title,
      jobId,
      amount: job.budget,
      currency: job.currency,
    },
  });

  const amountXlm = escrowRows.length ? escrowRows[0].amount_xlm : "0";
  const referralResult = await processReferralPayout(
    jobId,
    job.freelancerAddress,
    amountXlm,
    contractTxHash || null,
  );

  return {
    success: true,
    message: "Escrow released and job completed",
    ...(referralResult && {
      referralBonus: {
        referrer: referralResult.referrer,
        bonusXlm: referralResult.bonusXlm,
      },
    }),
  };
}

async function refundClient(jobId, clientAddress, contractTxHash) {
  const job = await getJob(jobId);
  if (job.clientAddress !== clientAddress) {
    const e = new Error("Only the job client can refund escrow");
    e.status = 403;
    throw e;
  }

  const { rows: existing } = await pool.query(
    "SELECT status FROM escrow_releases WHERE job_id = $1",
    [jobId],
  );
  if (existing.length > 0) {
    const e = new Error("Escrow already released");
    e.status = 400;
    throw e;
  }

  await logContractInteraction({
    functionName: "refund_escrow",
    callerAddress: clientAddress,
    jobId,
    txHash: contractTxHash || `offchain-${Date.now()}`,
  });

  await notifyEscrowEvent({
    eventType: EVENT_TYPES.REFUND_ISSUED,
    jobId,
    clientAddress: job.clientAddress,
    freelancerAddress: job.freelancerAddress,
    data: {
      jobTitle: job.title,
      jobId,
      amount: job.budget,
      currency: job.currency,
    },
  });

  return { success: true, message: "Escrow refunded" };
}

async function timeoutRefund(jobId, clientAddress, contractTxHash, req = null) {
  const job = await getJob(jobId);
  if (job.clientAddress !== clientAddress) {
    const e = new Error("Only the job client can request a timeout refund");
    e.status = 403;
    throw e;
  }

  const { rows: existing } = await pool.query(
    "SELECT status, released_at FROM escrow_releases WHERE job_id = $1",
    [jobId],
  );
  if (existing.length > 0) {
    const e = new Error("Escrow already released");
    e.status = 400;
    throw e;
  }

  const createdAt = new Date(job.createdAt || job.created_at);
  const now = new Date();
  const daysSinceCreation = (now - createdAt) / (1000 * 60 * 60 * 24);
  if (daysSinceCreation < ESCROW_TIMEOUT_DAYS) {
    const e = new Error(
      `Escrow cannot be refunded yet. ${ESCROW_TIMEOUT_DAYS}-day timeout has not elapsed.`,
    );
    e.status = 400;
    throw e;
  }

  // Issue #536: Use service keypair for contract calls with IP validation
  const clientIp = req ? getClientIp(req) : '127.0.0.1';
  
  try {
    await signWithServiceKey(clientIp, async (keypair) => {
      // In a real implementation, this would sign and submit the Soroban transaction
      // For now, we validate the keypair is loaded and IP is allowed
      logger.info(
        { jobId, clientAddress, servicePublicKey: getServicePublicKey() },
        'Service key validated for timeout refund'
      );
    });
  } catch (err) {
    logger.error({ error: err.message, jobId, clientIp }, 'Service key validation failed');
    throw err;
  }

  await logContractInteraction({
    functionName: "timeout_refund",
    callerAddress: getServicePublicKey(), // Use service key as caller
    jobId,
    txHash: contractTxHash || `offchain-${Date.now()}`,
  });

  return {
    success: true,
    message: "Escrow refunded due to inactivity timeout",
  };
}

async function markDisputed(jobId, raisedBy) {
  const job = await getJob(jobId);
  if (
    job.clientAddress !== raisedBy &&
    job.freelancerAddress !== raisedBy
  ) {
    const e = new Error("Only the client or freelancer can raise a dispute");
    e.status = 403;
    throw e;
  }

  const { rows: existing } = await pool.query(
    "SELECT id FROM disputes WHERE job_id = $1",
    [jobId],
  );
  if (existing.length > 0) {
    const e = new Error("A dispute already exists for this job");
    e.status = 400;
    throw e;
  }

  const result = await pool.query(
    `INSERT INTO disputes (job_id, raised_by, status, created_at)
     VALUES ($1, $2, 'open', NOW())
     RETURNING *`,
    [jobId, raisedBy],
  );

  return { success: true, dispute: result.rows[0] };
}

async function releaseMilestone(jobId, milestoneIndex, clientAddress, contractTxHash) {
  const job = await getJob(jobId);
  if (job.clientAddress !== clientAddress) {
    const e = new Error("Only the job client can release milestones");
    e.status = 403;
    throw e;
  }

  if (job.status !== "in_progress") {
    const e = new Error("Job is not in progress");
    e.status = 400;
    throw e;
  }

  const milestones = await getMilestonesForJob(jobId, job);
  const index = validateMilestoneIndex(milestones, milestoneIndex);
  const milestone = milestones[index];

  if (milestone.status === "released") {
    const e = new Error("Milestone already released");
    e.status = 400;
    throw e;
  }
  if (milestone.status === "disputed") {
    const e = new Error("Disputed milestones cannot be released");
    e.status = 400;
    throw e;
  }

  milestones[index] = {
    ...milestone,
    status: "released",
    releasedAt: new Date().toISOString(),
  };
  await persistMilestones(jobId, milestones);

  await logContractInteraction({
    functionName: "release_milestone",
    callerAddress: clientAddress,
    jobId,
    txHash: contractTxHash || `offchain-${Date.now()}`,
  });

  await notifyEscrowEvent({
    eventType: EVENT_TYPES.ESCROW_RELEASED,
    jobId,
    clientAddress: job.clientAddress,
    freelancerAddress: job.freelancerAddress,
    data: {
      jobTitle: job.title,
      jobId,
      milestoneIndex: index,
      milestoneDescription: milestone.description,
      amount: milestone.amount,
      currency: job.currency,
    },
  });

  const allReleased = milestones.every((item) => item.status === "released");
  if (allReleased) {
    await processReferralPayout(
      jobId,
      job.freelancerAddress,
      milestones.reduce((sum, item) => sum + parseFloat(item.amount), 0).toFixed(7),
      contractTxHash || null,
    );
  }

  return {
    success: true,
    message: `Milestone ${index + 1} released`,
    milestone: milestones[index],
    milestones,
    allReleased,
  };
}

async function rejectMilestone(jobId, milestoneIndex, clientAddress, contractTxHash) {
  const job = await getJob(jobId);
  if (job.clientAddress !== clientAddress) {
    const e = new Error("Only the job client can reject milestones");
    e.status = 403;
    throw e;
  }

  if (job.status !== "in_progress") {
    const e = new Error("Job is not in progress");
    e.status = 400;
    throw e;
  }

  const milestones = await getMilestonesForJob(jobId, job);
  const index = validateMilestoneIndex(milestones, milestoneIndex);
  const milestone = milestones[index];

  if (milestone.status === "released") {
    const e = new Error("Released milestones cannot be rejected");
    e.status = 400;
    throw e;
  }
  if (milestone.status === "rejected") {
    const e = new Error("Milestone already rejected");
    e.status = 400;
    throw e;
  }

  milestones[index] = {
    ...milestone,
    status: "rejected",
    rejectedAt: new Date().toISOString(),
  };
  await persistMilestones(jobId, milestones);

  await logContractInteraction({
    functionName: "reject_milestone",
    callerAddress: clientAddress,
    jobId,
    txHash: contractTxHash || `offchain-${Date.now()}`,
  });

  await notifyEscrowEvent({
    eventType: EVENT_TYPES.REFUND_ISSUED,
    jobId,
    clientAddress: job.clientAddress,
    freelancerAddress: job.freelancerAddress,
    data: {
      jobTitle: job.title,
      jobId,
      milestoneIndex: index,
      milestoneDescription: milestone.description,
      amount: milestone.amount,
      currency: job.currency,
    },
  });

  return {
    success: true,
    message: `Milestone ${index + 1} rejected and refunded to client`,
    milestone: milestones[index],
    milestones,
  };
}

async function disputeMilestone(jobId, milestoneIndex, raisedBy) {
  const job = await getJob(jobId);
  if (job.clientAddress !== raisedBy && job.freelancerAddress !== raisedBy) {
    const e = new Error("Only the client or freelancer can dispute milestones");
    e.status = 403;
    throw e;
  }

  const milestones = await getMilestonesForJob(jobId, job);
  const index = validateMilestoneIndex(milestones, milestoneIndex);
  const milestone = milestones[index];

  if (milestone.status === "released") {
    const e = new Error("Released milestones cannot be disputed");
    e.status = 400;
    throw e;
  }
  if (milestone.status === "disputed") {
    const e = new Error("Milestone already disputed");
    e.status = 400;
    throw e;
  }

  milestones[index] = {
    ...milestone,
    status: "disputed",
    disputedAt: new Date().toISOString(),
  };
  await persistMilestones(jobId, milestones);

  const result = await pool.query(
    `INSERT INTO disputes (job_id, raised_by, status, created_at)
     VALUES ($1, $2, 'open', NOW())
     RETURNING *`,
    [jobId, raisedBy],
  );

  return { success: true, dispute: result.rows[0], milestone: milestones[index], milestones };
}

async function partialRelease(jobId, clientAddress, contractTxHash) {
  return releaseMilestone(jobId, 0, clientAddress, contractTxHash);
}

async function getEscrow(jobId) {
  const { rows } = await pool.query(
    "SELECT * FROM escrows WHERE job_id = $1",
    [jobId],
  );
  if (!rows.length) {
    const e = new Error("No escrow record found for this job");
    e.status = 404;
    throw e;
  }
  return rows[0];
}

/**
 * Resolve a Stellar ledger sequence number to a UTC timestamp via the
 * `ledger_timestamps` table populated by the indexer.
 *
 * Returns `null` if no mapping exists yet (e.g., the ledger hasn't been
 * processed by the indexer, or `timeout_ledger` is not set on the escrow).
 */
async function resolveLedgerTimestamp(ledger) {
  if (!ledger) return null;
  const { rows } = await pool.query(
    "SELECT timestamp FROM ledger_timestamps WHERE ledger = $1",
    [ledger],
  );
  return rows.length ? rows[0].timestamp : null;
}

/**
 * Return escrow data enriched with a resolved `timeout_at` timestamp.
 *
 * The `timeout_ledger` column on the escrow row stores the on-chain ledger
 * sequence at which the escrow expires.  This function looks up the UTC close
 * time for that ledger in `ledger_timestamps` and attaches it as
 * `timeout_at_resolved`, letting callers display a human-readable countdown
 * without hardcoding ledger-time approximations.
 */
async function getEscrowWithTimeout(jobId) {
  const escrow = await getEscrow(jobId);
  const timeoutAt = await resolveLedgerTimestamp(escrow.timeout_ledger);
  return { ...escrow, timeout_at_resolved: timeoutAt };
}

async function startEscrowTimeoutChecker() {
  const timeoutLogger = createServiceLogger('escrow-timeout');

  async function checkAndRefund() {
    try {
      const { rows } = await pool.query(
        `SELECT e.job_id, j.client_address
         FROM escrows e
         JOIN jobs j ON e.job_id = j.id
         WHERE e.status = 'funded' AND e.created_at + INTERVAL '7 days' < NOW()`
      );

      for (const row of rows) {
        try {
          await module.exports.timeoutRefund(row.job_id, row.client_address);
          timeoutLogger.info({ jobId: row.job_id }, 'Processed automatic timeout refund');
        } catch (err) {
          logError(timeoutLogger, err, { operation: 'escrow_timeout_refund_item', jobId: row.job_id });
        }
      }
    } catch (err) {
      logError(timeoutLogger, err, { operation: 'escrow_timeout_check' });
    }
  }

  // Run immediately on startup
  await checkAndRefund();

  // Schedule every hour (60 * 60 * 1000 ms)
  setInterval(checkAndRefund, 60 * 60 * 1000).unref();
}

async function submitDeliverableHash(jobId, freelancerAddress, hashHex) {
  const job = await getJob(jobId);

  if (job.freelancerAddress !== freelancerAddress) {
    const e = new Error("Only the freelancer can submit a deliverable hash");
    e.status = 403;
    throw e;
  }

  if (!/^[0-9a-fA-F]{64}$/.test(hashHex)) {
    const e = new Error("hashHex must be a 64-character hex string (SHA-256)");
    e.status = 400;
    throw e;
  }

  const { rows: escrowRows } = await pool.query(
    "SELECT status FROM escrows WHERE job_id = $1",
    [jobId],
  );
  if (!escrowRows.length) {
    const e = new Error("No escrow found for this job");
    e.status = 404;
    throw e;
  }

  if (escrowRows[0].status !== "funded" && escrowRows[0].status !== "in_progress") {
    const e = new Error("Can only submit hash for active escrow");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `INSERT INTO deliverable_submissions (job_id, freelancer_address, hash_hex)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [jobId, freelancerAddress, hashHex],
  );

  return { success: true, submission: rows[0] };
}

module.exports = {
  releaseFunds,
  refundClient,
  timeoutRefund,
  markDisputed,
  partialRelease,
  releaseMilestone,
  rejectMilestone,
  disputeMilestone,
  getEscrow,
  getEscrowWithTimeout,
  resolveLedgerTimestamp,
  startEscrowTimeoutChecker,
  submitDeliverableHash,

  verifyFreelancerAccount,
  ESCROW_TIMEOUT_DAYS,
};
