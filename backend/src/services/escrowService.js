"suse strict";

const pool = require("../db/pool");
const { getJob, recordTimelineEvent } = require("./jobService");
const { logContractInteraction, verifyOnChainTransaction } = require("./contractAuditService");
const {
  notifyEscrowEvent,
  EVENT_TYPES,
} = require("./notificationService");
const { processReferralPayout } = require("./referralService");
const insightsService = require("./insightsService");
const { createServiceLogger, logError } = require("../utils/logger");
const { getClientIp } = require("../utils/clientIp");
const { signWithServiceKey, getServicePublicKey } = require("./stellarServiceKey");
const sorobanClient = require("./sorobanClient");
const metrics = require("../metrics");

const ESCROW_TIMEOUT_DAYS = 7;
// Spread each instance's one-minute guardian run over a ten-second window.
// This avoids a thundering herd without changing the intended cadence.
const ESCROW_TIMEOUT_CHECK_MIN_DELAY_MS = 55 * 1000;
const ESCROW_TIMEOUT_CHECK_MAX_DELAY_MS = 65 * 1000;

function getEscrowTimeoutCheckDelay(random = Math.random) {
  return Math.floor(
    random() * (ESCROW_TIMEOUT_CHECK_MAX_DELAY_MS - ESCROW_TIMEOUT_CHECK_MIN_DELAY_MS + 1),
  ) + ESCROW_TIMEOUT_CHECK_MIN_DELAY_MS;
}
const logger = createServiceLogger('escrowService');

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";

/**
 * Verify that a Stellar account exists on the network by checking Horizon.
 * Throws a 400 error with a descriptive message if the account is not found.
 * Returns true if the account exists.
 */
async function verifyFreelancerAccount(freelancerAddress) {
  if (!freelancerAddress || !/^G[A-Z0-9]{56}$/.test(freelancerAddress)) {
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

/**
 * Zero-address spellings that must never reach the chain as the escrow
 * token (Issue #1484).
 */
const ZERO_TOKEN_ADDRESSES = new Set([
  "",
  "0",
  "0x0",
  `0x${"0".repeat(40)}`,
  "0".repeat(64),
  `0x${"0".repeat(64)}`,
]);

/** Soroban contract address: `C` + 55 base32 characters (Stellar alphabet). */
const TOKEN_CONTRACT_ADDRESS_PATTERN = /^C[A-Z2-7]{55}$/;

/**
 * Pre-flight validation for a `create_escrow` payload (Issue #1484).
 *
 * Mirrors the Soroban contract's `create_escrow` gate (canonical error
 * string "Amount must be positive", ContractError 2001) and adds the
 * participant and zero-address-token guards, so adversarial payloads are
 * rejected with a clean, stable error STRING *before* any asset transfer is
 * attempted on-chain.
 *
 * Never throws: every malformed input — zero amounts, non-numeric garbage,
 * missing fields, zero-address or malformed tokens — maps to an error
 * string, so callers observe contract-style errors instead of panics.
 *
 * @param {object} payload
 * @param {*} [payload.client]     Client address (Stellar G-address).
 * @param {*} [payload.freelancer] Freelancer address (Stellar G-address).
 * @param {*} [payload.token]      Escrow token contract address.
 * @param {*} [payload.amount]     Escrow amount (stroops / XLM units).
 * @returns {string|null} Error message when invalid; `null` when valid.
 */
function validateCreateEscrowPayload({
  client,
  freelancer,
  token,
  amount,
} = {}) {
  // 1) Amount — mirrors ContractError::AmountMustBePositive (2001).
  let numericAmount;
  if (typeof amount === "number" || typeof amount === "bigint") {
    numericAmount = Number(amount);
  } else if (typeof amount === "string" && amount.trim() !== "") {
    numericAmount = Number(amount.trim());
  } else {
    numericAmount = NaN;
  }
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return "Amount must be positive";
  }

  // 2) Participants — client and freelancer must be two distinct parties.
  if (!client || !freelancer || client === freelancer) {
    return "InvalidParticipants: client and freelancer must be distinct addresses";
  }

  // 3) Token — reject zero-address / malformed payloads BEFORE any transfer
  //    is built or executed. The format check runs against the canonical
  //    (trimmed) value; the zero-address set is matched case-insensitively.
  const trimmedToken = typeof token === "string" ? token.trim() : token;
  if (
    typeof trimmedToken !== "string" ||
    !TOKEN_CONTRACT_ADDRESS_PATTERN.test(trimmedToken) ||
    ZERO_TOKEN_ADDRESSES.has(trimmedToken.toLowerCase())
  ) {
    return "Invalid token address: must be a non-zero contract address";
  }

  return null;
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
               WHERE milestone->'status' <> 'released'
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

function validateMilestoneReleaseOrder(milestones, milestoneIndex) {
  for (let i = 0; i < milestoneIndex; i += 1) {
    if (milestones[i]?.status !== "released") {
      const e = new Error(
        `Milestone ${i + 1} must be released before milestone ${milestoneIndex + 1} can be released`,
      );
      e.status = 400;
      throw e;
    }
  }
}

/**
 * Resolve the on-chain escrow contract ID for a job.
 * Returns null when the job has no on-chain escrow registered.
 */
async function getEscrowContractId(jobId) {
  const { rows } = await pool.query(
    "SELECT contract_id FROM escrows WHERE job_id = $1",
    [jobId],
  );
  return rows[0]?.contract_id || null;
}

/**
 * Read the on-chain escrow state via the Soroban client.
 */
async function readOnChainEscrowState(contractId) {
  if (typeof sorobanClient.getEscrowState !== "function") {
    const e = new Error("sorobanClient.getEscrowState is not available");
    e.status = 501;
    throw e;
  }
  return sorobanClient.getEscrowState(contractId);
}

function normalizeStatus(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

/**
 * Cross-check the PostgreSQL copy of escrow state against the on-chain
 * Soroban escrow contract (Issue #850).
 *
 * Runs on sensitive transitions (release, refund, dispute open). When the
 * on-chain state disagrees with the DB or the requested transition is no
 * longer valid, a mismatch is recorded in the audit log, counted in
 * Prometheus metrics, and an error is thrown so the DB is not mutated.
 *
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {string} opts.action      - 'release' | 'refund' | 'dispute_open'
 * @param {string} [opts.clientAddress]
 * @param {string} [opt.txHash]
 * @param {string} [opts.expectedStatus] - DB status belief to be current
 * @param {number} [opts.expectedAmount]
 * @returns {object} { on-chain state }
 * @throws {Error} 409 when the on-chain state conflicts with the transition
 */
async function crossCheckEscrowState({
  jobId,
  action,
  clientAddress,
  txHash,
  expectedStatus,
  expectedAmount,
}) {
  const contractId = await getEscrowContractId(jobId);

  // No on-chain escrow registered for this job: nothing to reconcile.
  if (!contractId) {
    logger.debug(
      { jobId, action },
      'No on-chain escrow contract registered; skipping cross-check',
    );
    return { skipped: true, reason: "no_contract_id" };
  }

  let onChainState;
  try {
    onChainState = await readOnChainEscrowState(contractId);
  } catch (err) {
    // A failed read is itself a reconciliation failure: we cannot prove
    // the transition is safe, so we refuse to mutate the DB.
    await recordEscrowMismatch({
      jobId,
      action,
      contractId,
      clientAddress,
      txHash,
      reason: "read_failed",
      details: { message: err.message },
    });
    const e = new Error(
      `Unable to verify on-chain escrow state for job ${jobId}; refusing to ${action}`,
    );
    e.status = 502;
    e.code = "ESCROW_STATE_UNVERIFIED";
    throw e;
  }

  if (!onChainState || typeof onChainState !== "object") {
    await recordEscrowMismatch({
      jobId,
      action,
      contractId,
      clientAddress,
      txHash,
      reason: "empty_state",
      details: { onChainState },
    });
    const e = new Error(
      `On-chain escrow state for job ${jobId} is missing or malformed`
    );
    e.status = 502;
    e.code = "ESCROW_STATE_UNVERIFIED";
    throw e;
  }

  const onChainStatus = normalizeStatus(onChainState.status);
  const onStatusAmount = onChainState.amount != null
    ? parseFloat(onChainState.amount)
    : null;

  const mismatches = [];

 // 1) Status must match the DB copy (and the transition must be legal).
  const dbStatus = normalizeStatus(expectedStatus);
  if (dbStatus && onChainStatus !== dbStatus) {
    mismatches.push({
      field: "status",
      dbValue: dbStatus,
      onChainValue: onChainStatus,
    });
  }

  // 2) The requested transition must be legal given the on-chain status.
  //    Release/refund require the escrow to still be locked/in-progress.
  const actionRequiredStatuses = {
    release: ["locked", "in_progress", "funded"],
    refund: ["locked", "in_progress", "funded"],
    dispute_open: ["locked", "in_progress", "funded", "disputed"],
  };
  const allowed = actionRequiredStatuses[action];
  if (allowed && !allowed.includes(onChainStatus)) {
    mismatches.push({
      field: "transition",
      dbValue: action,
      onChainValue: onChainStatus,
    });
  }

  // 3) Amount must match the local escrow amount (when both are known).
  if (
    Number.isFinite(expectedAmount) &&
    expectedAmount > 0 &&
    Number.isFinite(onStatusAmount) &&
    Math.abs(onStatusAmount - expectedAmount) > 0.0000001
  ) {
    mismatches.push({
      field: "amount",
      dbValue: expectedAmount,
      onChainValue: onStatusAmount,
    });
  }

  if (mismatches.length > 0) {
    await recordEscrowMismatch({
      jobId,
      action,
      contractId,
      clientAddress,
      txHash,
      reason: "state_divergence",
      details: { mismatches, onChainState },
    });
    const e = new Error(
      `Escrow state desync detected for job ${jobId}; refusing to ${action}`,
    );
    e.status = 409;
    e.code = "ESCROW_STATE_DIVERGENCE";
    e.mismatches = mismatches;
    throw e;
  }

  return { skipped: false, onChainState, contractId };
}

/**
 * Persist a mismatch into the audit log and increment the Prometheus
 * counter so operators can alert on desync.
 */
async function recordEscrowMismatch({
  jobId,
  action,
  contractId,
  clientAddress,
  txHash,
  reason,
  details,
}) {
  const labels = {
    action: action || "unknown",
    reason: reason || "unknown",
  };

  try {
    if (metrics && typeof metrics.recordEscrowStateMismatch === "function") {
      metrics.recordEscrowStateMismatch(labels);
    } else if (metrics && metrics.escrowStateMismatchesTotal) {
      metrics.escrowStateMismatchesTotal.inc(labels);
    }
  } catch (err) {
    logger.warn({ err : err.message }, 'Failed to record escrow mismatch metric');
  }

  logger.err(
    {
      jobId,
      action,
      contractId,
      reason,
      details,
    },
    'Escrow on-chain/DB state mismatch detected (Issue #850)',
  );

  try {
    await logContractInteraction({
      functionName: "escrow_state_mismatch",
      callerAddress: clientAddress,
      jobId,
      txHash,
      eventData: {
        action,
        contractId,
        reason,
        details,
      },
    });
  } catch (err) {
    logger.warn(
      { err: err.message, jobId },
      'Failed to write escrow mismatch to audit log',
    );
  }

  try {
    await recordTimelineEvent(jobId, "escrow_state_mismatch", txHash || null);
  } catch (err) {
    logger.warn(
      { err: err.message, jobId },
      'Failed to record escrow_state_mismatch timeline event',
    );
  }
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

  const txInfo = await verifyOnChainTransaction(contractTxHash);
  const txHash = contractTxHash || `offchain-${Date.now()}`;

  const amountXlm = await getEscrowField(jobId, 'amount_xlm');

  // Issue #850: Validate that the escrow amount is consistent with the job.
  // The escrow amount should reflect the accepted bid, not necessarily the
  // original job budget.  Log a warning if the amounts diverge so operators
  // can investigate.
  const escrowAmountNum = parseFloat(amountXlm);
  if (isNaN(escrowAmountNum) || escrowAmountNum <= 0) {
    const e = new Error("Escrow amount is missing or invalid");
    e.status = 400;
    throw e;
  }

  // Warn if the escrow
  // amount exceeds the job budget (possible data inconsistency)
  const budgetNum = parseFloat(job.budget);
  if (!Number.isNaN(budgetNum) && escrowAmountNum > budgetNum + 0.0000001) {
    logger.warn(
      { jobId, escrowAmount: amountXlm, jobBudget: job.budget },
      'Escrow amount exceeds job budget — possible data inconsistency (Issue #850)',
    );
  }

  // Issue #850: verify the on-chain Soroban escrow state before mutating the
  // DB. A desync (missed indexer event, manual contract interaction) must
  // block the release rather than silently trusting the PostgreSQL copy.
  await crossCheckEscrowState({
    jobId,
    action: "release",
    clientAddress,
    txHash,
    expectedStatus: "in_progress",
    expectedAmount: escrowAmountNum,
  });

  await pool.query(
    `INSERT INTO escrow_releases (job_id, released_by, tx_hash, released_at, freelancer_id)
     VALUES ($1, $2, $3, NOW(), $4)`,
    [jobId, clientAddress, txHash, job.freelancerAddress || null],
  );

  logContractInteraction({
    functionName: "release_escrow",
    callerAddress: clientAddress,
    jobId,
    txHash,
    ledgerSequence: txInfo ? txInfo.ledgerSequence : undefined,
    feeCharged: txInfo ? txInfo.feeCharged : undefined,
    eventData: txInfo ? txInfo.eventData : undefined,
  });

  // Record timeline event with on-chain tx hash (Issue #876)
  try {
    await recordTimelineEvent(jobId, "escrow_released", contractTxHash || null);
  } catch (err) {
    console.error("[timeline] Failed to record escrow_released event:", err.message);
  }

  // Invalidate platform insights cache so totals reflect this release (#1512)
  try {
    await insightsService.invalidateCache();
  } catch (err) {
    console.warn("[insights] cache invalidation failed:", err.message);
  }

  await notifyEscrowEvent({
    eventType: EVENT_TYPES.ESCROW_RELEASED,
    jobId,
    clientAddress: job.clientAddress,
    freelancerAddress: job.freelancerAddress,
    data: {
      jobTitle: job.title,
      jobId,
      amount: amountXlm,
      currency: job.currency,
    },
  });

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

  const txInfo = await verifyOnChainTransaction(contractTxHash);
  const txHash = contractTxHash || `offchain-${Date.now()}`;

  const amountXlm = await getEscrowField(jobId, 'amount_xlm');
  const escrowAmountNum = parseFloat(amountXlm);

  // Issue #850: verify the on-chain Soroban escrow state before mutating the
  // DB. A desync must block the refund rather than silently trusting the
  // PostgreSQL copy.
  await crossCheckEscrowState({
    jobId,
    action: "refund",
    clientAddress,
    txHash,
    expectedStatus: job.status,
    expectedAmount: Number.isFinite(escrowAmountNum) ? escrowAmountNum : undefined,
  });

  await pool.query(
    `INSERT INTO escrow_releases (job_id, released_by, tx_hash, released_at, freelancer_id)
     VALUES ($1, $2, $3, NOW(), $4)`,
    [jobId, clientAddress, txHash, null],
  );

  logContractInteraction({
    functionName: "refund_escrow",
    callerAddress: clientAddress,
    jobId,
    txHash,
    ledgerSequence: txInfo ? txInfo.ledgerSequence : undefined,
    feeCharged: txInfo ? txInfo.feeCharged : undefined,
    eventData: txInfo ? txInfo.eventData : undefined,
  });

  try {
    await recordTimelineEvent(jobId, "escrow_refunded", contractTxHash || null);
  } catch (err) {
    console.error("[timeline] Failed to record escrow_refunded event:", err.message);
  }

  try {
    await insightsService.invalidateCache();
  } catch (err) {
    console.warn("[insights] cache invalidation failed:", err.message);
  }

  await notifyEscrowEvent({
    eventType: EVENT_TYPES.ESCROW_REFUNDED,
    jobId,
    clientAddress: job.clientAddress,
    freelancerAddress: job.freelancerAddress,
    data: {
      jobTitle: job.title,
      jobId,
      amount: amountXll,
      currency: job.currency,
    },
  });

  return {
    success: true,
    message: "Escrow refunded to client",
  };
}

/**
 * Open a dispute on an escrow. Verifies the on-chain escrow state before
 * mutating the DB ( Issue #850).
 */
async function openDispute(jobId, clientAddress, reason, contractTxHash) {
  const job = await getJob(jobId);
  if (!job) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const txHash = contractTxHash || `offchain-${Date.now()}`;
  const amountXlm = await getEscrowField(jobId, 'amount_xlm');
  const escrowAmountNum = parseFloat(amountXlm);

  // Issue #850: verify the on-chain Soroban escrow state before mutating the
  // DB. A desync must block the dispute open rather than silently trusting
  // the PostgreSQL copy.
  await crossCheckEscrowState({
    jobId,
    action: "dispute_open",
    clientAddress,
    txHash,
    expectedStatus: job.status,
    expectedAmount: Number.isFinite(escrowAmountNum) ? escrowAmountNum : undefined,
  });

  await pool.query(
    `UPDATE jobs SET status = 'disputed', updated_at = NOW() WHERE id = $1`,
    [jobId],
  );

  await pool.query(
    `INSERT INTO disputes (job_id, opened_by, reason, tx_hash, opened_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [jobId, clientAddress, reason || null, txHash],
  );

  logContractInteraction({
    functionName: "open_dispute",
    callerAddress: clientAddress,
    jobId,
    txHash,
  });

  try {
    await recordTimelineEvent(jobId, "dispute_opened", contractTxHash || null);
  } catch (err) {
    console.error("[timeline] Failed to record dispute_opened event:", err.message);
  }

  await notifyEscrowEvent({
    eventType: EVENT_TYPES.ESCROW_DISPUTED,
    jobId,
    clientAddress: job.clientAddress,
    freelancerAddress: job.freelancerAddress,
    data: {
      jobTitle: job.title,
      jobId,
      reason: reason || null,
      amount: amountXlm,
      currency: job.currency,
    },
  });

  return {
    success: true,
    message: "Dispute opened",
  };
}

async function getEscrowField(jobId, field) {
  const allowed = new Set(["amount_xlm", "contract_id", "status"]);
  if (!allowed.has(field)) {
    throw new Error(`Invalid escrow field: ${field}`);
  }
  const { rows } = await pool.query(
    `SELECT ${field} FROM escrows WHERE job_id = $1`,
    [jobId],
  );
  return rows[0]?.[field] ?? null;
}

module.exports = {
  ESCROW_TIMEOUT_DAYS,
  getEscrowTimeoutCheckDelay,
  verifyFreelancerAccount,
  normalizeMilestones,
  validateCreateEscrowPayload,
  getMilestonesForJob,
  persistMilestones,
  validateMilestoneIndex,
  validateMilestoneReleaseOrder,
  crossCheckEscrowState,
  recordEscrowMismatch,
  releaseFunds,
  refundClient,
  openDispute,
};
