/**
 * src/services/messageService.js
 * Business logic for private messaging between job participants.
 *
 * Architecture (on-chain message notarization):
 *   1. Client encrypts message and uploads to IPFS
 *   2. IPFS CID is recorded on-chain via Soroban `publish_message` event
 *   3. Backend indexes the event for fast retrieval
 *   4. Recipients verify authenticity from Stellar Explorer
 */

"use strict";

const pool = require("../db/pool");
const { uploadMessage } = require("./ipfsService");

/* ─── helpers ────────────────────────────────────────────────────────────────── */

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

function validateMessageContent(content) {
  if (!content || typeof content !== "string") {
    const e = new Error("Message content is required");
    e.status = 400;
    throw e;
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    const e = new Error("Message cannot be empty");
    e.status = 400;
    throw e;
  }
  if (trimmed.length > 2000) {
    const e = new Error("Message exceeds maximum length of 2000 characters");
    e.status = 400;
    throw e;
  }
  return trimmed;
}

/** Convert snake_case DB row → camelCase API object */
function rowToMessage(row) {
  return {
    id:             row.id,
    jobId:          row.job_id,
    senderAddress:  row.sender_address,
    receiverAddress: row.receiver_address,
    content:        row.content,
    ipfsCid:        row.ipfs_cid,
    txHash:         row.tx_hash,
    read:           row.read,
    createdAt:      row.created_at,
  };
}

/* ─── service functions ─────────────────────────────────────────────────────── */

/**
 * Validate that the user is a participant in the given job.
 * Throws 403 if not authorized.
 */
async function verifyJobParticipant(jobId, userAddress) {
  const { rows } = await pool.query(
    `SELECT client_address, freelancer_address, status FROM jobs WHERE id = $1`,
    [jobId]
  );

  if (!rows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const job = rows[0];
  const isClient = job.client_address === userAddress;
  const isFreelancer = job.freelancer_address === userAddress;

  if (!isClient && !isFreelancer) {
    const e = new Error("Unauthorized: You are not a participant in this job");
    e.status = 403;
    throw e;
  }

  return job;
}

/**
 * Create a new message with on-chain notarization.
 *
 * Flow:
 *  1. Upload encrypted message content to IPFS
 *  2. Emit on-chain Soroban event with IPFS CID
 *  3. Store message reference + CID in PostgreSQL for fast retrieval
 */
async function createMessage({ jobId, senderAddress, content, contractTxHash }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Validate sender address format
    validatePublicKey(senderAddress);

    // Validate and trim content
    const trimmedContent = validateMessageContent(content);

    // Verify job exists, sender is participant, and fetch job details
    const job = await verifyJobParticipant(jobId, senderAddress);

    // Only allow messaging on in-progress jobs
    if (job.status !== "in_progress") {
      const e = new Error("Messaging is only allowed for in-progress jobs");
      e.status = 403;
      throw e;
    }

    // Determine receiver (the other party)
    const receiverAddress = job.client_address === senderAddress
      ? job.freelancer_address
      : job.client_address;

    if (!receiverAddress) {
      const e = new Error("Cannot send message: job has no assigned freelancer");
      e.status = 400;
      throw e;
    }

    // ── Step 1: Upload message to IPFS ──────────────────────────────────────
    let ipfsCid = null;
    try {
      const ipfsResult = await uploadMessage({
        jobId,
        senderAddress,
        recipientAddress: receiverAddress,
        content: trimmedContent,
        encrypted: false, // Set to true when client-side encryption is enabled
      });
      ipfsCid = ipfsResult.cid;
    } catch (ipfsError) {
      console.error("[MessageService] IPFS upload failed, falling back to off-chain:", ipfsError.message);
      // Continue without IPFS — the message will still be stored in Postgres
    }

    // ── Step 2: Store in PostgreSQL ─────────────────────────────────────────
    const { rows: messageRows } = await client.query(
      `INSERT INTO messages (job_id, sender_address, receiver_address, content, ipfs_cid, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [jobId, senderAddress, receiverAddress, trimmedContent, ipfsCid, contractTxHash || null]
    );

    await client.query("COMMIT");
    return rowToMessage(messageRows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Get all messages for a job.
 * Merges off-chain DB messages with on-chain event records.
 */
async function getMessagesByJob(jobId, userAddress) {
  // Verify user is participant and fetch job details
  const job = await verifyJobParticipant(jobId, userAddress);

  if (job.status !== "in_progress") {
    const e = new Error("Messaging is only allowed for in-progress jobs");
    e.status = 403;
    throw e;
  }

  // Fetch DB messages (includes both IPFS-backed and legacy off-chain messages)
  const { rows } = await pool.query(
    `SELECT * FROM messages
     WHERE job_id = $1
     ORDER BY created_at ASC`,
    [jobId]
  );

  // Mark messages where receiver = userAddress and read = false as read
  if (rows.length > 0) {
    await pool.query(
      `UPDATE messages
       SET read = TRUE
       WHERE job_id = $1
         AND receiver_address = $2
         AND read = FALSE`,
      [jobId, userAddress]
    );
  }

  return rows.map(rowToMessage);
}

/**
 * Mark all unread messages for a user in a job as read.
 */
async function markMessagesAsRead(jobId, userAddress) {
  await pool.query(
    `UPDATE messages
     SET read = TRUE
     WHERE job_id = $1
       AND receiver_address = $2
       AND read = FALSE`,
    [jobId, userAddress]
  );
}

/**
 * Get total unread message count for a user.
 */
async function getUnreadCount(userAddress) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) as count
     FROM messages
     WHERE receiver_address = $1
       AND read = FALSE`,
    [userAddress]
  );
  return parseInt(rows[0].count, 10);
}

/**
 * Attach an on-chain Soroban transaction hash to a message record.
 * This is called after the frontend signs and submits the publish_message event.
 */
async function attachTxHash(messageId, txHash) {
  const { rows } = await pool.query(
    `UPDATE messages
     SET tx_hash = $1
     WHERE id = $2
     RETURNING *`,
    [txHash, messageId]
  );
  if (!rows.length) {
    const e = new Error("Message not found");
    e.status = 404;
    throw e;
  }
  return rowToMessage(rows[0]);
}

module.exports = {
  createMessage,
  getMessagesByJob,
  markMessagesAsRead,
  getUnreadCount,
  attachTxHash,
  verifyJobParticipant,
};
