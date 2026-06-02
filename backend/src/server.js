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
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { getClientIp } = require("./utils/clientIp");
const { WebSocketServer } = require("ws");
const nodemailer = require("nodemailer");
const promClient = require("prom-client");
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
const { requestLoggerMiddleware, logError, createServiceLogger } = require('./utils/logger');
const { sanitizeMiddleware } = require('./middleware/sanitize');
const { requireChoice } = require("./config/env");
const { createCorsOptions } = require("./config/cors");

const jobRoutes       = require("./routes/jobs");
const applicationRoutes = require("./routes/applications");
const profileRoutes   = require("./routes/profiles");
const escrowRoutes    = require("./routes/escrow");
const healthRoutes    = require("./routes/health");
const authRoutes      = require("./routes/auth");
const ratingRoutes    = require("./routes/ratings");
const progressRoutes  = require("./routes/progress");
const messageRoutes   = require("./routes/messageRoutes");
const insightsRoutes  = require("./routes/insights");
const webauthnRoutes  = require("./routes/webauthn");
const disputeRoutes   = require("./routes/disputes");
const adminRoutes     = require("./routes/admin");
const admin2faRoutes  = require("./routes/admin2fa");
const timeEntryRoutes = require("./routes/timeEntries");
const notificationRoutes = require("./routes/notifications");
const developerRoutes = require("./routes/developer");
const publicRoutes    = require("./routes/public");
const referralRoutes  = require("./routes/referrals");
const eventsRoutes    = require("./routes/events");
const invitationRoutes = require("./routes/invitations");
const statsRoutes      = require("./routes/stats");

const pool            = require("./db/pool");
const { migrate } = require("./db/migrate");
const IndexerService  = require("./services/indexerService");
const PriceAlertService = require("./services/priceAlertService");

const serviceLogger = createServiceLogger('server');
const app  = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const WS_OPEN = 1;
const STELLAR_NETWORK = requireChoice("STELLAR_NETWORK", ["testnet", "mainnet"], {
  fallback: "testnet",
});

const metricsRegistry = new promClient.Registry();
promClient.collectDefaultMetrics({
  register: metricsRegistry,
  prefix: "marketpay_",
});

const httpRequestsTotal = new promClient.Counter({
  name: "marketpay_http_requests_total",
  help: "Total HTTP requests handled by the API",
  labelNames: ["method", "route", "status_code"],
  registers: [metricsRegistry],
});

const httpRequestDurationSeconds = new promClient.Histogram({
  name: "marketpay_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

const dbConnectionGauge = new promClient.Gauge({
  name: "marketpay_db_connections",
  help: "Current PostgreSQL pool connection counts",
  labelNames: ["state"],
  registers: [metricsRegistry],
});

dbConnectionGauge.collect = function collectDbConnections() {
  this.set({ state: "total" }, pool.totalCount);
  this.set({ state: "idle" }, pool.idleCount);
  this.set({ state: "waiting" }, pool.waitingCount);
};

const realtimeClients = new Set();
const scopeSessionClients = new Map();

function broadcastRealtime(event, payload) {
  const message = JSON.stringify({ event, payload });
  serviceLogger.debug({ event, payload }, 'Broadcasting realtime message');
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
  try {
    const result = await pool.query("DELETE FROM scope_sessions WHERE expires_at <= NOW()");
    if (result.rowCount > 0) {
      serviceLogger.info({ deletedCount: result.rowCount }, 'Cleaned up expired scope sessions');
    }
  } catch (error) {
    logError(serviceLogger, error, { operation: 'cleanup_scope_sessions' });
  }
}

setInterval(() => {
  cleanupExpiredScopeSessions().catch((err) => {
    logError(serviceLogger, err, { operation: 'scope_cleanup_interval' });
  });
}, 60 * 60 * 1000).unref();

const indexerService = new IndexerService({
  platformWallet: process.env.PLATFORM_WALLET_ADDRESS,
  horizonUrl: process.env.HORIZON_URL,
  contractId: process.env.CONTRACT_ID || process.env.ESCROW_CONTRACT_ID,
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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

// Request logging middleware
app.use(requestLoggerMiddleware);

app.use(compression());

app.use(express.json({ limit: "20kb" }));
app.use(sanitizeMiddleware({ strict: false }));

// Swagger UI
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Stellar MarketPay API Documentation'
}));

app.use(cors(createCorsOptions({ logger: serviceLogger })));

app.use((req, res, next) => {
  if (req.path === "/metrics") {
    return next();
  }

  const endTimer = httpRequestDurationSeconds.startTimer();
  res.on("finish", () => {
    const routeLabel = req.route?.path
      ? `${req.baseUrl || ""}${req.route.path}`
      : req.path;
    const statusCode = String(res.statusCode);

    httpRequestsTotal.inc({
      method: req.method,
      route: routeLabel,
      status_code: statusCode,
    });
    endTimer({
      method: req.method,
      route: routeLabel,
      status_code: statusCode,
    });
  });

  next();
});

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
}));

app.get("/metrics", async (req, res, next) => {
  try {
    res.set("Content-Type", metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  } catch (error) {
    next(error);
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/health",            healthRoutes);
app.use("/api/auth",          authRoutes);
app.use("/api/jobs",          jobRoutes);
app.use("/api/applications",  applicationRoutes);
app.use("/api/profiles",      profileRoutes);
app.use("/api/escrow",        escrowRoutes);
app.use("/api/ratings",       ratingRoutes);
app.use("/api/progress",      progressRoutes);
app.use("/api/messages",      messageRoutes);
app.use("/api/insights",      insightsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/webauthn",      webauthnRoutes);
app.use("/api/disputes",      disputeRoutes);
app.use("/api/admin/2fa",     admin2faRoutes);
app.use("/api/admin",         adminRoutes);
app.use("/api/developer",     developerRoutes);
app.use("/api/public",        publicRoutes);
app.use("/api/time-entries",  timeEntryRoutes);
app.use("/api/referrals",     referralRoutes);
app.use("/api/events",        eventsRoutes);
app.use("/api/invitations",   invitationRoutes);
app.use("/api/stats",         statsRoutes);

app.use((err, req, res, next) => {
  void next;

  logError(req.logger || serviceLogger, err, {
    method: req.method,
    path: req.path,
    userId: req.user?.publicKey,
    requestId: req.requestId,
  });

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
    ws.on("close", () => realtimeClients.delete(ws));
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
      const freshSession = await loadScopeSession(sessionId);
      if (!freshSession) return;
      const nextCursors = { ...(freshSession.cursors || {}) };
      delete nextCursors[participantId];
      await upsertScopeSession(sessionId, {
        content: freshSession.content || "",
        cursors: nextCursors,
        finalized: freshSession.finalized,
        finalizedPayload: freshSession.finalized_payload || null,
      });
      if (!clients.size) scopeSessionClients.delete(sessionId);
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

  // Start notification processor - run every 2 minutes
  startNotificationProcessor();

  // Start weekly digest scheduler - fires every Monday at 09:00 UTC
  startWeeklyDigestScheduler();

  server.listen(PORT, () => {
    serviceLogger.info({
      port: PORT,
      network: STELLAR_NETWORK,
      nodeEnv: process.env.NODE_ENV || "development",
    }, 'Stellar MarketPay API server started');
  });
  } catch (err) {
    logError(serviceLogger, err, { operation: "bootstrap" });
    process.exit(1);
  }
}

/**
 * Periodically check for and expire old jobs (runs every hour).
 * Also sends warning notifications for jobs expiring within 3 days.
 */
async function startJobExpiryChecker() {
  const { expireOldJobs, getExpiringJobs } = require("./services/jobService");
  const expiryLogger = createServiceLogger('job-expiry');

  async function checkAndExpire() {
    try {
      const expiredCount = await expireOldJobs();
      if (expiredCount > 0) {
        expiryLogger.info({ expiredCount }, 'Auto-expired old jobs');
        broadcastRealtime("jobs:expired", { 
          count: expiredCount,
          timestamp: new Date().toISOString()
        });
      }

      // Check for expiring jobs within 3 days and broadcast warnings
      const expiringJobs = await getExpiringJobs(3);
      if (expiringJobs.length > 0) {
        expiryLogger.info({ 
          expiringCount: expiringJobs.length,
          jobIds: expiringJobs.map(j => j.id)
        }, 'Jobs expiring within 3 days');
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
      logError(expiryLogger, err, { operation: 'job_expiry_check' });
    }
  }

  // Run immediately on startup
  await checkAndExpire();

  // Schedule daily checks (86400000 ms = 24 hours)
  // Note: Using 1 hour for better precision as per original, but daily is requested.
  // I'll stick to 1 hour as it's safer and less likely to miss a deadline by much.
  setInterval(checkAndExpire, 60 * 60 * 1000).unref();
}

/**
 * Periodically process pending notifications (runs every 2 minutes).
 */
async function startNotificationProcessor() {
  const { processPendingNotifications } = require("./services/notificationService");
  const notificationLogger = createServiceLogger('notifications');
  
  const sendEmailFn = async ({ to, subject, text, html }) => {
    if (!smtpTransport || !to) return;
    await smtpTransport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
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
    if (!smtpTransport || !to) return;
    await smtpTransport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
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

bootstrap();

module.exports = app;
