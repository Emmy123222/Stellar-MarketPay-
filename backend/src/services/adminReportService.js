"use strict";

/**
 * src/services/adminReportService.js
 *
 * Generates a weekly PDF platform-health report for admins and stores it in
 * S3-compatible object storage.  The PDF is also emailed to ADMIN_EMAIL.
 *
 * Storage is configured via environment variables:
 *   S3_ENDPOINT      — S3-compatible URL (e.g. https://s3.amazonaws.com or MinIO)
 *   S3_BUCKET        — bucket name (default: "marketpay-reports")
 *   S3_REGION        — region (default: "us-east-1")
 *   S3_ACCESS_KEY    — access key id
 *   S3_SECRET_KEY    — secret access key
 *   ADMIN_EMAIL      — comma-separated list of recipient email addresses
 */

const PDFDocument = require("pdfkit");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const pool = require("../db/pool");
const { createServiceLogger, logError } = require("../utils/logger");

const logger = createServiceLogger("admin-report");

// ─── S3 client ────────────────────────────────────────────────────────────────

function getS3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;

  if (!accessKeyId || !secretAccessKey) return null;

  const config = {
    region,
    credentials: { accessKeyId, secretAccessKey },
  };
  if (endpoint) {
    config.endpoint = endpoint;
    config.forcePathStyle = true; // required for MinIO / non-AWS
  }
  return new S3Client(config);
}

const S3_BUCKET = process.env.S3_BUCKET || "marketpay-reports";
const S3_KEY = "admin-reports/latest-weekly-report.pdf";

// ─── Data gathering ───────────────────────────────────────────────────────────

/**
 * Pull one week's worth of platform metrics from the database.
 * Returns a plain object suitable for embedding in the PDF.
 */
async function gatherReportData() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [jobs, escrow, disputes, users, categories] = await Promise.all([
    // New jobs this week + total open
    pool.query(
      `SELECT
         COUNT(*)                                               AS new_jobs,
         COUNT(*) FILTER (WHERE status = 'open')               AS open_jobs,
         COUNT(*) FILTER (WHERE status = 'completed')          AS completed_jobs,
         COALESCE(SUM(budget), 0)                              AS total_budget
       FROM jobs
       WHERE created_at >= $1 AND deleted_at IS NULL`,
      [since]
    ),

    // Total escrow volume funded this week
    pool.query(
      `SELECT COALESCE(SUM(amount_xlm), 0) AS total_volume,
              COUNT(*) FILTER (WHERE status = 'funded')   AS active,
              COUNT(*) FILTER (WHERE status = 'released') AS released
       FROM escrows
       WHERE created_at >= $1`,
      [since]
    ),

    // Dispute rate
    pool.query(
      `SELECT
         COUNT(*)                                              AS total,
         COUNT(*) FILTER (WHERE status = 'disputed')          AS disputed,
         ROUND(
           COUNT(*) FILTER (WHERE status = 'disputed')::numeric /
           NULLIF(COUNT(*)::numeric, 0) * 100, 2
         ) AS dispute_rate_pct
       FROM jobs
       WHERE created_at >= $1 AND deleted_at IS NULL`,
      [since]
    ),

    // New users this week
    pool.query(
      `SELECT COUNT(*) AS new_users,
              COUNT(*) FILTER (WHERE role IN ('freelancer','both')) AS new_freelancers,
              COUNT(*) FILTER (WHERE role IN ('client','both'))     AS new_clients
       FROM profiles
       WHERE created_at >= $1 AND deleted_at IS NULL`,
      [since]
    ),

    // Top 5 categories by job count
    pool.query(
      `SELECT category, COUNT(*) AS job_count
       FROM jobs
       WHERE created_at >= $1 AND deleted_at IS NULL
       GROUP BY category
       ORDER BY job_count DESC
       LIMIT 5`,
      [since]
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    weekStart: since.toISOString(),
    jobs: jobs.rows[0],
    escrow: escrow.rows[0],
    disputes: disputes.rows[0],
    users: users.rows[0],
    topCategories: categories.rows,
  };
}

// ─── PDF generation ───────────────────────────────────────────────────────────

const BRAND_GOLD  = "#f59e0b";
const BRAND_DARK  = "#1a1a2e";
const TEXT_MAIN   = "#1f2937";
const TEXT_MUTED  = "#6b7280";
const LINE_COLOR  = "#e5e7eb";

/**
 * Generate a PDF report as a Buffer.
 *
 * @param {Object} data  Result from gatherReportData()
 * @returns {Promise<Buffer>}
 */
function generatePdf(data) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: "Stellar MarketPay — Weekly Admin Report",
        Author: "Stellar MarketPay Platform",
        Subject: "Weekly platform health summary",
        CreationDate: new Date(),
      },
    });

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // ── Header banner ──────────────────────────────────────────────────────
    doc
      .rect(0, 0, doc.page.width, 100)
      .fill(BRAND_DARK);

    doc
      .fillColor(BRAND_GOLD)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text("✦ Stellar MarketPay", left, 28)
      .fillColor("#ffffff")
      .font("Helvetica")
      .fontSize(12)
      .text("Weekly Admin Report", left, 58)
      .text(
        `Generated: ${new Date(data.generatedAt).toUTCString()}`,
        left, 75,
        { align: "left" }
      );

    // ── Period label ───────────────────────────────────────────────────────
    doc.moveDown(4);
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(10)
      .text(
        `Report period: ${new Date(data.weekStart).toDateString()} → ${new Date(data.generatedAt).toDateString()}`,
        left
      );

    // ── Section helper ─────────────────────────────────────────────────────
    function sectionTitle(title) {
      doc.moveDown(1.2);
      doc
        .moveTo(left, doc.y)
        .lineTo(left + pageWidth, doc.y)
        .strokeColor(LINE_COLOR)
        .lineWidth(1)
        .stroke();
      doc.moveDown(0.4);
      doc
        .fillColor(BRAND_DARK)
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(title, left);
      doc.moveDown(0.5);
    }

    function kv(label, value, indent = 0) {
      const x = left + indent;
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor(TEXT_MUTED)
        .text(label, x, doc.y, { continued: true, width: 220 })
        .fillColor(TEXT_MAIN)
        .font("Helvetica-Bold")
        .text(String(value ?? "—"), { align: "left" });
    }

    // ── Jobs section ───────────────────────────────────────────────────────
    sectionTitle("Job Activity");
    kv("New jobs this week:",   data.jobs.new_jobs);
    kv("Open jobs:",            data.jobs.open_jobs);
    kv("Completed jobs:",       data.jobs.completed_jobs);
    kv("Total budget posted:",  `${parseFloat(data.jobs.total_budget).toFixed(2)} XLM`);

    // ── Escrow section ─────────────────────────────────────────────────────
    sectionTitle("Escrow Volume");
    kv("Total volume funded:",  `${parseFloat(data.escrow.total_volume).toFixed(2)} XLM`);
    kv("Active escrows:",       data.escrow.active);
    kv("Released escrows:",     data.escrow.released);

    // ── Disputes section ───────────────────────────────────────────────────
    sectionTitle("Disputes");
    kv("Total jobs:",           data.disputes.total);
    kv("Disputed:",             data.disputes.disputed);
    kv("Dispute rate:",         `${data.disputes.dispute_rate_pct ?? "0.00"}%`);

    // ── Users section ──────────────────────────────────────────────────────
    sectionTitle("User Growth");
    kv("New users this week:",  data.users.new_users);
    kv("New freelancers:",      data.users.new_freelancers);
    kv("New clients:",          data.users.new_clients);

    // ── Top categories table ───────────────────────────────────────────────
    sectionTitle("Top Categories");
    const colW = pageWidth / 2;

    doc
      .rect(left, doc.y, pageWidth, 18)
      .fill("#f3f4f6");

    const tableHeaderY = doc.y + 4;
    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("Category", left + 6, tableHeaderY)
      .text("Jobs", left + colW, tableHeaderY, { align: "left" });

    doc.moveDown(1.2);

    data.topCategories.forEach((row, i) => {
      if (i % 2 === 0) {
        doc.rect(left, doc.y - 2, pageWidth, 16).fill("#fafafa");
      }
      doc
        .fillColor(TEXT_MAIN)
        .font("Helvetica")
        .fontSize(10)
        .text(row.category || "—", left + 6, doc.y, { continued: true, width: colW - 12 })
        .text(String(row.job_count), { align: "left" });
    });

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = doc.page.height - doc.page.margins.bottom - 20;
    doc
      .moveTo(left, footerY)
      .lineTo(left + pageWidth, footerY)
      .strokeColor(LINE_COLOR)
      .lineWidth(0.5)
      .stroke();

    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text(
        "This report is confidential and intended for Stellar MarketPay administrators only.",
        left,
        footerY + 6,
        { align: "center", width: pageWidth }
      );

    doc.end();
  });
}

// ─── S3 upload / download ─────────────────────────────────────────────────────

/**
 * Upload a PDF buffer to S3-compatible storage.
 * If S3 is not configured, stores the buffer in memory as a module-level
 * fallback (suitable for development / single-instance deployments).
 *
 * @param {Buffer} pdfBuffer
 * @param {string} key  S3 object key
 * @returns {Promise<{ stored: boolean, location: string }>}
 */
let _inMemoryReport = null; // fallback when S3 is not configured

async function uploadToS3(pdfBuffer, key = S3_KEY) {
  const s3 = getS3Client();

  if (!s3) {
    logger.warn("S3 not configured — storing report in memory (single-instance fallback)");
    _inMemoryReport = { buffer: pdfBuffer, key, updatedAt: new Date().toISOString() };
    return { stored: true, location: "memory" };
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: pdfBuffer,
      ContentType: "application/pdf",
      ContentDisposition: `attachment; filename="weekly-report-${new Date().toISOString().split("T")[0]}.pdf"`,
      Metadata: {
        generatedAt: new Date().toISOString(),
      },
    })
  );

  const location = `s3://${S3_BUCKET}/${key}`;
  logger.info({ bucket: S3_BUCKET, key, bytes: pdfBuffer.length }, "Report uploaded to S3");
  return { stored: true, location };
}

/**
 * Retrieve the latest PDF report buffer.
 * Returns null if no report has been generated yet.
 *
 * @returns {Promise<Buffer|null>}
 */
async function downloadLatestFromS3() {
  const s3 = getS3Client();

  if (!s3) {
    return _inMemoryReport ? _inMemoryReport.buffer : null;
  }

  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: S3_KEY })
    );

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Generate the weekly admin PDF report, upload to S3, and email to admins.
 *
 * @param {Function} sendEmailFn  async ({ to, subject, text, html, attachments }) => void
 * @returns {Promise<{ success: boolean, location: string, emailsSent: number }>}
 */
async function generateAndSendAdminReport(sendEmailFn) {
  logger.info("Starting weekly admin PDF report generation");

  // 1. Gather data
  const data = await gatherReportData();
  logger.info({ weekStart: data.weekStart }, "Report data gathered");

  // 2. Generate PDF
  const pdfBuffer = await generatePdf(data);
  logger.info({ bytes: pdfBuffer.length }, "PDF generated");

  // 3. Upload to S3
  const { location } = await uploadToS3(pdfBuffer);

  // 4. Email to admins
  const adminEmails = (process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  let emailsSent = 0;

  if (adminEmails.length === 0) {
    logger.warn("ADMIN_EMAIL is not set — skipping report email");
  } else if (typeof sendEmailFn !== "function") {
    logger.warn("No sendEmailFn provided — skipping report email");
  } else {
    const reportDate = new Date(data.generatedAt).toDateString();
    const subject = `Stellar MarketPay — Weekly Admin Report (${reportDate})`;
    const text = [
      subject,
      "",
      `Platform Health Summary — ${data.weekStart} to ${data.generatedAt}`,
      "",
      `New jobs this week : ${data.jobs.new_jobs}`,
      `Total escrow volume: ${parseFloat(data.escrow.total_volume).toFixed(2)} XLM`,
      `Dispute rate       : ${data.disputes.dispute_rate_pct ?? "0.00"}%`,
      `New users          : ${data.users.new_users}`,
      "",
      "The full PDF report is attached.",
    ].join("\n");

    for (const to of adminEmails) {
      try {
        await sendEmailFn({
          to,
          subject,
          text,
          attachments: [
            {
              filename: `weekly-report-${new Date().toISOString().split("T")[0]}.pdf`,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ],
        });
        emailsSent++;
        logger.info({ to }, "Admin report email sent");
      } catch (err) {
        logError(logger, err, { operation: "send_admin_report_email", to });
      }
    }
  }

  logger.info({ location, emailsSent }, "Weekly admin report complete");
  return { success: true, location, emailsSent };
}

module.exports = {
  generateAndSendAdminReport,
  downloadLatestFromS3,
  gatherReportData,
};
