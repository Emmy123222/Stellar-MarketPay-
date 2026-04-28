"use strict";

const pool = require("../db/pool");

const TRACKED_CONTRACT_FUNCTIONS = new Set([
  "create_escrow",
  "start_work",
  "release_escrow",
  "release_with_conversion",
  "refund_escrow",
]);

async function logContractInteraction({ functionName, callerAddress, jobId, txHash }) {
  if (!TRACKED_CONTRACT_FUNCTIONS.has(functionName)) return null;
  if (!callerAddress || !txHash) return null;

  const { rows } = await pool.query(
    `INSERT INTO contract_audit_log (function_name, caller_address, job_id, tx_hash, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [functionName, callerAddress, jobId || null, txHash]
  );
  return rows[0];
}

async function getAuditLogsForJob(jobId) {
  const { rows } = await pool.query(
    `SELECT id, function_name, caller_address, job_id, tx_hash, created_at
     FROM contract_audit_log
     WHERE job_id = $1
     ORDER BY created_at DESC`,
    [jobId]
  );
  return rows;
}

module.exports = {
  TRACKED_CONTRACT_FUNCTIONS,
  logContractInteraction,
  getAuditLogsForJob,
};
