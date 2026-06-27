/**
 * src/services/weeklyDigestService.js
 *
 * Weekly job-digest email — sends each active freelancer their top 5 matching
 * open jobs from the past 7 days, every Monday at 09:00 UTC.
 *
 * Reuses recommendationService.getRecommendations() for skill-match scoring.
 * Respects the `weekly_digest / email` notification preference flag.
 * Provides a token-based one-click unsubscribe link (no login required).
 */
"use strict";

const nodemailer = require("nodemailer");
const pool = require("../db/pool");
const { getRecommendations } = require("./recommendationService");
const { isNotificationEnabled } = require("./notificationPreferencesService");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("weekly-digest");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Truncate a string and append ellipsis if needed.
 * @param {string} text
 * @param {number} maxLen
 */
function excerpt(text, maxLen = 120) {
  if (!text) return "";
  return text.length <= maxLen ? text : `${text.slice(0, maxLen).trimEnd()}…`;
}

/**
 * Format a budget number as a human-readable XLM string.
 * @param {number|string} budget
 * @param {string} currency
 */
function formatBudget(budget, currency = "XLM") {
  const num = parseFloat(budget);
  if (isNaN(num)) return "Negotiable";
  return `${num.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
}

// ─── Query active freelancers ─────────────────────────────────────────────────

/**
 * Return profiles that are:
 *  - role = 'freelancer' OR 'both'
 *  - have a valid email address
 *  - logged in within the last 30 days (last_login_at IS NOT NULL)
 *
 * @returns {Promise<Array<{public_key: string, email: string, digest_unsubscribe_token: string}>>}
 */
async function getActiveFreelancers() {
  const encKey = process.env.DATABASE_ENCRYPTION_KEY || "";
  const { rows } = await pool.query(
    `SELECT public_key,
            COALESCE(
              CASE WHEN encrypted_email IS NOT NULL
                THEN pgp_sym_decrypt(encrypted_email, $1)
              END,
              email
            ) AS email,
            digest_unsubscribe_token
     FROM profiles
     WHERE role IN ('freelancer', 'both')
       AND (email IS NOT NULL AND email <> '' OR encrypted_email IS NOT NULL)
       AND last_login_at IS NOT NULL
       AND last_login_at >= NOW() - INTERVAL '30 days'`,
    [encKey]
  );
  return rows;
}

// ─── HTML email template ──────────────────────────────────────────────────────

/**
 * Build a job card as an HTML table row.
 * Uses inline styles + table-based layout for Outlook compatibility.
 *
 * @param {Object} job
 * @param {string} baseUrl
 */
function buildJobCard(job, baseUrl) {
  const applyUrl = `${baseUrl}/jobs/${job.id}`;
  const budgetStr = formatBudget(job.budget, job.currency || "XLM");
  const desc = excerpt(job.description, 130);
  const category = job.category || "General";
  const matchPct = job.match_score != null ? `${job.match_score}% match` : "";

  return `
    <tr>
      <td style="padding:0 0 20px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
               style="background:#1e293b;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:22px 24px 18px 24px;">
              <!-- Category + match badge row -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <span style="display:inline-block;background:#0f172a;color:#94a3b8;
                                 font-size:11px;font-weight:600;letter-spacing:.6px;
                                 text-transform:uppercase;padding:3px 10px;border-radius:20px;">
                      ${category}
                    </span>
                    ${matchPct ? `<span style="display:inline-block;margin-left:8px;background:#1d4ed8;color:#bfdbfe;
                                 font-size:11px;font-weight:600;letter-spacing:.4px;
                                 padding:3px 10px;border-radius:20px;">${matchPct}</span>` : ""}
                  </td>
                </tr>
              </table>
              <!-- Title -->
              <p style="margin:12px 0 6px 0;font-size:17px;font-weight:700;
                         color:#f1f5f9;line-height:1.35;">
                ${job.title}
              </p>
              <!-- Description excerpt -->
              <p style="margin:0 0 14px 0;font-size:14px;color:#94a3b8;line-height:1.6;">
                ${desc}
              </p>
              <!-- Budget + CTA row -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <span style="font-size:16px;font-weight:700;color:#38bdf8;">
                      ${budgetStr}
                    </span>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <a href="${applyUrl}"
                       style="display:inline-block;background:#2563eb;color:#ffffff;
                              font-size:13px;font-weight:700;text-decoration:none;
                              padding:9px 20px;border-radius:8px;
                              letter-spacing:.3px;">
                      Apply Now →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

/**
 * Generate the full HTML digest email.
 *
 * @param {Array<Object>} jobs          - Top matching jobs (max 5)
 * @param {string}        unsubToken    - digest_unsubscribe_token UUID
 * @param {string}        baseUrl       - FRONTEND_URL env value
 * @param {string}        apiBaseUrl    - Backend base URL for unsubscribe link
 * @returns {{ subject: string, text: string, html: string }}
 */
function generateDigestEmail(jobs, unsubToken, baseUrl, apiBaseUrl) {
  const subject = "5 new jobs matching your skills this week";
  const unsubUrl = `${apiBaseUrl}/api/notifications/unsubscribe?token=${unsubToken}`;
  const browseUrl = `${baseUrl}/jobs`;
  const activitySummary = jobs.length > 0
    ? `${jobs.length} new job matches were found for your profile this week.`
    : "No new job matches were found for your profile this week.";

  // ── Plain-text fallback ──────────────────────────────────────────────────
  const textLines = [
    subject,
    "=".repeat(subject.length),
    "",
    `Hi there,`,
    `Your weekly activity summary: ${activitySummary}`,
    `Here are your top ${jobs.length} job matches from this week on Stellar MarketPay:`,
    "",
  ];
  jobs.forEach((job, i) => {
    textLines.push(
      `${i + 1}. ${job.title}`,
      `   Category: ${job.category || "General"}`,
      `   Budget: ${formatBudget(job.budget, job.currency)}`,
      `   ${excerpt(job.description, 100)}`,
      `   Apply: ${baseUrl}/jobs/${job.id}`,
      ""
    );
  });
  textLines.push(
    `View all open jobs: ${browseUrl}`,
    "",
    `---`,
    `You received this because you have an active freelancer account on Stellar MarketPay.`,
    `To unsubscribe from weekly digests, visit: ${unsubUrl}`
  );
  const text = textLines.join("\n");

  // ── HTML ─────────────────────────────────────────────────────────────────
  const jobCards = jobs.map((j) => buildJobCard(j, baseUrl)).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <!-- Wrapper -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
         style="background:#0f172a;min-width:100%;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <!-- Email container: 600px max -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"
               style="max-width:600px;width:100%;">

          <!-- ── Header ── -->
          <tr>
            <td align="center" style="padding:0 0 32px 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                     style="background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%);
                            border-radius:16px;overflow:hidden;">
                <tr>
                  <td align="center" style="padding:36px 24px 28px 24px;">
                    <!-- Logo / wordmark -->
                    <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-.5px;">
                      ✦ Stellar MarketPay
                    </div>
                    <p style="margin:14px 0 0 0;font-size:26px;font-weight:800;
                               color:#ffffff;line-height:1.25;letter-spacing:-.3px;">
                      Your weekly job matches
                    </p>
                    <p style="margin:10px 0 0 0;font-size:15px;color:#bfdbfe;line-height:1.5;">
                      <strong>${activitySummary}</strong>
                    </p>
                  </td>
                </tr>
                <!-- Divider strip -->
                <tr>
                  <td style="height:4px;background:linear-gradient(90deg,#38bdf8,#2563eb,#7c3aed);"></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Job cards ── -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${jobCards}
              </table>
            </td>
          </tr>

          <!-- ── Browse all CTA ── -->
          <tr>
            <td align="center" style="padding:10px 0 36px 0;">
              <a href="${browseUrl}"
                 style="display:inline-block;background:#0f172a;border:2px solid #2563eb;
                        color:#60a5fa;font-size:14px;font-weight:700;text-decoration:none;
                        padding:12px 32px;border-radius:10px;letter-spacing:.3px;">
                Browse all open jobs
              </a>
            </td>
          </tr>

          <!-- ── Footer ── -->
          <tr>
            <td style="border-top:1px solid #1e293b;padding:24px 0 0 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center">
                    <p style="margin:0 0 8px 0;font-size:12px;color:#475569;line-height:1.6;">
                      You received this because you have an active freelancer account on
                      <a href="${baseUrl}" style="color:#60a5fa;text-decoration:none;">
                        Stellar MarketPay
                      </a>.
                    </p>
                    <p style="margin:0;font-size:12px;color:#475569;">
                      Don't want weekly digests?
                      <a href="${unsubUrl}" style="color:#60a5fa;text-decoration:underline;">
                        Unsubscribe
                      </a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

// ─── Main orchestration ───────────────────────────────────────────────────────

async function sendDigestMessage(payload, sendEmailFn) {
  if (typeof sendEmailFn === "function") {
    return sendEmailFn(payload);
  }

  const smtpEnabled = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  if (!smtpEnabled) {
    logger.warn("SMTP credentials are not configured; skipping digest email send");
    return null;
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    ...payload,
  });
}

/**
 * Run the weekly digest for all eligible freelancers.
 *
 * @param {Function} sendEmailFn  - async ({ to, subject, text, html }) => void
 * @returns {Promise<{ sent: number, skipped: number, failed: number }>}
 */
async function sendWeeklyDigest(sendEmailFn) {
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;

  logger.info("Starting weekly digest run");

  const freelancers = await getActiveFreelancers();
  logger.info({ total: freelancers.length }, "Active freelancers found");

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const freelancer of freelancers) {
    const { public_key, email, digest_unsubscribe_token } = freelancer;

    try {
      // 1. Check preference — default is enabled if no row exists
      const enabled = await isNotificationEnabled(public_key, "weekly_digest", "email");
      if (!enabled) {
        skipped++;
        logger.debug({ publicKey: public_key }, "Digest disabled by preference, skipping");
        continue;
      }

      // 2. Get top 5 matching jobs posted in the last 7 days
      const allMatches = await getRecommendations(public_key, 20);
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentMatches = allMatches
        .filter((j) => new Date(j.created_at) >= oneWeekAgo)
        .slice(0, 5);

      if (recentMatches.length === 0) {
        skipped++;
        logger.debug({ publicKey: public_key }, "No new matching jobs this week, skipping");
        continue;
      }

      // 3. Build and send email
      const { subject, text, html } = generateDigestEmail(
        recentMatches,
        digest_unsubscribe_token,
        baseUrl,
        apiBaseUrl
      );

      await sendDigestMessage({ to: email, subject, text, html }, sendEmailFn);
      sent++;
      logger.info({ publicKey: public_key, jobCount: recentMatches.length }, "Digest sent");
    } catch (err) {
      failed++;
      logger.error(
        { publicKey: public_key, err: err.message },
        "Failed to send digest to freelancer"
      );
    }
  }

  logger.info({ sent, skipped, failed }, "Weekly digest run complete");
  return { sent, skipped, failed };
}

module.exports = {
  sendWeeklyDigest,
  generateDigestEmail,
  getActiveFreelancers,
};
