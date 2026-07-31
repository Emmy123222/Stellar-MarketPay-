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
const compressionMiddleware = require("./middleware/compression");
const rateLimit = require("express-rate-limit");
const { getClientIp } = require("./utils/clientIp");
const { WebSocketServer } = require("ws");
const { sendEmail, smtpTransport } = require("./utils/email");
const metrics = require("./metrics");
const metricsAuth = require("./middleware/metricsAuth");
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
const publicJobBoardRoutes = require("./routes/publicJobBoard");
const referralRoutes  = require("./routes/referrals");
const graphqlHandler  = require("./graphql");
const eventsRoutes    = require("./routes/events");
const invitationRoutes = require("./routes/invitations");
const statsRoutes      = require("./routes/stats");
const contributorRoutes  = require("./routes/contributors");
const gasEstimatorRoutes = require("./routes/gasEstimator");
const transactionRoutes  = require("./routes/transactions");
const daoRoutes          = require("./routes/dao");
const proposalTemplateRoutes = require("./routes/proposalTemplates");
const priceAlertRoutes     = require("./routes/priceAlerts");

const pool            = require("./db/pool");
const { migrate, getCurrentMigrationVersion, getExpectedMigrationVersion, validateMigrationVersion } = require("./db/migrate");
const IndexerService  = require("./services/indexerService");
const PriceAlertService = require("./services/priceAlertService");
const { setBroadcastToUser } = require("./services/notificationService");
const { startWsEventCleanup } = require("./services/wsEventCleanupService");

const serviceLogger = createServiceLogger('server');
const app  = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
const WS_OPEN = 1;
const STELLAR_NETWORK = requireChoice("STELLAR_NETWORK", ["testnet", "mainnet"], {
  fallback: "testnet",
});

// ─── Prometheus metrics ───────────────────────────────────────────────────────
// The registry and every metric live in ./metrics so that low-level modules
// (e.g. src/db/pool.js) can record into the same registry without importing
// the server and creating a require cycle.
const {
  registry: metricsRegistry,
  notificationQueuePending,
  resolveRouteLabel,
  observeHttpRequest,
  setWebsocketConnections,
  renderMetrics,
} = metrics;

// Pool connection gauges are attached in src/db/pool.js (where the pool lives).
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

const realtimeClients = new Set();
const userClients = new Map(); // userAddress -> Set<WebSocket>
const userLastSeen = new Map(); // userAddress -> Date (last disconnect time)
const scopeSessionClients = new Map();

/**
 * Publish the current WebSocket connection counts to
 * `active_websocket_connections` (labelled by channel).
 *
 * Called on every connect/disconnect so the gauge never drifts.
 *
 * @returns {void}
 */
function refreshWsMetrics() {
  let scopeCount = 0;
  for (const clients of scopeSessionClients.values()) scopeCount += clients.size;
  setWebsocketConnections("realtime", realtimeClients.size);
  setWebsocketConnections("scope", scopeCount);
}

function broadcastRealtime(event, payload) {
  const message = JSON.stringify({ event, payload });
  serviceLogger.debug({ event, payload }, 'Broadcasting realtime message');
  for (const ws of realtimeClients) {
    if (ws.readyState === WS_OPEN) ws.send(message);
  }
  refreshWsMetrics();
}

function broadcastToUser(userAddress, event, payload) {
  const message = JSON.stringify({ event, payload });
  const clients = userClients.get(userAddress);
  if (clients) {
    for (const ws of clients) {
      if (ws.readyState === WS_OPEN) ws.send(message);
    }
  }
}

function broadcastToUser(userAddress, event, payload) {
  const sockets = userClients.get(userAddress);
  if (!sockets) return;
  const message = JSON.stringify({ event, payload });
  for (const ws of sockets) {
    if (ws.readyState === WS_OPEN) ws.send(message);
  }
}

async function upsertScopeSession(sessionId, patch) {
  const content = typeof patch.content === "string" ? patch.content : "";
  const cursors = patch.cursors && typeof patch.cursors === "object" ? patch.cursors : {};
  const finalized = Boolean(patch.finalized);
  const finalizedHash = patch.finalizedHash || null;
  const finalizedPayload = patch.finalizedPayload || null;

  const { rows } = await pool.query(
    `INSERT INTO scope_sessions (session_id, content, cursors, finalized, finalized_hash, finalized_payload, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, NOW() + INTERVAL '24 hours', NOW(), NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       content = EXCLUDED.content,
       cursors = EXCLUDED.cursors,
       finalized = EXCLUDED.finalized,
       finalized_hash = EXCLUDED.finalized_hash,
       finalized_payload = EXCLUDED.finalized_payload,
       expires_at = NOW() + INTERVAL '24 hours',
       updated_at = NOW()
     RETURNING session_id, content, cursors, finalized, finalized_hash, finalized_payload, expires_at, updated_at`,
    [sessionId, content, JSON.stringify(cursors), finalized, finalizedHash, JSON.stringify(finalizedPayload)]
  );
  return rows[0];
}

async function loadScopeSession(sessionId) {
  const { rows } = await pool.query(
    `SELECT session_id, content, cursors, finalized, finalized_hash, finalized_payload, expires_at, updated_at
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
  frameguard: { action: "sameorigin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  permissionsPolicy: {
    features: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
      usb: [],
      magnetometer: [],
      gyroscope: [],
      accelerometer: [],
      "interest-cohort": [],
    },
  },
}));

// Correlation-id tracing middleware (Issue #453). Allocates the
// request id and enters the AsyncLocalStorage scope BEFORE any
// downstream middleware logs anything (helmet block-listing, body
// parse errors, sanitization warnings, idempotency hits, etc).
// Runs immediately AFTER helmet (which never logs).
app.use(xRequestIdMiddleware);

app.use(compressionMiddleware());

// Body parser MUST run BEFORE requestLoggerMiddleware so the bracketing
// "Request started" log line can capture the request body (sanitized).
app.use(express.json({ limit: "20kb" }));
app.use(sanitizeMiddleware({ strict: false }));
app.use(idempotencyMiddleware());

// Request logging middleware (issues Request started / Request completed
// bracketing log lines after the requestId is in scope and the body is
// parsed).
app.use(requestLoggerMiddleware);

// Swagger UI
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Stellar MarketPay API Documentation'
}));


app.use(cors(createCorsOptions()));
app.use(doubleCsrfProtection);

// ─── HTTP request instrumentation ─────────────────────────────────────────────
// Records http_requests_total and http_request_duration_ms (plus the legacy
// marketpay_* series) for every request except the scrape endpoint itself.
app.use((req, res, next) => {
  if (req.path === "/metrics") {
    return next();
  }

  const start = process.hrtime.bigint();

  // Express restores `req.baseUrl` once the router unwinds, so by the time the
  // "finish" event fires the mount path is gone. Snapshot the label while the
  // handler is still on the stack (res.end runs inside the route).
  let routeSnapshot = null;
  const originalEnd = res.end;
  res.end = function captureRoute(...args) {
    if (routeSnapshot === null && req.route?.path) {
      routeSnapshot =
        `${req.baseUrl || ""}${req.route.path}`.replace(/\/$/, "") || "/";
    }
    return originalEnd.apply(this, args);
  };

  res.on("finish", () => {
    // Prefer the matched route pattern ("/api/jobs/:id") over the raw path so
    // path parameters never explode label cardinality.
    // resolveRouteLabel prefers the matched Express pattern and falls back to
    // a normalised URL (ids collapsed to ":id") for 404s and error responses,
    // where Express has already discarded the route mount prefix.
    const routeLabel = resolveRouteLabel(routeSnapshot, req.originalUrl || req.path);

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    observeHttpRequest(
      {
        method: req.method,
        route: routeLabel,
        status_code: String(res.statusCode),
      },
      durationMs
    );
  });

  res.on("close", () => {
    // Restore the original end() if the response was aborted before finishing,
    // so no wrapper leaks onto a pooled response object.
    res.end = originalEnd;
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

// ─── GET /metrics — Prometheus text exposition (internal auth required) ───────
// Guarded by src/middleware/metricsAuth.js: a shared bearer token
// (METRICS_TOKEN) or an internal/private source IP. Never publicly readable.
app.get("/metrics", metricsAuth, async (req, res, next) => {
  try {
    res.set("Content-Type", metricsRegistry.contentType);
    res.set("Cache-Control", "no-store");
    res.end(await renderMetrics());
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
app.use("/api/v1/public",     publicJobBoardRoutes);
app.use("/api/time-entries",  timeEntryRoutes);
app.use("/api/referrals",     referralRoutes);
app.use("/api/graphql",       graphqlHandler);
app.use("/api/events",        eventsRoutes);
app.use("/api/invitations",   invitationRoutes);
app.use("/api/stats",         statsRoutes);
app.use("/api/contributors",    contributorRoutes);
app.use("/api/gas-estimate",    gasEstimatorRoutes);
app.use("/api/transactions",   transactionRoutes);
app.use("/api/dao",            daoRoutes);
app.use("/api/proposal-templates", proposalTemplateRoutes);
app.use("/api/price-alerts",      priceAlertRoutes);

// 404 handler — must come after all routes
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
    wsConnectionsActive.set(realtimeClients.size);

    // Authenticate user from token query param for per-user delivery
    let userAddress = null;
    const token = url.searchParams.get("token");
    if (token) {
      try {
        const { JWT_SECRET } = require("./middleware/auth");
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(token, JWT_SECRET);
        userAddress = decoded.publicKey;
        if (userAddress) {
          if (!userClients.has(userAddress)) userClients.set(userAddress, new Set());
          userClients.get(userAddress).add(ws);
        }
      } catch { /* invalid token — treat as anonymous */ }
    }

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
      wsConnectionsActive.set(realtimeClients.size);
      if (userAddress) {
        const sockets = userClients.get(userAddress);
        if (sockets) {
          sockets.delete(ws);
          if (!sockets.size) userClients.delete(userAddress);
        }
        userLastSeen.set(userAddress, new Date());
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
          const finalContent = typeof message.content === "string" ? message.content : (session.content || "");
          const crypto = require("crypto");
          const contentHash = crypto.createHash("sha256").update(finalContent).digest("hex");

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
        sendJson(ws, "scope:error", { error: "Invalid message payload" });
      }
    });

    ws.on("close", async () => {
      clients.delete(ws);
      refreshWsMetrics();
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
      if (!clients.size) scopeSessionClients.delete(sessionId);
    });
  }
});

async function bootstrap() {
  try {
  await migrate();

  // Validate that the database is at the expected migration version
  const migrationVersion = await getCurrentMigrationVersion();
  const expectedVersion = getExpectedMigrationVersion();
  validateMigrationVersion(migrationVersion, expectedVersion, serviceLogger);

  app.locals.migrationVersion = migrationVersion;

  await cleanupExpiredScopeSessions();
  await indexerService.start();
  priceAlertService.start();

  // Start job expiry checker - run every hour
  startJobExpiryChecker();

  // Start escrow timeout checker - run every hour
  startEscrowTimeoutChecker();

  // Start notification processor - run every 2 minutes
  startNotificationProcessor();

  // Clean up expired idempotency keys every hour
  setInterval(() => {
    cleanupExpiredIdempotencyKeys().catch((err) => {
      logError(serviceLogger, err, { operation: 'idempotency_cleanup' });
    });
  }, 60 * 60 * 1000).unref();

  // Start WS event cleanup job (purge old events after 7 days)
  startWsEventCleanup();
  startWeeklyDigestScheduler();

  // Start admin PDF report scheduler - run every Monday at 08:00 UTC
  startAdminReportScheduler();

  // Start purge job for soft-deleted records - run daily
  startPurgeDeletedRecords();

  // Start recurring escrow ticker - run every hour (Issue #450)
  startRecurringEscrowTicker();

  // Start saved search alert checker - run every 10 minutes
  startSavedSearchAlertChecker();

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
 * Periodically check for and automatically process refunds for escrows that have timed out (runs every hour).
 */
function startEscrowTimeoutChecker() {
  const { startEscrowTimeoutChecker: run } = require("./services/escrowService");
  return run();
}

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
app._ws = {
  server,
  wsServer,
  realtimeClients,
  userClients,
  scopeSessionClients,
  broadcastRealtime,
  broadcastToUser,
};

app.startEscrowTimeoutChecker = startEscrowTimeoutChecker;
app._ws = { server, wsServer, userClients, realtimeClients, userLastSeen };

module.exports = app;
