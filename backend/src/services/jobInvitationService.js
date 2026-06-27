/**
 * src/services/jobInvitationService.js
 * Issue #342 — Job invitation with in-app notification, email, and message.
 */
"use strict";

const pool = require("../db/pool");
const { queueNotification, EVENT_TYPES } = require("./notificationService");

function validatePublicKey(key) {
  return Boolean(key && /^G[A-Z0-9]{55}$/.test(key));
}

/**
 * Invite a freelancer to a job.
 * Also queues an in-app notification and sends a pre-populated message
 * in the job's notification queue.
 *
 * @param {Object} params
 * @param {string} params.jobId
 * @param {string} params.clientAddress
 * @param {string} params.freelancerAddress
 * @returns {Promise<Object>} The created/updated invitation row.
 */
async function inviteFreelancerToJob({ jobId, clientAddress, freelancerAddress }) {
  if (!validatePublicKey(clientAddress) || !validatePublicKey(freelancerAddress)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }

  const { rows: jobRows } = await pool.query(
    "SELECT id, title, budget, currency, client_address, visibility FROM jobs WHERE id = $1",
    [jobId]
  );
  if (!jobRows.length) {
    const e = new Error("Job not found");
    e.status = 404;
    throw e;
  }

  const job = jobRows[0];
  if (job.client_address !== clientAddress) {
    const e = new Error("Only the job client can invite freelancers");
    e.status = 403;
    throw e;
  }
  if (job.visibility !== "invite_only") {
    const e = new Error("Invitations are only available for invite-only jobs");
    e.status = 400;
    throw e;
  }

  // Upsert invitation
  const { rows } = await pool.query(
    `INSERT INTO job_invitations (job_id, client_address, freelancer_address, status, created_at)
     VALUES ($1, $2, $3, 'pending', NOW())
     ON CONFLICT (job_id, freelancer_address)
     DO UPDATE SET status = 'pending', created_at = NOW()
     RETURNING *`,
    [jobId, clientAddress, freelancerAddress]
  );
  const invitation = rows[0];

  // Fetch client display name for the message template
  const { rows: profileRows } = await pool.query(
    "SELECT display_name FROM profiles WHERE public_key = $1",
    [clientAddress]
  );
  const clientName = profileRows[0]?.display_name || clientAddress.slice(0, 8) + "…";

  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const jobUrl = `${baseUrl}/jobs/${jobId}`;

  // Queue email notification to freelancer
  await queueNotification({
    recipientAddress: freelancerAddress,
    notificationType: "email",
    eventType: EVENT_TYPES.JOB_INVITED,
    jobId,
    payload: {
      jobTitle: job.title,
      jobId,
      amount: job.budget,
      currency: job.currency,
      clientName,
      jobUrl,
    },
  });

  // Queue webhook notification to freelancer
  await queueNotification({
    recipientAddress: freelancerAddress,
    notificationType: "webhook",
    eventType: EVENT_TYPES.JOB_INVITED,
    jobId,
    payload: {
      jobTitle: job.title,
      jobId,
      amount: job.budget,
      currency: job.currency,
      clientName,
    },
  });

  // Insert an in-app notification record for the freelancer
  // (stored in notification_queue with type 'in_app' so the dashboard can poll it)
  await queueNotification({
    recipientAddress: freelancerAddress,
    notificationType: "in_app",
    eventType: EVENT_TYPES.JOB_INVITED,
    jobId,
    payload: {
      jobTitle: job.title,
      jobId,
      amount: job.budget,
      currency: job.currency,
      clientName,
      message: `Hi! ${clientName} has invited you to apply to their job: "${job.title}" — ${job.budget} ${job.currency}. View Job: ${jobUrl}`,
    },
  });

  console.log(`[invitations] Queued invitation notifications for job ${jobId} → ${freelancerAddress}`);

  return invitation;
}

/**
 * Get all pending invitations for a freelancer.
 *
 * @param {string} freelancerAddress
 * @returns {Promise<Object[]>}
 */
async function getInvitationsForFreelancer(freelancerAddress) {
  if (!validatePublicKey(freelancerAddress)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `SELECT ji.id, ji.job_id, ji.client_address, ji.freelancer_address, ji.status, ji.created_at,
            j.title AS job_title, j.budget AS job_budget, j.currency AS job_currency,
            p.display_name AS client_name
     FROM job_invitations ji
     JOIN jobs j ON j.id = ji.job_id
     LEFT JOIN profiles p ON p.public_key = ji.client_address
     WHERE ji.freelancer_address = $1
       AND ji.status = 'pending'
     ORDER BY ji.created_at DESC`,
    [freelancerAddress]
  );

  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    jobTitle: r.job_title,
    jobBudget: r.job_budget,
    jobCurrency: r.job_currency,
    clientAddress: r.client_address,
    clientName: r.client_name,
    freelancerAddress: r.freelancer_address,
    status: r.status,
    createdAt: r.created_at,
  }));
}

/**
 * Decline an invitation.
 *
 * @param {string} invitationId
 * @param {string} freelancerAddress
 * @returns {Promise<Object>}
 */
async function declineInvitation(invitationId, freelancerAddress) {
  const { rows } = await pool.query(
    "SELECT * FROM job_invitations WHERE id = $1",
    [invitationId]
  );
  if (!rows.length) {
    const e = new Error("Invitation not found");
    e.status = 404;
    throw e;
  }
  if (rows[0].freelancer_address !== freelancerAddress) {
    const e = new Error("Only the invited freelancer can decline");
    e.status = 403;
    throw e;
  }

  const { rows: updated } = await pool.query(
    "UPDATE job_invitations SET status = 'declined' WHERE id = $1 RETURNING *",
    [invitationId]
  );
  return updated[0];
}

module.exports = {
  inviteFreelancerToJob,
  getInvitationsForFreelancer,
  declineInvitation,
};
