"use strict";

/**
 * services/savedSearchAlertService.js
 * Real-time saved search alert service (checks every 10 minutes).
 *
 * Finds new jobs posted since last check that match users' saved searches,
 * then sends in-app notifications and optional email notifications.
 */

const pool = require("../db/pool");
const { createInAppNotification } = require("./notificationService");
const { sendEmail } = require("../utils/email");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("saved-search-alerts");
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Build SQL WHERE clause from saved search query_params
 */
function buildWhereClause(queryParams) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  // Always filter for open jobs
  conditions.push("status = 'open'");

  // Budget range
  if (queryParams.minBudget) {
    conditions.push(`budget >= $${paramIndex}`);
    params.push(queryParams.minBudget);
    paramIndex++;
  }
  if (queryParams.maxBudget) {
    conditions.push(`budget <= $${paramIndex}`);
    params.push(queryParams.maxBudget);
    paramIndex++;
  }

  // Skills (array overlap)
  if (queryParams.skills) {
    const skillArray = queryParams.skills.split(",").map(s => s.trim()).filter(Boolean);
    if (skillArray.length > 0) {
      conditions.push(`skills && $${paramIndex}`);
      params.push(skillArray);
      paramIndex++;
    }
  }

  // Client rating
  if (queryParams.minClientRating) {
    conditions.push(`client_rating >= $${paramIndex}`);
    params.push(queryParams.minClientRating);
    paramIndex++;
  }

  // Duration
  if (queryParams.duration) {
    const durationMap = {
      short: "duration <= 7",
      medium: "duration > 7 AND duration <= 30",
      long: "duration > 30"
    };
    if (durationMap[queryParams.duration]) {
      conditions.push(durationMap[queryParams.duration]);
    }
  }

  // Posted since
  if (queryParams.postedSince) {
    const postedMap = {
      today: "created_at >= NOW() - INTERVAL '1 day'",
      week: "created_at >= NOW() - INTERVAL '7 days'",
      month: "created_at >= NOW() - INTERVAL '30 days'"
    };
    if (postedMap[queryParams.postedSince]) {
      conditions.push(postedMap[queryParams.postedSince]);
    }
  }

  // Max applications
  if (queryParams.maxApplications) {
    conditions.push(`application_count <= $${paramIndex}`);
    params.push(queryParams.maxApplications);
    paramIndex++;
  }

  return { whereClause: conditions.join(" AND "), params };
}

/**
 * Find new jobs matching a saved search since last notification
 */
async function findMatchingJobs(savedSearch) {
  const { whereClause, params } = buildWhereClause(savedSearch.query_params);
  
  // Add time filter since last notification
  const timeFilter = savedSearch.last_notified_at 
    ? "AND created_at > $1"
    : "AND created_at >= NOW() - INTERVAL '24 hours'";
  
  const timeParams = savedSearch.last_notified_at 
    ? [savedSearch.last_notified_at, ...params]
    : params;

  const query = `
    SELECT id, title, category, budget, currency, skills, duration, created_at
    FROM jobs
    WHERE ${whereClause} ${timeFilter}
    ORDER BY created_at DESC
    LIMIT 20
  `;

  const { rows } = await pool.query(query, timeParams);
  return rows;
}

/**
 * Send email notification for matching jobs
 */
async function sendJobMatchEmail(userEmail, userName, savedSearch, jobs) {
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  
  const jobRows = jobs.map(job => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #eee;">
        <a href="${baseUrl}/jobs/${job.id}" style="color:#5b21b6;text-decoration:none;font-weight:600;font-size:14px;">${job.title}</a>
        <div style="font-size:12px;color:#666;margin-top:4px;">${job.category || "General"} · ${job.budget} ${job.currency}</div>
        <div style="font-size:11px;color:#999;margin-top:2px;">Skills: ${job.skills?.join(", ") || "—"}</div>
      </td>
    </tr>
  `).join("");

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="color:#1a1a1a;margin-bottom:4px;">New Jobs Matching Your Search</h2>
      <p style="color:#666;font-size:14px;">Hi ${userName || "there"}, we found ${jobs.length} new job${jobs.length > 1 ? "s" : ""} matching your saved search.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">${jobRows}</table>
      <p style="color:#999;font-size:12px;margin-top:24px;">
        <a href="${baseUrl}/jobs" style="color:#5b21b6;">View all jobs</a> · 
        <a href="${baseUrl}/settings" style="color:#5b21b6;">Manage alerts</a>
      </p>
    </div>
  `;

  const text = `New jobs matching your search:\n\n${jobs.map(j => `- ${j.title} (${j.budget} ${j.currency})`).join("\n")}`;

  try {
    await sendEmail({
      to: userEmail,
      subject: `MarketPay: ${jobs.length} new job${jobs.length > 1 ? "s" : ""} matching your search`,
      html,
      text,
    });
    return true;
  } catch (error) {
    logger.error({ error: error.message, userEmail }, "Failed to send job match email");
    return false;
  }
}

/**
 * Check for new jobs matching saved searches and send notifications
 */
async function checkSavedSearchAlerts() {
  try {
    // Get all saved searches with notification preferences
    const { rows: savedSearches } = await pool.query(`
      SELECT ss.id, ss.user_address, ss.query_params, ss.notify_in_app, ss.notify_email, ss.last_notified_at,
             p.name, p.email, p.email_notifications_enabled
      FROM saved_searches ss
      LEFT JOIN profiles p ON p.public_key = ss.user_address
      WHERE ss.notify_in_app = TRUE OR ss.notify_email = TRUE
    `);

    let inAppNotifications = 0;
    let emailNotifications = 0;

    for (const savedSearch of savedSearches) {
      const matchingJobs = await findMatchingJobs(savedSearch);
      
      if (matchingJobs.length === 0) {
        continue;
      }

      // Send in-app notification
      if (savedSearch.notify_in_app) {
        for (const job of matchingJobs.slice(0, 5)) { // Max 5 in-app notifications per check
          await createInAppNotification({
            userAddress: savedSearch.user_address,
            type: "job_match",
            title: "New job match",
            body: `A new job "${job.title}" matches your saved search.`,
            jobId: job.id,
            linkPath: `/jobs/${job.id}`,
            sendPush: true,
          });
          inAppNotifications++;
        }
      }

      // Send email notification
      if (savedSearch.notify_email && savedSearch.email && savedSearch.email_notifications_enabled !== false) {
        const emailSent = await sendJobMatchEmail(
          savedSearch.email,
          savedSearch.name,
          savedSearch,
          matchingJobs.slice(0, 10) // Max 10 jobs per email
        );
        if (emailSent) {
          emailNotifications++;
        }
      }

      // Update last_notified_at
      await pool.query(
        "UPDATE saved_searches SET last_notified_at = NOW() WHERE id = $1",
        [savedSearch.id]
      );
    }

    logger.info({
      searchesChecked: savedSearches.length,
      inAppNotifications,
      emailNotifications,
    }, "Saved search alert check completed");

    return {
      searchesChecked: savedSearches.length,
      inAppNotifications,
      emailNotifications,
    };
  } catch (error) {
    logger.error({ error: error.message }, "Error checking saved search alerts");
    throw error;
  }
}

/**
 * Start the saved search alert checker (runs every 10 minutes)
 */
function startSavedSearchAlertChecker() {
  logger.info("Starting saved search alert checker (10-minute interval)");
  
  // Run immediately on startup
  checkSavedSearchAlerts().catch((err) => {
    logger.error({ error: err.message }, "Initial saved search alert check failed");
  });

  // Schedule recurring checks
  setInterval(() => {
    checkSavedSearchAlerts().catch((err) => {
      logger.error({ error: err.message }, "Scheduled saved search alert check failed");
    });
  }, CHECK_INTERVAL_MS).unref();
}

module.exports = {
  checkSavedSearchAlerts,
  startSavedSearchAlertChecker,
  buildWhereClause,
  findMatchingJobs,
};
