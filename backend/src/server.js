/* global userAddress, userLastSeen, userClients, setWebsocketConnections, broadcastToUser, createServiceLogger, sendEmail, logError, startEscrowTimeoutChecker, refreshWsMetrics, startNotificationProcessor, startAdminReportScheduler, startWeeklyDigestScheduler, startPurgeDeletedRecords, startRecurringEscrowTicker */
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
const promClient = require("prom-client");
const compressionMiddleware = require("./middleware/compression");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const { doubleCsrfProtection } = require("./middleware/csrf");
const { getClientIp } = require("./utils/clientIp");
const { WebSocketServer } = require("ws");
const nodemailer = require("nodemailer");
 
// TODO(verify paths): these were used in the original but never imported.
const { createServiceLogger, logError } = require("./utils/logger");
const { sendEmail } = require("./utils/email");
const { requireChoice } = require("./config/env");
const { structuredErrorHandler } = require("./utils/errors");
 
const jobRoutes = require("./routes/jobs");
const applicationRoutes = require("./routes/applications");
const profileRoutes = require("./routes/profiles");
const onboardingRoutes = require("./routes/onboarding");
const escrowRoutes = require("./routes/escrow");
const healthRoutes = require("./routes/health");
const pingRoutes = require("./routes/ping");
const authRoutes = require("./routes/auth");
const ratingRoutes = require("./routes/ratings");
const progressRoutes = require("./routes/progress");
const messageRoutes = require("./routes/messageRoutes");
const insightsRoutes = require("./routes/insights");
const webauthnRoutes = require("./routes/webauthn");
const disputeRoutes = require("./routes/disputes");
const adminRoutes = require("./routes/admin");
const admin2faRoutes = require("./routes/admin2fa");
const timeEntryRoutes = require("./routes/timeEntries");
const notificationRoutes = require("./routes/notifications");
const developerRoutes = require("./routes/developer");
const publicRoutes = require("./routes/public");
const referralRoutes = require("./routes/referrals");
const graphqlHandler = require("./graphql");
const eventsRoutes = require("./routes/events");
const invitationRoutes = require("./routes/invitations");
const jobTemplatesRoutes = require("./routes/jobTemplates");
const sponsorshipRoutes = require("./routes/sponsorship");
const assessmentsRoutes = require("./routes/assessments");
const statsRoutes = require("./routes/stats");
const contributorRoutes = require("./routes/contributors");
const verificationRoutes = require("./routes/verification");
const nftRoutes = require("./routes/nft");
const aiScorerRoutes = require("./routes/aiScorer");
 
const gasEstimatorRoutes = require("./routes/gasEstimator");
const transactionRoutes = require("./routes/transactions");
const daoRoutes = require("./routes/dao");
const proposalTemplateRoutes = require("./routes/proposalTemplates");
const priceAlertRoutes = require("./routes/priceAlerts");
 
const turretRoutes = require("./routes/turrets");
const reputationRoutes = require("./routes/reputation");
const autoConvertRoutes = require("./routes/autoConvert");
const talentPoolRoutes = require("./routes/talentPool");
 
const migrate = require("./db/migrate");
const IndexerService = require("./services/indexerService");
const { PriceAlertService } = require("./services/priceAlertService");
const pool = require("./db/pool");
const anchorRoutes = require("./routes/anchors");
const scopeRoutes = require("./routes/scope");
const analyticsRoutes = require("./routes/analytics");
const searchRoutes = require("./routes/search");
 
const { startEscrowTimeoutChecker } = require("./services/escrowService");
const { scheduleStatsRefresh } = require("./services/statsService");
const { startPushSubscriptionPurge } = require("./services/pushSubscriptionService");
 
const {
  upsertScopeSession,
  loadScopeSession,
  cleanupExpiredScopeSessions,
  MAX_CONTENT_LENGTH,
} = require("./routes/scope");
 
// Workers — audit log writes and link verification
require("./workers/auditWorker");
require("./workers/linkVerificationWorker");
 
const serviceLogger = createServiceLogger("server");
 
const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const WS_OPEN = 1;
const STELLAR_NETWORK = requireChoice("STELLAR_NETWORK", ["testnet", "mainnet"], {
  fallback: "testnet",
});
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const MAX_WS_CONNECTIONS_PER_USER = Number(process.env.MAX_WS_CONNECTIONS_PER_USER || 10);
 
// ─── Metrics ──────────────────────────────────────────────────────────────────
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
 
// ─── Realtime state ───────────────────────────────────────────────────────────
const realtimeClients = new Set();
const userClients = new Map();
const userLastSeen = new Map();
const realtimeRooms = new Map();
const scopeSessionClients = new Map();
 
function setWebsocketConnections(_channel, count) {
  wsConnectionsActive.set(count);
}
 
/** Publish the total WebSocket connection count to the metrics registry. */
function refreshWsMetrics() {
  let total = realtimeClients.size;
  for (const clients of scopeSessionClients.values()) {
    total += clients.size;
  }
  wsConnectionsActive.set(total);
}
 
function subscribeRealtime(ws, roomId) {
  if (typeof roomId !== "string" || !/^(job|user):[^\s:]+$/.test(roomId)) return;
  if (!realtimeRooms.has(roomId)) realtimeRooms.set(roomId, new Set());
  realtimeRooms.get(roomId).add(ws);
  ws.realtimeRooms.add(roomId);
}
 
function unsubscribeRealtime(ws) {
  for (const roomId of ws.realtimeRooms || []) {
    const room = realtimeRooms.get(roomId);
    room?.delete(ws);
    if (room && room.size === 0) realtimeRooms.delete(roomId);
  }
  ws.realtimeRooms?.clear();
}
 
function eventRooms(payload) {
  if (!payload || typeof payload !== "object") return [];
  const rooms = new Set();
  const jobId = payload.jobId ?? payload.job_id;
  const userAddress = payload.userAddress ?? payload.user_address ?? payload.userId;
  if (jobId !== undefined && jobId !== null) rooms.add(`job:${jobId}`);
  if (typeof userAddress === "string" && userAddress) rooms.add(`user:${userAddress}`);
  if (Array.isArray(payload.rooms)) {
    for (const roomId of payload.rooms) if (typeof roomId === "string") rooms.add(roomId);
  }
  if (typeof payload.roomId === "string") rooms.add(payload.roomId);
  return [...rooms];
}
 
function broadcastRealtime(event, payload) {
  const message = JSON.stringify({ event, payload });
  serviceLogger.debug({ event, payload }, "Broadcasting realtime message");
  const roomIds = eventRooms(payload);
  const recipients = roomIds.length
    ? new Set(roomIds.flatMap((roomId) => [...(realtimeRooms.get(roomId) || [])]))
    : realtimeClients;
  for (const ws of recipients) {
    if (ws.readyState === WS_OPEN) ws.send(message);
  }
  refreshWsMetrics();
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
    logError(serviceLogger, err, { operation: "scope_cleanup_interval" });
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
    await sendEmail({ to, subject, text });
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
  allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  credentials: true,
}));
 
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: true }));

// cookie-parser must run before the CSRF guard: csrf-csrf reads `req.cookies`
// to validate the double-submit token and throws if it is undefined.
app.use(cookieParser());
app.use(doubleCsrfProtection);
 
// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/health",            healthRoutes);
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
app.use("/api/stats",         statsRoutes);
app.use("/api/verification",  verificationRoutes);
app.use("/api/nft",           nftRoutes);
app.use("/api/ai-scorer",     aiScorerRoutes);
app.use("/api/anchors",       anchorRoutes);
 
app.get("/api/indexer/health", (req, res) => {
  res.json({
    status: "ok",
    indexer: indexerService.getHealth(),
  });
});
app.use("/api/contributors",       contributorRoutes);
app.use("/api/gas-estimate",       gasEstimatorRoutes);
app.use("/api/transactions",       transactionRoutes);
app.use("/api/dao",                daoRoutes);
app.use("/api/proposal-templates", proposalTemplateRoutes);
app.use("/api/price-alerts",       priceAlertRoutes);
app.use("/api/ai",                 aiScorerRoutes);
app.use("/api/scope",              scopeRoutes);
app.use("/api/turrets",            turretRoutes);
app.use("/api/reputation",         reputationRoutes);
app.use("/api/auto-convert",       autoConvertRoutes);
app.use("/api/talent-pools",       talentPoolRoutes);
app.use("/api/invitations",        rateLimit({ windowMs: 60_000, max: 20 }), invitationRoutes);
app.use("/api/job-templates",      jobTemplatesRoutes);
app.use("/api/sponsorship",        sponsorshipRoutes);
app.use("/api/assessments",        assessmentsRoutes);
app.use("/api/analytics",          analyticsRoutes);
app.use("/api/search",             searchRoutes);
 
// 404 handler — must come after all routes
app.use((req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});
 
app.use((err, req, res, next) => {
  console.error("[Error]", err.message);
  return structuredErrorHandler(err, req, res, next);
});
 
// ─── WebSockets ───────────────────────────────────────────────────────────────
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
    const token = url.searchParams.get("token");
    let userAddress = null;
    if (token) {
      try {
        userAddress = jwt.verify(token, process.env.JWT_SECRET).publicKey || null;
      } catch {
        // Anonymous realtime subscriptions remain supported.
      }
    }
    ws.realtimeRooms = new Set();
    realtimeClients.add(ws);
    if (userAddress) {
      if (!userClients.has(userAddress)) userClients.set(userAddress, new Set());
      userClients.get(userAddress).add(ws);
    }
    refreshWsMetrics();
    const requestedRooms = [
      ...url.searchParams.getAll("room"),
      ...(url.searchParams.get("rooms") || "").split(","),
    ].map((roomId) => roomId.trim()).filter(Boolean);
    requestedRooms.forEach((roomId) => subscribeRealtime(ws, roomId));
    sendJson(ws, "connected", { channel: "realtime" });
 
    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (message?.type === "subscribe" && Array.isArray(message.rooms)) {
          message.rooms.forEach((roomId) => subscribeRealtime(ws, roomId));
          sendJson(ws, "subscribed", { rooms: [...ws.realtimeRooms] });
        }
        if (message?.type === "unsubscribe" && Array.isArray(message.rooms)) {
          for (const roomId of message.rooms) {
            if (typeof roomId !== "string") continue;
            ws.realtimeRooms.delete(roomId);
            const room = realtimeRooms.get(roomId);
            room?.delete(ws);
            if (room && room.size === 0) realtimeRooms.delete(roomId);
          }
          sendJson(ws, "subscribed", { rooms: [...ws.realtimeRooms] });
        }
      } catch { /* ignore malformed subscription messages */ }
    });
 
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
      unsubscribeRealtime(ws);
      refreshWsMetrics();
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
 
// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await migrate();
    await cleanupExpiredScopeSessions();
    await indexerService.start();
    priceAlertService.start();
 
    // Start job expiry checker - run every hour
    startJobExpiryChecker();
 
    // Start invitation cleanup job (purge expired / accepted / declined invitations)
    const { startInvitationCleanup } = require("./services/invitationCleanupService");
    startInvitationCleanup();
 
    // Issue #232 perf: start the 5-minute stats MV refresh cycle after migrations
    scheduleStatsRefresh();
 
    // Start daily purge of push subscriptions marked invalid (Issue #1438)
    startPushSubscriptionPurge();
 
    server.listen(PORT, () => {
      serviceLogger.info({
        port: PORT,
        network: STELLAR_NETWORK,
        nodeEnv: process.env.NODE_ENV || "development",
      }, "Stellar MarketPay API server started");
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
  const expiryLogger = createServiceLogger("job-expiry");
 
  async function checkAndExpire() {
    try {
      const expiredCount = await expireOldJobs();
      if (expiredCount > 0) {
        expiryLogger.info({ expiredCount }, "Auto-expired old jobs");
        broadcastRealtime("jobs:expired", {
          count: expiredCount,
          timestamp: new Date().toISOString(),
        });
      }
 
      // Check for expiring jobs within 3 days and broadcast warnings
      const expiringJobs = await getExpiringJobs(3);
      if (expiringJobs.length > 0) {
        expiryLogger.info({
          expiringCount: expiringJobs.length,
          jobIds: expiringJobs.map(j => j.id),
        }, "Jobs expiring within 3 days");
        broadcastRealtime("job:expiry-warning", {
          count: expiringJobs.length,
          jobs: expiringJobs.map(j => ({
            id: j.id,
            title: j.title,
            expiresAt: j.expiresAt,
          })),
        });
      }
    } catch (err) {
      logError(expiryLogger, err, { operation: "job_expiry_check" });
    }
  }
 
  // Run immediately on startup, then hourly
  await checkAndExpire();
  setInterval(checkAndExpire, 60 * 60 * 1000).unref();
}
 
/**
 * Periodically process pending notifications (runs every 2 minutes).
 */
async function startNotificationProcessor() {
  const { processPendingNotifications } = require("./services/notificationService");
  const notificationLogger = createServiceLogger("notifications");
 
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
        failed: stats.failed,
      }, "Processed pending notifications on startup");
    }
  } catch (err) {
    logError(notificationLogger, err, { operation: "initial_notification_processing" });
  }
 
  // Schedule checks every 2 minutes
  setInterval(async () => {
    try {
      const stats = await processPendingNotifications(sendEmailFn);
      if (stats.total > 0) {
        notificationLogger.info({
          total: stats.total,
          sent: stats.sent,
          failed: stats.failed,
        }, "Processed pending notifications");
      }
    } catch (err) {
      logError(notificationLogger, err, { operation: "scheduled_notification_processing" });
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
  const rotationLogger = createServiceLogger("api-key-rotation");
 
  async function checkAndFinalize() {
    try {
      const finalized = await finalizeExpiredRotations();
      if (finalized.length > 0) {
        rotationLogger.info({ count: finalized.length }, "Finalized expired API key rotations");
      }
    } catch (err) {
      logError(rotationLogger, err, { operation: "api_key_rotation_finalizer" });
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
 
if (process.env.NODE_ENV !== "test") {
  bootstrap();
}
 
// Expose WebSocket internals for testing
app._ws = wsServer;
app._ws.server = server;
app._ws.wsServer = wsServer;
app._ws.realtimeClients = realtimeClients;
app._ws.realtimeRooms = realtimeRooms;
app._ws.userClients = userClients;
app._ws.userLastSeen = userLastSeen;
app._ws.scopeSessionClients = scopeSessionClients;
app._ws.broadcastRealtime = broadcastRealtime;
app._ws.broadcastToUser = (userAddress, event, payload) => broadcastRealtime(event, { ...payload, userAddress });
 
app.startEscrowTimeoutChecker = () => {};
 
module.exports = app;
 
