"use strict";

const { emailQueue } = require("../utils/queue");
const { sendEmail } = require("../utils/email");
const { getUserPreferences, generateEmailContent } = require("../services/notificationService");
const pool = require("../db/pool");
const { createServiceLogger, logError } = require("../utils/logger");

const emailLogger = createServiceLogger('email-worker');

emailQueue.process(5, async (job) => {
  const { recipientAddress, eventType, jobId, payload, notificationId } = job.data;
  
  try {
    const prefs = await getUserPreferences(recipientAddress);
    if (!prefs) {
      emailLogger.info({ notificationId, recipientAddress }, 'User not found, skipping email');
      return { status: "skipped", reason: "User not found" };
    }

    if (!prefs.email_notifications_enabled || !prefs.email) {
      emailLogger.info({ notificationId, recipientAddress }, 'User email disabled, skipping email');
      return { status: "skipped", reason: "Email disabled" };
    }

    const emailContent = generateEmailContent(eventType, payload);

    await sendEmail({
      to: prefs.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    if (notificationId) {
      await pool.query(
        `UPDATE notification_queue
         SET status = 'sent', sent_at = NOW(), last_attempt_at = NOW()
         WHERE id = $1`,
        [notificationId]
      );
    }

    emailLogger.info({ notificationId, recipientAddress }, 'Email sent successfully');
    return { status: "sent" };
  } catch (error) {
    logError(emailLogger, error, { operation: 'email_worker_process', notificationId });
    throw error;
  }
});

emailLogger.info('Email worker started listening for jobs');

module.exports = {
  emailQueue,
};
