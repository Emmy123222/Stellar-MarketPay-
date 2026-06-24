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

module.exports = {
  releaseFunds,
  refundClient,
  timeoutRefund,
  markDisputed,
  partialRelease,
  releaseMilestone,
  disputeMilestone,
  getEscrow,
  normalizeMilestones,
  ESCROW_TIMEOUT_DAYS,
};
