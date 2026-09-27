"use strict";

const { auditQueue } = require("../utils/queue");
const pool = require("../db/pool");
const { createServiceLogger, logError } = require("../utils/logger");

const auditLogger = createServiceLogger("audit-worker");

/**
 * Job types:
 *   - "audit_log"          → INSERT INTO audit_logs
 *   - "contract_audit_log" → INSERT INTO contract_audit_log
 */
auditQueue.process(10, async (job) => {
  const { type, payload } = job.data;

  if (type === "audit_log") {
    const { actorAddress, action, target, reason, metadata } = payload;
    await pool.query(
      `INSERT INTO audit_logs (actor_address, action, target, reason, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [actorAddress, action, target ?? null, reason ?? null, JSON.stringify(metadata ?? {})]
    );
    return;
  }

  if (type === "contract_audit_log") {
    const { functionName, callerAddress, jobId, txHash, ledgerSequence, feeCharged, eventData } = payload;
    const eventDataJson = eventData != null ? JSON.stringify(eventData) : null;
    await pool.query(
      `INSERT INTO contract_audit_log
         (function_name, caller_address, job_id, tx_hash,
          ledger_sequence, fee_charged, event_data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [functionName, callerAddress, jobId ?? null, txHash,
       ledgerSequence ?? null, feeCharged ?? null, eventDataJson]
    );
    return;
  }

  if (type === "admin_audit_log") {
    const { adminAddress, action, targetType, targetId, details } = payload;
    await pool.query(
      `INSERT INTO admin_audit_log (admin_address, action, target_type, target_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [adminAddress, action, targetType, targetId ?? null, JSON.stringify(details ?? {})]
    );
    return;
  }

  auditLogger.warn({ type }, "auditWorker received unknown job type");
});

auditQueue.on("failed", (job, err) => {
  logError(auditLogger, err, { jobId: job.id, type: job.data?.type, operation: "audit_queue_job_failed" });
});

auditLogger.info("Audit worker started");

module.exports = { auditQueue };
