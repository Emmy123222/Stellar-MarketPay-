/**
 * src/server.js
 * Stellar MarketPay — Express API server
 */
"use strict";

require("dotenv").config();

const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { WebSocketServer } = require("ws");
const nodemailer = require("nodemailer");

const jobRoutes = require("./routes/jobs");
const applicationRoutes = require("./routes/applications");
const profileRoutes     = require("./routes/profiles");
const escrowRoutes      = require("./routes/escrow");
const healthRoutes      = require("./routes/health");
const authRoutes        = require("./routes/auth");
const ratingRoutes      = require("./routes/ratings");
const progressRoutes    = require("./routes/progress");
const eventRoutes       = require("./routes/events");
const statsRoutes       = require("./routes/stats");
const contributorRoutes = require("./routes/contributors");
const verificationRoutes = require("./routes/verification");
const nftRoutes         = require("./routes/nft");
const aiScorerRoutes    = require("./routes/aiScorer");
const contributorRoutes  = require("./routes/contributors");
const gasEstimatorRoutes = require("./routes/gasEstimator");
const transactionRoutes  = require("./routes/transactions");
const daoRoutes          = require("./routes/dao");
const proposalTemplateRoutes = require("./routes/proposalTemplates");
const priceAlertRoutes     = require("./routes/priceAlerts");
const nftRoutes            = require("./routes/nft");
const turretRoutes         = require("./routes/turrets");

const migrate           = require("./db/migrate");
const IndexerService    = require("./services/indexerService");
const { PriceAlertService } = require("./services/priceAlertService");
const pool              = require("./db/pool");

const app  = express();
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const WS_OPEN = 1;

const realtimeClients = new Set();
const scopeSessionClients = new Map();

function broadcastRealtime(event, payload) {
  const message = JSON.stringify({ event, payload });
  for (const ws of realtimeClients) {
    if (ws.readyState === WS_OPEN) ws.send(message);
  }
}

async function upsertScopeSession(sessionId, patch) {
  const content = typeof patch.content === "string" ? patch.content : "";
  const cursors = patch.cursors && typeof patch.cursors === "object" ? patch.cursors : {};
  const finalized = Boolean(patch.finalized);
  const finalizedPayload = patch.finalizedPayload || null;

  const { rows } = await pool.query(
    `INSERT INTO scope_sessions (session_id, content, cursors, finalized, finalized_payload, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, NOW() + INTERVAL '24 hours', NOW(), NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       content = EXCLUDED.content,
       cursors = EXCLUDED.cursors,
       finalized = EXCLUDED.finalized,
       finalized_payload = EXCLUDED.finalized_payload,
       expires_at = NOW() + INTERVAL '24 hours',
       updated_at = NOW()
     RETURNING session_id, content, cursors, finalized, finalized_payload, expires_at, updated_at`,
    [sessionId, content, JSON.stringify(cursors), finalized, JSON.stringify(finalizedPayload)]
  );
  return rows[0];
}

async function loadScopeSession(sessionId) {
  const { rows } = await pool.query(
    `SELECT session_id, content, cursors, finalized, finalized_payload, expires_at, updated_at
     FROM scope_sessions
     WHERE session_id = $1 AND expires_at > NOW()`,
    [sessionId]
  );
  return rows[0] || null;
}

async function cleanupExpiredScopeSessions() {
  await pool.query("DELETE FROM scope_sessions WHERE expires_at <= NOW()");
}

setInterval(() => {
  cleanupExpiredScopeSessions().catch((err) => {
    console.error("[scope] cleanup failed:", err.message);
  });
}, 60 * 60 * 1000).unref();

const indexerService = new IndexerService({
  platformWallet: process.env.PLATFORM_WALLET_ADDRESS,
  horizonUrl: process.env.HORIZON_URL,
  broadcast: broadcastRealtime,
});
const smtpEnabled = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const smtpTransport = smtpEnabled
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;
const priceAlertService = new PriceAlertService({
  broadcast: broadcastRealtime,
  sendEmail: async ({ to, subject, text }) => {
    if (!smtpTransport || !to) return;
    await smtpTransport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    });
  },
});

app.locals.indexerService = indexerService;
app.locals.broadcastRealtime = broadcastRealtime;

// Middleware
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "20kb" }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error("CORS blocked")),
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/health",            healthRoutes);
app.use("/api/auth",          authRoutes);
app.use("/api/jobs",          jobRoutes);
app.use("/api/applications",  applicationRoutes);
app.use("/api/profiles",      profileRoutes);
app.use("/api/escrow",        escrowRoutes);
app.use("/api/ratings",       ratingRoutes);
app.use("/api/progress",      progressRoutes);
app.use("/api/events",        eventRoutes);
app.use("/api/stats",         statsRoutes);
app.use("/api/contributors",  contributorRoutes);
app.use("/api/verification",  verificationRoutes);
app.use("/api/nft",           nftRoutes);
app.use("/api/ai-scorer",     aiScorerRoutes);

app.get("/api/indexer/health", (req, res) => {
  res.json({
    status: "ok",
    indexer: indexerService.getHealth(),
  });
  return router;
})());
app.use("/api/contributors",    contributorRoutes);
app.use("/api/gas-estimate",    gasEstimatorRoutes);
app.use("/api/transactions",   transactionRoutes);
app.use("/api/dao",            daoRoutes);
app.use("/api/proposal-templates", proposalTemplateRoutes);
app.use("/api/price-alerts",      priceAlertRoutes);
app.use("/api/ai",                aiScorerRoutes);
app.use("/api/nft",               nftRoutes);
app.use("/api/turrets",           turretRoutes);

// 404 handler — must come after all routes
app.use((req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use((err, req, res, _next) => {
  console.error("[Error]", err.message);

  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

const wsServer = new WebSocketServer({ noServer: true });

function sendJson(ws, event, payload) {
  if (ws.readyState === WS_OPEN) {
    ws.send(JSON.stringify({ event, payload }));
  }
}

function getScopeSessionSet(sessionId) {
  if (!scopeSessionClients.has(sessionId)) scopeSessionClients.set(sessionId, new Set());
  return scopeSessionClients.get(sessionId);
}

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/ws/realtime" || url.pathname.startsWith("/ws/scope/")) {
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit("connection", ws, request);
    });
    return;
  }
  socket.destroy();
});

wsServer.on("connection", async (ws, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/ws/realtime") {
    realtimeClients.add(ws);
    sendJson(ws, "connected", { channel: "realtime" });

    // Replay notifications missed while the user was disconnected
    if (userAddress) {
      try {
        const lastSeen = userLastSeen.get(userAddress) || new Date(0);
        const { rows: recent } = await pool.query(
          `SELECT * FROM notifications WHERE user_address = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
          [userAddress, 20],
        );
        const missed = recent
          .filter((n) => new Date(n.created_at) > lastSeen)
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);
        for (const row of missed) {
          sendJson(ws, "notification:created", {
            id: row.id,
            userAddress: row.user_address,
            type: row.type,
            title: row.title,
            body: row.body,
            read: row.read,
            jobId: row.job_id,
            linkPath: row.link_path || (row.job_id ? `/jobs/${row.job_id}` : "/notifications"),
            createdAt: row.created_at,
          });
        }
      } catch { /* non-fatal */ }
    }

    ws.on("close", () => {
      realtimeClients.delete(ws);
      setWebsocketConnections("realtime", realtimeClients.size);
      if (userAddress) {
        userLastSeen.set(userAddress, new Date());
        const sockets = userClients.get(userAddress);
        if (sockets) {
          sockets.delete(ws);
          if (!sockets.size) userClients.delete(userAddress);
        }
      }
    });
    return;
  }

  if (url.pathname.startsWith("/ws/scope/")) {
    const sessionId = decodeURIComponent(url.pathname.replace("/ws/scope/", "")).trim();
    const participantId = (url.searchParams.get("participantId") || `anon-${Date.now()}`).slice(0, 64);
    if (!sessionId) {
      ws.close(1008, "Invalid session id");
      return;
    }

    const clients = getScopeSessionSet(sessionId);
    clients.add(ws);

    let session = await loadScopeSession(sessionId);
    if (!session) {
      session = await upsertScopeSession(sessionId, { content: "", cursors: {}, finalized: false });
    }

    sendJson(ws, "scope:init", {
      sessionId,
      participantId,
      content: session.content || "",
      cursors: session.cursors || {},
      finalized: session.finalized,
      finalizedPayload: session.finalized_payload || null,
      expiresAt: session.expires_at,
    });

    ws.on("message", async (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (!message || typeof message !== "object") return;
        if (message.type === "scope:update") {
          const nextCursors = { ...(session.cursors || {}), ...(message.cursors || {}) };
          session = await upsertScopeSession(sessionId, {
            content: typeof message.content === "string" ? message.content : session.content,
            cursors: nextCursors,
            finalized: false,
            finalizedPayload: session.finalized_payload || null,
          });
          for (const client of clients) {
            sendJson(client, "scope:update", {
              sessionId,
              content: session.content,
              cursors: session.cursors || {},
              updatedAt: session.updated_at,
            });
          }
          return;
        }

        if (message.type === "scope:finalize") {
          session = await upsertScopeSession(sessionId, {
            content: typeof message.content === "string" ? message.content : session.content,
            cursors: session.cursors || {},
            finalized: true,
            finalizedPayload: message.payload || null,
          });
          for (const client of clients) {
            sendJson(client, "scope:finalized", {
              sessionId,
              content: session.content,
              payload: session.finalized_payload || null,
              updatedAt: session.updated_at,
            });
          }
        }
      } catch (error) {
        sendJson(ws, "scope:error", { error: "Invalid message payload" });
      }
    });

    ws.on("close", async () => {
      clients.delete(ws);
      if (!clients.size) scopeSessionClients.delete(sessionId);
      refreshWsMetrics();
      try {
        const freshSession = await loadScopeSession(sessionId);
        if (!freshSession) return;
        const nextCursors = { ...(freshSession.cursors || {}) };
        delete nextCursors[participantId];
        await upsertScopeSession(sessionId, {
          content: freshSession.content || "",
          cursors: nextCursors,
          finalized: freshSession.finalized,
          finalizedHash: freshSession.finalized_hash || null,
          finalizedPayload: freshSession.finalized_payload || null,
        });
      } catch {
        /* ignore close cleanup errors */
      }
    });
  }
});

async function bootstrap() {
  try {
  await migrate();
  await cleanupExpiredScopeSessions();
  await indexerService.start();
  priceAlertService.start();

  // Start job expiry checker - run every hour
  startJobExpiryChecker();

  server.listen(PORT, () => {
    console.log(`
  🏪 Stellar MarketPay API
  🚀 Running at http://localhost:${PORT}
  🌐 Network: ${process.env.STELLAR_NETWORK || "testnet"}
  `);
  });
  } catch (err) {
    console.error("Failed to bootstrap server:", err.message);
    process.exit(1);
  }
}

/**
 * Periodically check for and expire old jobs (runs every hour).
 * Also sends warning notifications for jobs expiring within 3 days.
 */
async function startJobExpiryChecker() {
  const { expireOldJobs, getExpiringJobs } = require("./services/jobService");

  // Run immediately on startup
  try {
    const expiredCount = await expireOldJobs();
    if (expiredCount > 0) {
      console.log(`[job-expiry] Auto-expired ${expiredCount} old job(s)`);
    }
  } catch (err) {
    console.error("[job-expiry] Error on initial expiry check:", err.message);
  }

  // Schedule hourly checks
  setInterval(async () => {
    try {
      const expiredCount = await expireOldJobs();
      if (expiredCount > 0) {
        console.log(`[job-expiry] Auto-expired ${expiredCount} old job(s)`);
      }

      // Check for expiring jobs within 3 days and broadcast warnings
      const expiringJobs = await getExpiringJobs(3);
      if (expiringJobs.length > 0) {
        console.log(`[job-expiry] ${expiringJobs.length} job(s) expiring within 3 days`);
        broadcastRealtime("job:expiry-warning", {
          count: expiringJobs.length,
          jobs: expiringJobs.map(j => ({
            id: j.id,
            title: j.title,
            expiresAt: j.expiresAt
          }))
        });
      }
    } catch (err) {
      console.error("[job-expiry] Error on scheduled check:", err.message);
    }
  }, 60 * 60 * 1000).unref();
}

bootstrap();

/**
 * Periodically process pending notifications (runs every 2 minutes).
 */
async function startNotificationProcessor() {
  const { processPendingNotifications } = require("./services/notificationService");
  const notificationLogger = createServiceLogger('notifications');
  
  const sendEmailFn = async ({ to, subject, text, html }) => {
    await sendEmail({ to, subject, text, html });
  };

  // Run immediately on startup
  try {
    const stats = await processPendingNotifications(sendEmailFn);
    if (stats.total > 0) {
      notificationLogger.info({
        total: stats.total,
        sent: stats.sent,
        failed: stats.failed
      }, 'Processed pending notifications on startup');
    }
  } catch (err) {
    logError(notificationLogger, err, { operation: 'initial_notification_processing' });
  }

  // Schedule checks every 2 minutes
  setInterval(async () => {
    try {
      const stats = await processPendingNotifications(sendEmailFn);
      if (stats.total > 0) {
        notificationLogger.info({
          total: stats.total,
          sent: stats.sent,
          failed: stats.failed
        }, 'Processed pending notifications');
      }
    } catch (err) {
      logError(notificationLogger, err, { operation: 'scheduled_notification_processing' });
    }
  }, 2 * 60 * 1000).unref();
}

/**
 * Periodically finalize expired API key rotations (runs every hour).
 * Keys in rotating state for more than 24 hours get their rotating_key_hash
 * promoted to the active key_hash.
 */
function startApiKeyRotationFinalizer() {
  const { finalizeExpiredRotations } = require("./services/developerService");
  const rotationLogger = createServiceLogger('api-key-rotation');

  async function checkAndFinalize() {
    try {
      const finalized = await finalizeExpiredRotations();
      if (finalized.length > 0) {
        rotationLogger.info({ count: finalized.length }, 'Finalized expired API key rotations');
      }
    } catch (err) {
      logError(rotationLogger, err, { operation: 'api_key_rotation_finalizer' });
    }
  }

  setInterval(checkAndFinalize, 60 * 60 * 1000).unref();
}

/**
 * Schedule the weekly job-digest email for every Monday at 09:00 UTC.
 *
 * Strategy:
 *   1. Compute milliseconds until the next Monday 09:00 UTC.
 *   2. Fire a one-shot setTimeout to hit that exact moment.
 *   3. Inside the callback, run the digest then start a 7-day setInterval
 *      for all subsequent Mondays — avoiding drift from repeated short polls.
 */
function startWeeklyDigestScheduler() {
  const weeklyDigestService = require("./services/weeklyDigestService");
  const digestLogger = createServiceLogger("weekly-digest-scheduler");

  // Reuse the same sendEmail transport already wired for notifications
  const sendEmailFn = async ({ to, subject, text, html }) => {
    await sendEmail({ to, subject, text, html });
  };

  /**
   * Returns the number of milliseconds from now until the next
   * Monday at 09:00:00.000 UTC.  If today is already Monday and
   * it's before 09:00 UTC, fires today; otherwise next Monday.
   */
  function msUntilNextMonday9amUTC() {
    const now = new Date();
    const target = new Date(now);

    // getUTCDay(): 0=Sun, 1=Mon … 6=Sat
    const currentDay = now.getUTCDay();
    const daysUntilMonday = currentDay === 1 ? 0 : (8 - currentDay) % 7 || 7;
    target.setUTCDate(now.getUTCDate() + daysUntilMonday);
    target.setUTCHours(9, 0, 0, 0);

    // If we landed on today-Monday but the window has already passed, push 7 days
    if (target <= now) {
      target.setUTCDate(target.getUTCDate() + 7);
    }

    return target - now;
  }

  async function runDigest() {
    try {
      const stats = await weeklyDigestService.sendWeeklyDigest(sendEmailFn);
      digestLogger.info(stats, "Weekly digest run complete");
    } catch (err) {
      logError(digestLogger, err, { operation: "weekly_digest_run" });
    }
  }

  const delay = msUntilNextMonday9amUTC();
  const nextRun = new Date(Date.now() + delay);

  digestLogger.info(
    { nextRunUTC: nextRun.toISOString(), delayMs: delay },
    "Weekly digest scheduler armed"
  );

  // One-shot: fires at the exact next Monday 09:00 UTC
  setTimeout(async () => {
    await runDigest();
    // Then run every 7 days from that point onward
    setInterval(runDigest, 7 * 24 * 60 * 60 * 1000).unref();
  }, delay).unref();
}

/**
 * Schedule the weekly admin PDF report for every Monday at 08:00 UTC
 * (one hour before the freelancer digest at 09:00 UTC).
 *
 * Uses the same one-shot + 7-day interval pattern as startWeeklyDigestScheduler
 * to avoid drift.
 */
function startAdminReportScheduler() {
  const { generateAndSendAdminReport } = require("./services/adminReportService");
  const reportLogger = createServiceLogger("admin-report-scheduler");

  const sendEmailFn = async (payload) => {
    await sendEmail(payload);
  };

  function msUntilNextMonday8amUTC() {
    const now = new Date();
    const target = new Date(now);
    const currentDay = now.getUTCDay();
    const daysUntilMonday = currentDay === 1 ? 0 : (8 - currentDay) % 7 || 7;
    target.setUTCDate(now.getUTCDate() + daysUntilMonday);
    target.setUTCHours(8, 0, 0, 0);
    if (target <= now) {
      target.setUTCDate(target.getUTCDate() + 7);
    }
    return target - now;
  }

  async function runReport() {
    try {
      const result = await generateAndSendAdminReport(sendEmailFn);
      reportLogger.info(result, "Weekly admin PDF report complete");
    } catch (err) {
      logError(reportLogger, err, { operation: "weekly_admin_report" });
    }
  }

  const delay = msUntilNextMonday8amUTC();
  const nextRun = new Date(Date.now() + delay);

  reportLogger.info(
    { nextRunUTC: nextRun.toISOString(), delayMs: delay },
    "Admin report scheduler armed"
  );

  setTimeout(async () => {
    await runReport();
    setInterval(runReport, 7 * 24 * 60 * 60 * 1000).unref();
  }, delay).unref();
}

/**
 * Periodically purge soft-deleted jobs and profiles older than 90 days (runs daily).
 */
function startPurgeDeletedRecords() {
  const { purgeDeletedJobs } = require("./services/jobService");
  const { purgeDeletedProfiles } = require("./services/profileService");
  const purgeLogger = createServiceLogger("purge-deleted");

  async function purge() {
    try {
      const jobsCount = await purgeDeletedJobs(90);
      const profilesCount = await purgeDeletedProfiles(90);
      if (jobsCount > 0 || profilesCount > 0) {
        purgeLogger.info({ jobsPurged: jobsCount, profilesPurged: profilesCount }, "Purged soft-deleted records older than 90 days");
      }
    } catch (err) {
      logError(purgeLogger, err, { operation: "purge_deleted_records" });
    }
  }

  setInterval(purge, 24 * 60 * 60 * 1000).unref();
}

/**
 * Start the recurring escrow ticker (Issue #450).
 * Ticks recurring escrows every hour to release payments on schedule.
 */
function startRecurringEscrowTicker() {
  const { startRecurringEscrowTicker: startTicker } = require("./services/recurringEscrowService");
  startTicker();
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

// Expose WebSocket internals for testing
app._ws = wsServer;
app._ws.server = server;
app._ws.wsServer = wsServer;
app._ws.realtimeClients = realtimeClients;
app._ws.userClients = userClients;
app._ws.userLastSeen = userLastSeen;
app._ws.scopeSessionClients = scopeSessionClients;
app._ws.broadcastRealtime = broadcastRealtime;
app._ws.broadcastToUser = broadcastToUser;

app.startEscrowTimeoutChecker = startEscrowTimeoutChecker;

module.exports = app;
