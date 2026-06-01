"use strict";

const pool = require("../db/pool");
const { getJob } = require("./jobService");
const { logContractInteraction } = require("./contractAuditService");
const {
  notifyEscrowEvent,
  EVENT_TYPES,
} = require("./notificationService");
const { processReferralPayout } = require("./referralService");

const ESCROW_TIMEOUT_DAYS = 7;

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

async function timeoutRefund(jobId, clientAddress, contractTxHash) {
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

  await logContractInteraction({
    functionName: "timeout_refund",
    callerAddress: clientAddress,
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

async function partialRelease(jobId, clientAddress, contractTxHash) {
  const job = await getJob(jobId);
  if (job.clientAddress !== clientAddress) {
    const e = new Error("Only the job client can release milestones");
    e.status = 403;
    throw e;
  }

  const { rows: existing } = await pool.query(
    "SELECT status FROM escrow_releases WHERE job_id = $1 AND status = 'partial'",
    [jobId],
  );
  if (existing.length > 0) {
    const e = new Error("Partial release already processed for this escrow");
    e.status = 400;
    throw e;
  }

  await logContractInteraction({
    functionName: "partial_release",
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

  return { success: true, message: "Escrow released and job completed" };
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

module.exports = {
  releaseFunds,
  refundClient,
  timeoutRefund,
  markDisputed,
  partialRelease,
  getEscrow,
  ESCROW_TIMEOUT_DAYS,
};
