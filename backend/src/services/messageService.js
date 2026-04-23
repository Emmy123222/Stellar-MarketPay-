/**
 * src/services/messageService.js
 * Business logic for private messaging between job participants.
 */

"use strict";

const pool = require("../db/pool");

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
 * Create a new message.
 * Validates:
 * - Job exists and user is a participant (client or freelancer)
 * - Message content is non-empty and within length limits
 * - Sender is either client or freelancer of the job
 */
async function createMessage({ jobId, senderAddress, content }) {
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

    // Insert message
    const { rows: messageRows } = await client.query(
      `INSERT INTO messages (job_id, sender_address, receiver_address, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [jobId, senderAddress, receiverAddress, trimmedContent]
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
 * Only job participants (client or freelancer) can view messages.
 * Only allowed for in-progress jobs.
 * Marks messages as read for the current user.
 */
async function getMessagesByJob(jobId, userAddress) {
  // Verify user is participant and fetch job details
  const job = await verifyJobParticipant(jobId, userAddress);

  // Only allow viewing messages on in-progress jobs
  if (job.status !== "in_progress") {
    const e = new Error("Messaging is only allowed for in-progress jobs");
    e.status = 403;
    throw e;
  }

  // Fetch all messages for this job, newest last
  const { rows } = await pool.query(
    `SELECT * FROM messages
     WHERE job_id = $1
     ORDER BY created_at ASC`,
    [jobId]
  );

  // Mark messages where receiver = userAddress and read = false as read
  await pool.query(
    `UPDATE messages
     SET read = TRUE
     WHERE job_id = $1
       AND receiver_address = $2
       AND read = FALSE`,
    [jobId, userAddress]
  );

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

module.exports = {
  createMessage,
  getMessagesByJob,
  markMessagesAsRead,
  getUnreadCount,
  verifyJobParticipant,
};
