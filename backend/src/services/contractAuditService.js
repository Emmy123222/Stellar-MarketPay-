"use strict";

const pool = require("../db/pool");
const { auditQueue } = require("../utils/queue");

function getHorizonUrl() {
  return process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
}

const TRACKED_CONTRACT_FUNCTIONS = new Set([
  "create_escrow",
  "start_work",
  "release_escrow",
  "release_with_conversion",
  "refund_escrow",
  "submit_deliverable_hash",
  "verify_deliverable_hash",
  "create_recurring_escrow",
  "release_recurring_escrow",
  "cancel_recurring_escrow",
]);

function isOffChainHash(txHash) {
  return !txHash || txHash.startsWith("offchain-") || txHash.startsWith("admin-");
}

async function verifyOnChainTransaction(txHash) {
  if (isOffChainHash(txHash)) {
    return null;
  }

  let response;
  try {
    response = await fetch(
      `${getHorizonUrl()}/transactions/${encodeURIComponent(txHash)}`,
    );
  } catch (err) {
    const e = new Error(`Failed to query Stellar Horizon: ${err.message}`);
    e.status = 502;
    throw e;
  }

  if (!response.ok) {
    if (response.status === 404) {
      const e = new Error("Transaction not found on Stellar network");
      e.status = 502;
      throw e;
    }
    const body = await response.text();
    const e = new Error(`Horizon request failed: ${response.status} ${body}`);
    e.status = 502;
    throw e;
  }

  const tx = await response.json();

  if (!tx.successful) {
    const e = new Error("Transaction failed on Stellar network");
    e.status = 502;
    throw e;
  }

  return {
    ledgerSequence: tx.ledger,
    feeCharged: tx.fee_charged,
    eventData: parseSorobanEvents(tx),
  };
}

function parseSorobanEvents(tx) {
  if (!tx.soroban || !Array.isArray(tx.soroban.events)) {
    return [];
  }
  return tx.soroban.events.map((event) => ({
    type: event.type,
    contract_id: event.contract_id,
    topics: event.topic || [],
    data: event.data || {},
  }));
}

/**
 * Enqueue a contract audit log entry without blocking the caller.
 * Preserves the enriched signature (ledgerSequence, feeCharged, eventData)
 * added upstream. Failed writes are logged by the audit worker and never
 * propagate back to the caller.
 */
function logContractInteraction({
  functionName,
  callerAddress,
  jobId,
  txHash,
  ledgerSequence,
  feeCharged,
  eventData,
}) {
  if (!TRACKED_CONTRACT_FUNCTIONS.has(functionName)) return;
  if (!callerAddress || !txHash) return;

  auditQueue
    .add({
      type: "contract_audit_log",
      payload: {
        functionName,
        callerAddress,
        jobId: jobId || null,
        txHash,
        ledgerSequence: ledgerSequence || null,
        feeCharged: feeCharged || null,
        eventData: eventData != null ? eventData : null,
      },
    })
    .catch(() => {});
}

async function verifyAndLogContractInteraction(params) {
  const txInfo = await verifyOnChainTransaction(params.txHash);

  return logContractInteraction({
    ...params,
    ledgerSequence: txInfo ? txInfo.ledgerSequence : undefined,
    feeCharged: txInfo ? txInfo.feeCharged : undefined,
    eventData: txInfo ? txInfo.eventData : undefined,
  });
}

async function getAuditLogsForJob(jobId) {
  const { rows } = await pool.query(
    `SELECT id, function_name, caller_address, job_id, tx_hash,
            ledger_sequence, fee_charged, event_data, success, created_at
     FROM contract_audit_log
     WHERE job_id = $1
     ORDER BY created_at DESC`,
    [jobId],
  );
  return rows;
}

module.exports = {
  TRACKED_CONTRACT_FUNCTIONS,
  verifyOnChainTransaction,
  parseSorobanEvents,
  logContractInteraction,
  verifyAndLogContractInteraction,
  getAuditLogsForJob,
};
