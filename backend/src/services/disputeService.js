"use strict";

const pool = require("../db/pool");
const ipfsService = require("./ipfsService");
const sorobanArbitratorRegistry = require("./sorobanArbitratorRegistry");
const sorobanEvidence = require("./sorobanEvidence");
const { scheduleReputationRecalcForJob } = require("./reputationService");

const MAX_EVIDENCE_FILES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const IPFS_CID_PATTERN = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{55})$/;

// Issue #1429 — dispute timeline event types. Stored in dispute_events and
// rendered chronologically by the frontend DisputeTimeline component.
const DISPUTE_EVENT_TYPES = ["opened", "evidence_submitted", "arbitrator_assigned", "resolved"];

/**
 * Append an event to a dispute's timeline (Issue #1429).
 *
 * Best-effort and non-fatal: a failed insert must never break the operation
 * that produced the event (creating a dispute, uploading evidence, ...), so
 * every error is logged and swallowed. `actorAddress` is required — without
 * it there is no meaningful "actor" to display — but the caller decides
 * whether a missing actor is worth logging.
 *
 * @param {string} jobId        UUID of the job the dispute belongs to.
 * @param {"opened"|"evidence_submitted"|"arbitrator_assigned"|"resolved"} eventType
 * @param {string|null} actorAddress Stellar public key of the acting party.
 * @param {{ evidenceId?: string|null, payload?: object }} [detail]
 * @returns {Promise<void>}
 */
async function recordDisputeEvent(jobId, eventType, actorAddress, detail = {}) {
  try {
    if (!jobId || !DISPUTE_EVENT_TYPES.includes(eventType) || !actorAddress) {
      return;
    }
    await pool.query(
      `INSERT INTO dispute_events (job_id, event_type, actor_address, evidence_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        jobId,
        eventType,
        actorAddress,
        detail.evidenceId || null,
        JSON.stringify(detail.payload || {}),
      ],
    );
  } catch (err) {
    console.error("[disputeService] failed to record dispute event:", err.message);
  }
}

/**
 * Read a dispute's full event history in chronological order (Issue #1429).
 *
 * Events that reference an evidence file (evidence_submitted) include the
 * evidence metadata so the timeline can render the attachment without a
 * second round-trip.
 *
 * @param {string} jobId UUID of the job.
 * @returns {Promise<Array<{id: string, jobId: string, eventType: string,
 *   actorAddress: string, evidenceId: string|null, payload: object,
 *   evidence: {id: string, fileName: string, mimeType: string, gatewayUrl: string}|null,
 *   createdAt: string}>>}
 */
async function getDisputeEvents(jobId) {
  const { rows } = await pool.query(
    `SELECT de.id, de.job_id, de.event_type, de.actor_address, de.evidence_id,
            de.payload, de.created_at,
            ev.file_name, ev.mime_type, ev.ipfs_cid
     FROM dispute_events de
     LEFT JOIN dispute_evidence ev ON ev.id = de.evidence_id
     WHERE de.job_id = $1
     ORDER BY de.created_at ASC, de.id ASC`,
    [jobId],
  );

  return rows.map((row) => ({
    id:           row.id,
    jobId:        row.job_id,
    eventType:    row.event_type,
    actorAddress: row.actor_address,
    evidenceId:   row.evidence_id || null,
    payload:      row.payload || {},
    evidence: row.evidence_id
      ? {
          id:         row.evidence_id,
          fileName:   row.file_name,
          mimeType:   row.mime_type,
          gatewayUrl: ipfsService.getGatewayUrl(row.ipfs_cid),
        }
      : null,
    createdAt:    row.created_at,
  }));
}

function validateIpfsCid(cid) {
  if (typeof cid !== "string" || !IPFS_CID_PATTERN.test(cid)) {
    const e = new Error("Invalid IPFS CID returned from upload service");
    e.status = 422;
    throw e;
  }

  return cid;
}

async function createDispute(jobId, raisedBy) {
  if (!jobId || !raisedBy) {
    const e = new Error("Job ID and raisedBy are required");
    e.status = 400;
    throw e;
  }

  const { rows: jobRows } = await pool.query(
    "SELECT client_address, freelancer_address FROM jobs WHERE id = $1",
    [jobId],
  );

  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const job = jobRows[0];
  if (job.client_address !== raisedBy && job.freelancer_address !== raisedBy) {
    const e = new Error("Only the job client or freelancer can raise a dispute");
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

  const { rows } = await pool.query(
    `INSERT INTO disputes (job_id, raised_by, status, created_at)
     VALUES ($1, $2, 'open', NOW())
     RETURNING *`,
    [jobId, raisedBy],
  );

  // Issue #1429 — the first timeline entry: the dispute was opened.
  await recordDisputeEvent(jobId, "opened", raisedBy, {
    payload: { disputeId: rows[0]?.id },
  });

  return { success: true, dispute: rows[0] };
}

async function uploadEvidence(jobId, uploaderAddress, fileBuffer, fileName, mimeType) {
  if (!jobId || !uploaderAddress) {
    const e = new Error("Job ID and uploader address are required");
    e.status = 400;
    throw e;
  }

  const { rows: jobRows } = await pool.query(
    "SELECT client_address, freelancer_address, status FROM jobs WHERE id = $1",
    [jobId],
  );

  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const job = jobRows[0];
  if (job.client_address !== uploaderAddress && job.freelancer_address !== uploaderAddress) {
    const e = new Error("Only the client or freelancer can upload evidence");
    e.status = 403;
    throw e;
  }

  const { rows: disputeRows } = await pool.query(
    "SELECT id, status FROM disputes WHERE job_id = $1",
    [jobId],
  );

  if (!disputeRows.length) {
    const e = new Error("No dispute exists for this job. Create a dispute first.");
    e.status = 400;
    throw e;
  }

  if (disputeRows[0].status !== "open") {
    const e = new Error("Cannot upload evidence after dispute has been resolved");
    e.status = 400;
    throw e;
  }

  const { rows: countRows } = await pool.query(
    "SELECT COUNT(*) FROM dispute_evidence WHERE job_id = $1 AND uploader_address = $2",
    [jobId, uploaderAddress],
  );

  if (parseInt(countRows[0].count, 10) >= MAX_EVIDENCE_FILES) {
    const e = new Error(`Maximum ${MAX_EVIDENCE_FILES} files allowed per party`);
    e.status = 400;
    throw e;
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    const e = new Error("File size exceeds 5MB limit");
    e.status = 400;
    throw e;
  }

  const ipfsResult = await ipfsService.uploadFile(fileBuffer, fileName, mimeType);
  const ipfsCid = validateIpfsCid(ipfsResult?.cid);

  // Issue #1439 — AC #3: persist whether the pin was confirmed. uploadFile
  // performs the verification (with retries) and reports it as `pinned`;
  // anything other than an explicit true is recorded as false.
  const pinned = ipfsResult?.pinned === true;

  const { rows } = await pool.query(
    `INSERT INTO dispute_evidence
       (job_id, uploader_address, file_name, file_size, mime_type, ipfs_cid, pinned)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [jobId, uploaderAddress, fileName, fileBuffer.length, mimeType, ipfsCid, pinned],
  );

  const ev = rows[0];

  // Issue #448 — AC #4: disputeService.js calls submit_evidence_cid after the
  // Pinata upload so the CID is anchored on-chain at DataKey::EvidenceCids.
  // On-chain anchoring is best-effort: if the contract isn't deployed, env
  // vars are missing, or network is unreachable, we still return the
  // off-chain evidence record — the chain audit trail is supplementary.
  const chainAnchor = await sorobanEvidence.recordEvidenceCidOnChain({
    jobId,
    cid: ipfsCid,
    callerAddress: uploaderAddress,
  });

  // Issue #1429 — timeline entry with the evidence attached so the
  // DisputeTimeline can render a link to the file next to the event.
  await recordDisputeEvent(jobId, "evidence_submitted", uploaderAddress, {
    evidenceId: ev.id,
    payload: {
      fileName: ev.file_name,
      ipfsCid: ev.ipfs_cid,
    },
  });

  return {
    success: true,
    data: {
      id: ev.id,
      uploaderAddress: ev.uploader_address,
      fileName: ev.file_name,
      fileSize: ev.file_size,
      mimeType: ev.mime_type,
      ipfsCid: ev.ipfs_cid,
      pinned: ev.pinned === true,
      gatewayUrl: ipfsService.getGatewayUrl(ev.ipfs_cid),
      createdAt: ev.created_at,
      // AC #4 surface — frontend signs the returned XDR and POSTs the tx
      // hash back via /api/disputes/:jobId/evidence/:id/tx-hash.
      chainAnchor,
    },
  };
}

async function resolveDispute(jobId, resolvedBy, resolution) {
  if (!jobId || !resolvedBy || !resolution) {
    const e = new Error("Job ID, resolver, and resolution are required");
    e.status = 400;
    throw e;
  }

  if (!["release_funds", "refund_client"].includes(resolution)) {
    const e = new Error("Resolution must be 'release_funds' or 'refund_client'");
    e.status = 400;
    throw e;
  }

  const { rows: adminRows } = await pool.query(
    "SELECT id FROM admin_profiles WHERE id = $1",
    [resolvedBy],
  );
  const isAdmin = adminRows.length > 0;
  const isChainArbitrator = !isAdmin && await sorobanArbitratorRegistry.isArbitrator(resolvedBy);
  if (!isAdmin && !isChainArbitrator) {
    const err = new Error("Only an admin or on-chain arbitrator can resolve disputes");
    err.statusCode = 403;
    throw err;
  }

  const { rows: disputeRows } = await pool.query(
    "SELECT id, status FROM disputes WHERE job_id = $1",
    [jobId],
  );

  if (!disputeRows.length) {
    const e = new Error("No dispute found for this job");
    e.status = 404;
    throw e;
  }

  if (disputeRows[0].status !== "open") {
    const e = new Error("Dispute has already been resolved");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `UPDATE disputes
     SET status = 'resolved', resolved_by = $2, resolution = $3, resolved_at = NOW()
     WHERE job_id = $1
     RETURNING *`,
    [jobId, resolvedBy, resolution],
  );

  if (resolution === "release_funds") {
    await pool.query(
      "UPDATE escrows SET status = 'released' WHERE job_id = $1",
      [jobId],
    );
  } else {
    await pool.query(
      "UPDATE escrows SET status = 'refunded' WHERE job_id = $1",
      [jobId],
    );
  }

  // Issue #1429 — final timeline entry: the ruling.
  await recordDisputeEvent(jobId, "resolved", resolvedBy, {
    payload: { resolution },
  });

  // Issue #1561: dispute outcomes feed both parties' reputation scores.
  scheduleReputationRecalcForJob(jobId);

  return { success: true, dispute: rows[0] };
}

async function getDispute(jobId) {
  if (!jobId) {
    const e = new Error("Job ID is required");
    e.status = 400;
    throw e;
  }

  const { rows: jobRows } = await pool.query(
    `SELECT id, title, status, client_address, freelancer_address, created_at
     FROM jobs WHERE id = $1`,
    [jobId],
  );

  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const { rows: evidence } = await pool.query(
    `SELECT id, uploader_address, file_name, file_size, mime_type, ipfs_cid, pinned, created_at
     FROM dispute_evidence
     WHERE job_id = $1
     ORDER BY created_at ASC`,
    [jobId],
  );

  return {
    success: true,
    data: {
      job: jobRows[0],
      evidence: evidence.map((ev) => ({
        id: ev.id,
        uploaderAddress: ev.uploader_address,
        fileName: ev.file_name,
        fileSize: ev.file_size,
        mimeType: ev.mime_type,
        ipfsCid: ev.ipfs_cid,
        pinned: ev.pinned === true,
        gatewayUrl: ipfsService.getGatewayUrl(ev.ipfs_cid),
        createdAt: ev.created_at,
      })),
    },
  };
}

module.exports = {
  createDispute,
  uploadEvidence,
  resolveDispute,
  getDispute,
  recordDisputeEvent,
  getDisputeEvents,
  DISPUTE_EVENT_TYPES,
  MAX_EVIDENCE_FILES,
  MAX_FILE_SIZE,
  validateIpfsCid,
};
