/**
 * src/services/notificationService.js
 * Email and webhook notification service for escrow state changes
 */
"use strict";

const pool = require("../db/pool");
const axios = require("axios");

const MAX_RETRIES = 3;

/**
 * Event types that trigger notifications
 */
const EVENT_TYPES = {
  ESCROW_CREATED: "escrow_created",
  WORK_STARTED: "work_started",
  ESCROW_RELEASED: "escrow_released",
  REFUND_ISSUED: "refund_issued",
  DISPUTE_OPENED: "dispute_opened",
  APPLICATION_ACCEPTED: "application_accepted",
  JOB_COMPLETED: "job_completed",
};

/**
 * Queue a notification for a user
 * 
 * @param {Object} params
 * @param {string} params.recipientAddress - Stellar public key
 * @param {string} params.notificationType - 'email' or 'webhook'
 * @param {string} params.eventType - Event type from EVENT_TYPES
 * @param {string} params.jobId - Job UUID
 * @param {Object} params.payload - Additional data for the notification
 * @returns {Promise<Object>} The queued notification
 */
async function queueNotification({ recipientAddress, notificationType, eventType, jobId, payload }) {
  const { rows } = await pool.query(
    `INSERT INTO notification_queue 
      (recipient_address, notification_type, event_type, job_id, payload, status, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', NOW())
     RETURNING *`,
    [recipientAddress, notificationType, eventType, jobId, JSON.stringify(payload)]
  );

  return rows[0];
}

/**
 * Get user notification preferences
 * 
 * @param {string} publicKey - Stellar public key
 * @returns {Promise<Object>} User preferences
 */
async function getUserPreferences(publicKey) {
  const { rows } = await pool.query(
    `SELECT email, email_notifications_enabled, webhook_url, webhook_secret
     FROM profiles
     WHERE public_key = $1`,
    [publicKey]
  );

  return rows[0] || null;
}

/**
 * Send an email notification
 * 
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.subject - Email subject
 * @param {string} params.text - Email body (plain text)
 * @param {string} params.html - Email body (HTML)
 * @param {Function} sendEmailFn - Function to send email (from server.js)
 * @returns {Promise<boolean>} Success status
 */
async function sendEmail({ to, subject, text, html }, sendEmailFn) {
  if (!sendEmailFn) {
    console.warn("[notifications] Email transport not configured");
    return false;
  }

  try {
    await sendEmailFn({ to, subject, text, html });
    return true;
  } catch (error) {
    console.error("[notifications] Email send failed:", error.message);
    return false;
  }
}

/**
 * Send a webhook notification
 * 
 * @param {Object} params
 * @param {string} params.url - Webhook URL
 * @param {string} params.secret - Webhook secret for HMAC signature
 * @param {Object} params.payload - Webhook payload
 * @returns {Promise<boolean>} Success status
 */
async function sendWebhook({ url, secret, payload }) {
  try {
    const crypto = require("crypto");
    const timestamp = Date.now();
    const body = JSON.stringify(payload);

    // Generate HMAC signature
    const signature = crypto
      .createHmac("sha256", secret || "")
      .update(`${timestamp}.${body}`)
      .digest("hex");

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Timestamp": timestamp.toString(),
      },
      timeout: 10000, // 10 second timeout
    });

    return response.status >= 200 && response.status < 300;
  } catch (error) {
    console.error("[notifications] Webhook send failed:", error.message);
    return false;
  }
}

/**
 * Generate email content for an event
 * 
 * @param {string} eventType - Event type
 * @param {Object} data - Event data
 * @returns {Object} Email subject and body
 */
function generateEmailContent(eventType, data) {
  const { jobTitle, jobId, amount, currency } = data;
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const jobUrl = `${baseUrl}/jobs/${jobId}`;

  const templates = {
    [EVENT_TYPES.ESCROW_CREATED]: {
      subject: `Escrow Created: ${jobTitle}`,
      text: `Your escrow for "${jobTitle}" has been created.\n\nAmount: ${amount} ${currency}\nJob: ${jobUrl}\n\nThe funds are now locked in a smart contract.`,
      html: `<h2>Escrow Created</h2><p>Your escrow for "<strong>${jobTitle}</strong>" has been created.</p><p><strong>Amount:</strong> ${amount} ${currency}</p><p><a href="${jobUrl}">View Job</a></p><p>The funds are now locked in a smart contract.</p>`,
    },
    [EVENT_TYPES.WORK_STARTED]: {
      subject: `Work Started: ${jobTitle}`,
      text: `Work has started on "${jobTitle}".\n\nJob: ${jobUrl}\n\nThe freelancer has been assigned and can now begin work.`,
      html: `<h2>Work Started</h2><p>Work has started on "<strong>${jobTitle}</strong>".</p><p><a href="${jobUrl}">View Job</a></p><p>The freelancer has been assigned and can now begin work.</p>`,
    },
    [EVENT_TYPES.ESCROW_RELEASED]: {
      subject: `Payment Released: ${jobTitle}`,
      text: `Payment for "${jobTitle}" has been released.\n\nAmount: ${amount} ${currency}\nJob: ${jobUrl}\n\nThe escrow has been released to the freelancer.`,
      html: `<h2>Payment Released</h2><p>Payment for "<strong>${jobTitle}</strong>" has been released.</p><p><strong>Amount:</strong> ${amount} ${currency}</p><p><a href="${jobUrl}">View Job</a></p><p>The escrow has been released to the freelancer.</p>`,
    },
    [EVENT_TYPES.REFUND_ISSUED]: {
      subject: `Refund Issued: ${jobTitle}`,
      text: `A refund for "${jobTitle}" has been issued.\n\nAmount: ${amount} ${currency}\nJob: ${jobUrl}\n\nThe escrow has been refunded to the client.`,
      html: `<h2>Refund Issued</h2><p>A refund for "<strong>${jobTitle}</strong>" has been issued.</p><p><strong>Amount:</strong> ${amount} ${currency}</p><p><a href="${jobUrl}">View Job</a></p><p>The escrow has been refunded to the client.</p>`,
    },
    [EVENT_TYPES.DISPUTE_OPENED]: {
      subject: `Dispute Opened: ${jobTitle}`,
      text: `A dispute has been opened for "${jobTitle}".\n\nJob: ${jobUrl}\n\nPlease review the dispute and provide any necessary information.`,
      html: `<h2>Dispute Opened</h2><p>A dispute has been opened for "<strong>${jobTitle}</strong>".</p><p><a href="${jobUrl}">View Job</a></p><p>Please review the dispute and provide any necessary information.</p>`,
    },
    [EVENT_TYPES.APPLICATION_ACCEPTED]: {
      subject: `Application Accepted: ${jobTitle}`,
      text: `Your application for "${jobTitle}" has been accepted!\n\nJob: ${jobUrl}\n\nYou can now start working on this job.`,
      html: `<h2>Application Accepted</h2><p>Your application for "<strong>${jobTitle}</strong>" has been accepted!</p><p><a href="${jobUrl}">View Job</a></p><p>You can now start working on this job.</p>`,
    },
    [EVENT_TYPES.JOB_COMPLETED]: {
      subject: `Job Completed: ${jobTitle}`,
      text: `The job "${jobTitle}" has been completed.\n\nJob: ${jobUrl}\n\nThank you for using Stellar MarketPay!`,
      html: `<h2>Job Completed</h2><p>The job "<strong>${jobTitle}</strong>" has been completed.</p><p><a href="${jobUrl}">View Job</a></p><p>Thank you for using Stellar MarketPay!</p>`,
    },
  };

  return templates[eventType] || {
    subject: `Notification: ${jobTitle}`,
    text: `An event occurred for "${jobTitle}".\n\nJob: ${jobUrl}`,
    html: `<h2>Notification</h2><p>An event occurred for "<strong>${jobTitle}</strong>".</p><p><a href="${jobUrl}">View Job</a></p>`,
  };
}

/**
 * Process pending notifications
 * 
 * @param {Function} sendEmailFn - Function to send email
 * @returns {Promise<Object>} Processing stats
 */
async function processPendingNotifications(sendEmailFn) {
  const { rows: pending } = await pool.query(
    `SELECT * FROM notification_queue
     WHERE status = 'pending' AND retry_count < $1
     ORDER BY created_at ASC
     LIMIT 50`,
    [MAX_RETRIES]
  );

  let sent = 0;
  let failed = 0;

  for (const notification of pending) {
    try {
      const prefs = await getUserPreferences(notification.recipient_address);
      
      if (!prefs) {
        // User not found, mark as failed
        await pool.query(
          `UPDATE notification_queue
           SET status = 'failed', error_message = 'User not found', last_attempt_at = NOW()
           WHERE id = $1`,
          [notification.id]
        );
        failed++;
        continue;
      }

      let success = false;

      if (notification.notification_type === "email") {
        if (!prefs.email_notifications_enabled || !prefs.email) {
          // User has email notifications disabled, mark as sent (skip)
          await pool.query(
            `UPDATE notification_queue
             SET status = 'sent', sent_at = NOW(), last_attempt_at = NOW()
             WHERE id = $1`,
            [notification.id]
          );
          sent++;
          continue;
        }

        const emailContent = generateEmailContent(
          notification.event_type,
          notification.payload
        );

        success = await sendEmail(
          {
            to: prefs.email,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
          },
          sendEmailFn
        );
      } else if (notification.notification_type === "webhook") {
        if (!prefs.webhook_url) {
          // No webhook URL configured, mark as sent (skip)
          await pool.query(
            `UPDATE notification_queue
             SET status = 'sent', sent_at = NOW(), last_attempt_at = NOW()
             WHERE id = $1`,
            [notification.id]
          );
          sent++;
          continue;
        }

        const webhookPayload = {
          event: notification.event_type,
          jobId: notification.job_id,
          timestamp: new Date().toISOString(),
          data: notification.payload,
        };

        success = await sendWebhook({
          url: prefs.webhook_url,
          secret: prefs.webhook_secret,
          payload: webhookPayload,
        });
      }

      if (success) {
        await pool.query(
          `UPDATE notification_queue
           SET status = 'sent', sent_at = NOW(), last_attempt_at = NOW()
           WHERE id = $1`,
          [notification.id]
        );
        sent++;
      } else {
        const newRetryCount = notification.retry_count + 1;
        const newStatus = newRetryCount >= MAX_RETRIES ? "failed" : "pending";

        await pool.query(
          `UPDATE notification_queue
           SET status = $1, retry_count = $2, last_attempt_at = NOW(),
               error_message = 'Delivery failed'
           WHERE id = $3`,
          [newStatus, newRetryCount, notification.id]
        );
        failed++;
      }
    } catch (error) {
      console.error(`[notifications] Error processing notification ${notification.id}:`, error.message);
      
      const newRetryCount = notification.retry_count + 1;
      const newStatus = newRetryCount >= MAX_RETRIES ? "failed" : "pending";

      await pool.query(
        `UPDATE notification_queue
         SET status = $1, retry_count = $2, last_attempt_at = NOW(),
             error_message = $3
         WHERE id = $4`,
        [newStatus, newRetryCount, error.message, notification.id]
      );
      failed++;
    }
  }

  return { sent, failed, total: pending.length };
}

/**
 * Notify users about an escrow event
 * 
 * @param {Object} params
 * @param {string} params.eventType - Event type
 * @param {string} params.jobId - Job UUID
 * @param {string} params.clientAddress - Client public key
 * @param {string} params.freelancerAddress - Freelancer public key
 * @param {Object} params.data - Additional event data
 * @returns {Promise<void>}
 */
async function notifyEscrowEvent({ eventType, jobId, clientAddress, freelancerAddress, data }) {
  const recipients = [clientAddress];
  if (freelancerAddress) recipients.push(freelancerAddress);

  for (const recipient of recipients) {
    // Queue email notification
    await queueNotification({
      recipientAddress: recipient,
      notificationType: "email",
      eventType,
      jobId,
      payload: data,
    });

    // Queue webhook notification
    await queueNotification({
      recipientAddress: recipient,
      notificationType: "webhook",
      eventType,
      jobId,
      payload: data,
    });
  }

  console.log(`[notifications] Queued ${eventType} notifications for job ${jobId}`);
}

module.exports = {
  queueNotification,
  getUserPreferences,
  processPendingNotifications,
  notifyEscrowEvent,
  generateEmailContent,
  EVENT_TYPES,
};
