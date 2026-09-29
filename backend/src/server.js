/* eslint-disable */
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
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const compressionMiddleware = require("./middleware/compression");
const rateLimit = require("express-rate-limit");
const { getClientIp } = require("./utils/clientIp");
const { WebSocketServer } = require("ws");
const nodemailer = require("nodemailer");
const { sendEmail, smtpTransport: smtpTransportUtils } = require("./utils/email");
const promClient = require("prom-client");
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
const { requestLoggerMiddleware, xRequestIdMiddleware, logError, createServiceLogger } = require('./utils/logger');
const { sanitizeMiddleware } = require('./middleware/sanitize');
const { idempotencyMiddleware, cleanupExpiredIdempotencyKeys } = require('./middleware/idempotency');
const { getRateLimitScale } = require("./middleware/rateLimiter");
const { requireChoice } = require("./config/env");
const { createCorsOptions } = require("./config/cors");
const { doubleCsrfProtection } = require("./middleware/csrf");
const { structuredErrorHandler } = require("./utils/errors");
const { jsonDepthLimitMiddleware } = require("./middleware/jsonbValidator");

const jobRoutes       = require("./routes/jobs");
const applicationRoutes = require("./routes/applications");
const profileRoutes   = require("./routes/profiles");
const onboardingRoutes = require("./routes/onboarding");
const escrowRoutes    = require("./routes/escrow");
const healthRoutes    = require("./routes/health");
const pingRoutes      = require("./routes/ping");
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
const graphqlHandler  = require("./graphql");
const eventsRoutes    = require("./routes/events");
const invitationRoutes = require("./routes/invitations");
const statsRoutes      = require("./routes/stats");
const contributorRoutes = require("./routes/contributors");
const verificationRoutes = require("./routes/verification");
const nftRoutes          = require("./routes/nft");
const aiScorerRoutes     = require("./routes/aiScorer");
const gasEstimatorRoutes = require("./routes/gasEstimator");
const transactionRoutes  = require("./routes/transactions");
const daoRoutes          = require("./routes/dao");
const proposalTemplateRoutes = require("./routes/proposalTemplates");
const contributorsRoutes = require("./routes/contributors");
const priceAlertsRoutes  = require("./routes/priceAlerts");
const turretRoutes       = require("./routes/turrets");
const reputationRoutes   = require("./routes/reputation");
const autoConvertRoutes  = require("./routes/autoConvert");
const scopeRoutes        = require("./routes/scope");
const analyticsRoutes    = require("./routes/analytics");
const searchRoutes       = require("./routes/search");

const pool            = require("./db/pool");
const { migrate } = require("./db/migrate");
const IndexerService  = require("./services/indexerService");
const PriceAlertService = require("./services/priceAlertService");
const { setBroadcastToUser } = require("./services/notificationService");
const { startSavedSearchAlertChecker } = require("./services/savedSearchAlertService");
const { scheduleStatsRefresh } = require("./services/statsService");
const { startPushSubscriptionPurge } = require("./services/pushSubscriptionService");
const { startLinkVerificationScheduler } = require("./services/linkVerificationScheduler");

const {
  upsertScopeSession,
  loadScopeSession,
  cleanupExpiredScopeSessions,
  MAX_CONTENT_LENGTH,
} = require("./routes/scope");

require("./workers/auditWorker");
require("./workers/linkVerificationWorker");

const serviceLogger = createServiceLogger('server');

const app  = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const WS_OPEN = 1;
const STELLAR_NETWORK = requireChoice("STELLAR_NETWORK", ["testnet", "mainnet"], {
  fallback: "testnet",
});
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const MAX_WS_CONNECTIONS_PER_USER = Number(process.env.MAX_WS_CONNECTIONS_PER_USER || 10);

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

const pgPoolTotal = new promClient.Gauge({
  name: "pg_pool_total",
  help: "Total PostgreSQL pool connections",
  registers: [metricsRegistry],
});

const pgPoolIdle = new promClient.Gauge({
  name: "pg_pool_idle",
  help: "Idle PostgreSQL pool connections",
  registers: [metricsRegistry],
});

const pgPoolWaiting = new promClient.Gauge({
  name: "pg_pool_waiting",
  help: "Waiting PostgreSQL pool requests",
  registers: [metricsRegistry],
});

pgPoolTotal.collect = function collectPgPoolTotal() {
  this.set(pool.totalCount);
};
pgPoolIdle.collect = function collectPgPoolIdle() {
  this.set(pool.idleCount);
};
pgPoolWaiting.collect = function collectPgPoolWaiting() {
  this.set(pool.waitingCount);
};

const wsConnectionsActive = new promClient.Gauge({
  name: "ws_connections_active",
  help: "Active WebSocket connections",
  registers: [metricsRegistry],
});

const notificationQueuePending = new promClient.Gauge({
  name: "notification_queue_pending",
  help: "Pending notifications in the queue",
  registers: [metricsRegistry],
});

notificationQueuePending.collect = async function collectNotificationQueue() {
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM notification_queue WHERE status = 'pending'"
    );
    this.set(rows[0]?.cnt || 0);
  } catch {
    this.set(0);
  }
};

let poolWaitingSince = null;
const POOL_ALERT_THRESHOLD = 5;
const POOL_ALERT_INTERVAL_MS = 10_000;

function checkPoolHealth() {
  const waiting = pool.waitingCount;
  if (waiting > POOL_ALERT_THRESHOLD) {
    if (!poolWaitingSince) {
      poolWaitingSince = Date.now();
    } else if (Date.now() - poolWaitingSince > POOL_ALERT_INTERVAL_MS) {
      serviceLogger.error({
        waiting,
        total: pool.totalCount,
        idle: pool.idleCount,
        duration_ms: Date.now() - poolWaitingSince,
      }, "Database pool exhausted: requests queuing for >10s");
      const webhookUrl = process.env.POOL_ALERT_WEBHOOK_URL;
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alert: "pg_pool_exhausted",
            waiting,
            total: pool.totalCount,
            idle: pool.idleCount,
            timestamp: new Date().toISOString(),
          }),
        }).catch(() => {});
      }
      poolWaitingSince = Date.now();
    }
  } else {
    poolWaitingSince = null;
  }
}

setInterval(checkPoolHealth, 1000).unref();

function setWebsocketConnections(_channel, count) {
  wsConnectionsActive.set(count);
}

function refreshWsMetrics() {
  let total = realtimeClients.size;
  for (const clients of scopeSessionClients.values()) {
    total += clients.size;
  }
  wsConnectionsActive.set(total);
}

const realtimeClients = new Set();
const userClients = new Map();
const userLastSeen = new Map();
const scopeSessionClients = new Map();

function broadcastRealtime(event, payload) {
  const message = JSON.stringify({ event, payload });
  serviceLogger.debug({ event, payload }, 'Broadcasting realtime message');
  for (const ws of realtimeClients) {
    if (ws.readyState === WS_OPEN) ws.send(message);
  }
  wsConnectionsActive.set(realtimeClients.size);
}

function broadcastToUser(userAddress, event, payload) {
  if (!userAddress) return;
  const clients = userClients.get(userAddress);
  if (!clients || clients.size === 0) return;
  const message = JSON.stringify({ event, payload });
  for (const ws of clients) {
    if (ws.readyState === WS_OPEN) ws.send(message);
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
  ? smtpTransportUtils || nodemailer.createTransport({
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
    await sendEmail({ to, subject, text });
  },
});

app.locals.indexerService = indexerService;
app.locals.broadcastRealtime = broadcastRealtime;
app.locals.broadcastToUser = broadcastToUser;
setBroadcastToUser(broadcastToUser);

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

app.use(xRequestIdMiddleware);
app.use(compressionMiddleware());
app.use(express.json({ limit: "20kb" }));
app.use(sanitizeMiddleware({ strict: false }));
app.use(idempotencyMiddleware());
app.use(requestLoggerMiddleware);

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Stellar MarketPay API Documentation'
}));

app.use(cors(createCorsOptions()));
app.use(doubleCsrfProtection);

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
  max: Math.max(1, Math.floor(150 * getRateLimitScale())),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
}));

app.get("/metrics", async (req, res, next) => {
  try {
    const metricsSecret = process.env.METRICS_SECRET;
    if (metricsSecret) {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (token !== metricsSecret) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }
    res.set("Content-Type", metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  } catch (error) {
    next(error);
  }
});

app.use("/health",            healthRoutes);
app.use("/ping",              pingRoutes);
app.use("/api/auth",          authRoutes);
app.use("/api/jobs",          jobRoutes);
app.use("/api/applications",  applicationRoutes);
app.use("/api/profiles",      profileRoutes);
app.use("/api/freelancers",   profileRoutes);
app.use("/api/onboarding",    onboardingRoutes);
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
app.use("/api/graphql",       graphqlHandler);
app.use("/api/events",        eventsRoutes);
app.use("/api/invitations",   invitationRoutes);
app.use("/api/stats",         statsRoutes);
app.use("/api/contributors",  contributorsRoutes);
app.use("/api/verification",  verificationRoutes);
app.use("/api/nft",           nftRoutes);
app.use("/api/ai-scorer",     aiScorerRoutes);

app.get("/api/indexer/health", (req, res) => {
  res.json({
    status: "ok",
    indexer: indexerService.getHealth(),
  });
});

app.use("/api/scope",             scopeRoutes);
app.use("/api/gas-estimate",      gasEstimatorRoutes);
app.use("/api/transactions",      transactionRoutes);
app.use("/api/dao",               daoRoutes);
app.use("/api/proposal-templates", proposalTemplateRoutes);
app.use("/api/price-alerts",      priceAlertsRoutes);
app.use("/api/turrets",           turretRoutes);
app.use("/api/reputation",        reputationRoutes);
app.use("/api/auto-convert",      autoConvertRoutes);
app.use("/api/analytics",         analyticsRoutes);
app.use("/api/search",            searchRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use((err, req, res, next) => {
  logError(req.logger || serviceLogger, err, {
    method: req.method,
    path: req.path,
    userId: req.user?.publicKey,
    requestId: req.requestId,
  });
  structuredErrorHandler(err, req, res, next);
});

function parseWsCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const name = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getWsToken(request) {
  const cookies = parseWsCookies(request.headers.cookie);
  if (cookies.token) return cookies.token;
  const url = new URL(request.url, `http://${request.headers.host}`);
  return url.searchParams.get("token") || null;
}

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
    const token = getWsToken(request);
    let userAddress = null;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userAddress = decoded.publicKey;
        ws.user = decoded;
      } catch {
        ws.close(4001, "Unauthorized: Invalid or expired token");
        return;
      }
    }
    if (userAddress) {
      const existing = userClients.get(userAddress);
      if (existing && existing.size >= MAX_WS_CONNECTIONS_PER_USER) {
        sendJson(ws, "error", {
          error: `Connection limit of ${MAX_WS_CONNECTIONS_PER_USER} reached for this account`,
        });
        ws.close(1008, "Too many connections");
        return;
      }
    }
    realtimeClients.add(ws);
    wsConnectionsActive.set(realtimeClients.size);
    sendJson(ws, "connected", { channel: "realtime" });

    if (userAddress) {
      if (!userClients.has(userAddress)) userClients.set(userAddress, new Set());
      userClients.get(userAddress).add(ws);
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
      wsConnectionsActive.set(realtimeClients.size);
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
    refreshWsMetrics();

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
      finalizedHash: session.finalized_hash || null,
      finalizedPayload: session.finalized_payload || null,
      expiresAt: session.expires_at,
    });

    ws.on("message", async (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (!message || typeof message !== "object") return;
        if (message.type === "scope:update") {
          if (
            typeof message.content === "string" &&
            message.content.length > MAX_CONTENT_LENGTH
          ) {
            sendJson(ws, "scope:error", {
              error: `Payload Too Large: content length ${message.content.length} exceeds maximum limit of ${MAX_CONTENT_LENGTH} characters`,
            });
            return;
          }
          const nextCursors = { ...(session.cursors || {}), ...(message.cursors || {}) };
          session = await upsertScopeSession(sessionId, {
            content: typeof message.content === "string" ? message.content : session.content,
            cursors: nextCursors,
            finalized: false,
            finalizedHash: session.finalized_hash || null,
            finalizedPayload: session.finalized_payload || null,
          });
          for (const client of clients) {
            sendJson(client, "scope:update", {
              sessionId,
              content: session.content,
              cursors: session.cursors || {},
              finalizedHash: session.finalized_hash || null,
              updatedAt: session.updated_at,
            });
          }
          return;
        }

        if (message.type === "scope:finalize") {
          const finalContent =
            typeof message.content === "string"
              ? message.content
              : (session.content || "");
          if (finalContent.length > MAX_CONTENT_LENGTH) {
            sendJson(ws, "scope:error", {
              error: `Payload Too Large: content length ${finalContent.length} exceeds maximum limit of ${MAX_CONTENT_LENGTH} characters`,
            });
            return;
          }
          const crypto = require("crypto");
          const contentHash = crypto
            .createHash("sha256")
            .update(finalContent)
            .digest("hex");

          session = await upsertScopeSession(sessionId, {
            content: finalContent,
            cursors: session.cursors || {},
            finalized: true,
            finalizedHash: contentHash,
            finalizedPayload: message.payload || null,
          });
          for (const client of clients) {
            sendJson(client, "scope:finalized", {
              sessionId,
              content: session.content,
              finalizedHash: contentHash,
              payload: session.finalized_payload || null,
              updatedAt: session.updated_at,
            });
          }
        }
      } catch (error) {
        sendJson(ws, "scope:error", { error: error.message || "Invalid message payload" });
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

  scheduleStatsRefresh();

  startJobExpiryChecker();

  startEscrowTimeoutChecker();

  startNotificationProcessor();

  setInterval(() => {
    cleanupExpiredIdempotencyKeys().catch((err) => {
      logError(serviceLogger, err, { operation: 'idempotency_cleanup' });
    });
  }, 60 * 60 * 1000).unref();

  startWsEventCleanup();
  startWeeklyDigestScheduler();

  startAdminReportScheduler();

  startPurgeDeletedRecords();

  startRecurringEscrowTicker();

  startSavedSearchAlertChecker();

  startPushSubscriptionPurge();

  startLinkVerificationScheduler();

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

  await checkAndExpire();

  setInterval(checkAndExpire, 60 * 60 * 1000).unref();
}

function startEscrowTimeoutChecker() {
  const { startEscrowTimeoutChecker: run } = require("./services/escrowService");
  return run();
}

async function startNotificationProcessor() {
  const { processPendingNotifications } = require("./services/notificationService");
  const notificationLogger = createServiceLogger('notifications');

  const sendEmailFn = async ({ to, subject, text, html }) => {
    await sendEmail({ to, subject, text, html });
  };

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

function startWeeklyDigestScheduler() {
  const weeklyDigestService = require("./services/weeklyDigestService");
  const digestLogger = createServiceLogger("weekly-digest-scheduler");

  const sendEmailFn = async ({ to, subject, text, html }) => {
    await sendEmail({ to, subject, text, html });
  };

  function msUntilNextMonday9amUTC() {
    const now = new Date();
    const target = new Date(now);

    const currentDay = now.getUTCDay();
    const daysUntilMonday = currentDay === 1 ? 0 : (8 - currentDay) % 7 || 7;
    target.setUTCDate(now.getUTCDate() + daysUntilMonday);
    target.setUTCHours(9, 0, 0, 0);

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

  setTimeout(async () => {
    await runDigest();
    setInterval(runDigest, 7 * 24 * 60 * 60 * 1000).unref();
  }, delay).unref();
}

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

function startRecurringEscrowTicker() {
  const { startRecurringEscrowTicker: startTicker } = require("./services/recurringEscrowService");
  startTicker();
}

function startWsEventCleanup() {
  const { cleanupOldWsEvents } = require("./services/wsEventService");
  const cleanupLogger = createServiceLogger("ws-event-cleanup");

  async function cleanup() {
    try {
      const deleted = await cleanupOldWsEvents(7);
      if (deleted > 0) {
        cleanupLogger.info({ deleted }, "Purged WS events older than 7 days");
      }
    } catch (err) {
      logError(cleanupLogger, err, { operation: "ws_event_cleanup" });
    }
  }

  setInterval(cleanup, 24 * 60 * 60 * 1000).unref();
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

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
