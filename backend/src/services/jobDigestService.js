"use strict";

/**
 * services/jobDigestService.js
 * Daily email digest of matching jobs for freelancers (#863).
 *
 * Finds new jobs posted in the last 24 hours that match each user's saved
 * searches, then sends a digest email (max 10 jobs per digest).
 */

const pool = require("../db/pool");
const { sendEmail } = require("../utils/email");

const MAX_JOBS_PER_DIGEST = 10;

/**
 * Build an HTML digest email for a user.
 */
function buildDigestHtml(userName, jobs) {
  const rows = jobs
    .map(
      (j) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">
          <a href="${process.env.FRONTEND_URL || "https://marketpay.io"}/jobs/${j.id}" style="color:#5b21b6;text-decoration:none;font-weight:600;">${j.title}</a>
          <div style="font-size:12px;color:#666;margin-top:2px;">${j.category} · ${j.budget} ${j.currency}</div>
          <div style="font-size:11px;color:#999;margin-top:2px;">Skills: ${j.skills.join(", ") || "—"}</div>
          ${j.deadline ? `<div style="font-size:11px;color:#999;">Deadline: ${new Date(j.deadline).toLocaleDateString()}</div>` : ""}
        </td>
      </tr>`
    )
    .join("");

  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="color:#1a1a1a;margin-bottom:4px;">Daily Job Digest</h2>
      <p style="color:#666;font-size:14px;">Hi ${userName || "there"}, here are new jobs matching your saved searches:</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">${rows}</table>
      <p style="color:#999;font-size:12px;margin-top:24px;">
        You're receiving this because you have saved searches on MarketPay.
        <a href="${process.env.FRONTEND_URL || "https://marketpay.io"}/settings" style="color:#5b21b6;">Unsubscribe</a>
      </p>
    </div>`;
}

/**
 * Fetch new jobs matching a user's saved search keywords from the last 24h.
 */
async function findMatchingJobs(savedSearch) {
  const { rows } = await pool.query(
    `
    SELECT id, title, category, budget, currency, skills, deadline
    FROM jobs
    WHERE status = 'open'
      AND created_at >= NOW() - INTERVAL '24 hours'
      AND (
        $1::text IS NULL
        OR skills && $2::text[]
        OR title ILIKE '%' || $1 || '%'
        OR category ILIKE '%' || $1 || '%'
      )
    ORDER BY created_at DESC
    LIMIT $3
    `,
    [savedSearch.keyword || null, savedSearch.skills || [], MAX_JOBS_PER_DIGEST]
  );
  return rows;
}

/**
 * Run the daily digest: find users with saved searches, match jobs, send emails.
 * Intended to be called by a cron job at 6 AM UTC.
 */
async function runDailyDigest() {
  // Fetch users who have saved searches and have NOT opted out
  const { rows: users } = await pool.query(`
    SELECT DISTINCT u.id, u.email, u.name, u.email_digest_enabled
    FROM users u
    INNER JOIN saved_searches ss ON ss.user_id = u.id
    WHERE COALESCE(u.email_digest_enabled, true) = true
      AND u.email IS NOT NULL
  `);

  let sent = 0;

  for (const user of users) {
    try {
      const { rows: searches } = await pool.query(
        `SELECT keyword, skills FROM saved_searches WHERE user_id = $1`,
        [user.id]
      );

      const allJobs = new Map();
      for (const search of searches) {
        const jobs = await findMatchingJobs(search);
        for (const job of jobs) {
          allJobs.set(job.id, job);
        }
      }

      const uniqueJobs = [...allJobs.values()].slice(0, MAX_JOBS_PER_DIGEST);
      if (uniqueJobs.length === 0) continue;

      await sendEmail({
        to: user.email,
        subject: `MarketPay: ${uniqueJobs.length} new job${uniqueJobs.length > 1 ? "s" : ""} matching your searches`,
        html: buildDigestHtml(user.name, uniqueJobs),
        text: `New jobs matching your searches: ${uniqueJobs.map((j) => j.title).join(", ")}`,
      });
      sent++;
    } catch (err) {
      console.error(`[digest] Failed for user ${user.id}:`, err.message);
    }
  }

  return { usersProcessed: users.length, emailsSent: sent };
}

module.exports = { runDailyDigest, buildDigestHtml, findMatchingJobs };
