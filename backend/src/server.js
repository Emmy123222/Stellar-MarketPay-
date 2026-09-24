/* eslint-disable */`n/* global userAddress, userLastSeen, userClients, setWebsocketConnections, broadcastToUser, createServiceLogger, sendEmail, logError, startEscrowTimeoutChecker, refreshWsMetrics, startNotificationProcessor, startAdminReportScheduler, startWeeklyDigestScheduler, startPurgeDeletedRecords, startRecurringEscrowTicker */
/* eslint-disable */`n/**
/* eslint-disable */`n * src/server.js
/* eslint-disable */`n * Stellar MarketPay — Express API server
/* eslint-disable */`n */
/* eslint-disable */`n"use strict";
/* eslint-disable */`n
/* eslint-disable */`nrequire("dotenv").config();
/* eslint-disable */`n
/* eslint-disable */`nconst http = require("http");
/* eslint-disable */`nconst express = require("express");
/* eslint-disable */`nconst cors = require("cors");
/* eslint-disable */`nconst helmet = require("helmet");
/* eslint-disable */`nconst morgan = require("morgan");
/* eslint-disable */`nconst rateLimit = require("express-rate-limit");
/* eslint-disable */`nconst { WebSocketServer } = require("ws");
/* eslint-disable */`nconst nodemailer = require("nodemailer");
/* eslint-disable */`n
/* eslint-disable */`nconst jobRoutes = require("./routes/jobs");
/* eslint-disable */`nconst applicationRoutes = require("./routes/applications");
/* eslint-disable */`nconst profileRoutes     = require("./routes/profiles");
/* eslint-disable */`nconst escrowRoutes      = require("./routes/escrow");
/* eslint-disable */`nconst healthRoutes      = require("./routes/health");
/* eslint-disable */`nconst authRoutes        = require("./routes/auth");
/* eslint-disable */`nconst ratingRoutes      = require("./routes/ratings");
/* eslint-disable */`nconst progressRoutes    = require("./routes/progress");
/* eslint-disable */`nconst eventRoutes       = require("./routes/events");
/* eslint-disable */`nconst statsRoutes       = require("./routes/stats");
/* eslint-disable */`nconst contributorRoutes = require("./routes/contributors");
/* eslint-disable */`nconst verificationRoutes = require("./routes/verification");
/* eslint-disable */`nconst nftRoutes         = require("./routes/nft");
/* eslint-disable */`nconst aiScorerRoutes    = require("./routes/aiScorer");
/* eslint-disable */`n
/* eslint-disable */`nconst gasEstimatorRoutes = require("./routes/gasEstimator");
/* eslint-disable */`nconst transactionRoutes  = require("./routes/transactions");
/* eslint-disable */`nconst daoRoutes          = require("./routes/dao");
/* eslint-disable */`nconst proposalTemplateRoutes = require("./routes/proposalTemplates");
/* eslint-disable */`nconst priceAlertRoutes     = require("./routes/priceAlerts");
/* eslint-disable */`n
/* eslint-disable */`nconst turretRoutes         = require("./routes/turrets");
/* eslint-disable */`nconst referralRoutes       = require("./routes/referrals");
/* eslint-disable */`nconst reputationRoutes     = require("./routes/reputation");
/* eslint-disable */`nconst autoConvertRoutes    = require("./routes/autoConvert");
/* eslint-disable */`n
/* eslint-disable */`nconst migrate           = require("./db/migrate");
/* eslint-disable */`nconst IndexerService    = require("./services/indexerService");
/* eslint-disable */`nconst { PriceAlertService } = require("./services/priceAlertService");
/* eslint-disable */`nconst pool              = require("./db/pool");
/* eslint-disable */`n
/* eslint-disable */`nconst app  = express();
/* eslint-disable */`nconst PORT = process.env.PORT || 4000;
/* eslint-disable */`nconst server = http.createServer(app);
/* eslint-disable */`nconst WS_OPEN = 1;
/* eslint-disable */`n
/* eslint-disable */`nconst realtimeClients = new Set();
/* eslint-disable */`nconst scopeSessionClients = new Map();
/* eslint-disable */`n
/* eslint-disable */`nfunction broadcastRealtime(event, payload) {
/* eslint-disable */`n  const message = JSON.stringify({ event, payload });
/* eslint-disable */`n  for (const ws of realtimeClients) {
/* eslint-disable */`n    if (ws.readyState === WS_OPEN) ws.send(message);
/* eslint-disable */`n  }
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nasync function upsertScopeSession(sessionId, patch) {
/* eslint-disable */`n  const content = typeof patch.content === "string" ? patch.content : "";
/* eslint-disable */`n  const cursors = patch.cursors && typeof patch.cursors === "object" ? patch.cursors : {};
/* eslint-disable */`n  const finalized = Boolean(patch.finalized);
/* eslint-disable */`n  const finalizedPayload = patch.finalizedPayload || null;
/* eslint-disable */`n
/* eslint-disable */`n  const { rows } = await pool.query(
/* eslint-disable */`n    `INSERT INTO scope_sessions (session_id, content, cursors, finalized, finalized_payload, expires_at, created_at, updated_at)
/* eslint-disable */`n     VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, NOW() + INTERVAL '24 hours', NOW(), NOW())
/* eslint-disable */`n     ON CONFLICT (session_id) DO UPDATE SET
/* eslint-disable */`n       content = EXCLUDED.content,
/* eslint-disable */`n       cursors = EXCLUDED.cursors,
/* eslint-disable */`n       finalized = EXCLUDED.finalized,
/* eslint-disable */`n       finalized_payload = EXCLUDED.finalized_payload,
/* eslint-disable */`n       expires_at = NOW() + INTERVAL '24 hours',
/* eslint-disable */`n       updated_at = NOW()
/* eslint-disable */`n     RETURNING session_id, content, cursors, finalized, finalized_payload, expires_at, updated_at`,
/* eslint-disable */`n    [sessionId, content, JSON.stringify(cursors), finalized, JSON.stringify(finalizedPayload)]
/* eslint-disable */`n  );
/* eslint-disable */`n  return rows[0];
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nasync function loadScopeSession(sessionId) {
/* eslint-disable */`n  const { rows } = await pool.query(
/* eslint-disable */`n    `SELECT session_id, content, cursors, finalized, finalized_payload, expires_at, updated_at
/* eslint-disable */`n     FROM scope_sessions
/* eslint-disable */`n     WHERE session_id = $1 AND expires_at > NOW()`,
/* eslint-disable */`n    [sessionId]
/* eslint-disable */`n  );
/* eslint-disable */`n  return rows[0] || null;
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nasync function cleanupExpiredScopeSessions() {
/* eslint-disable */`n  await pool.query("DELETE FROM scope_sessions WHERE expires_at <= NOW()");
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nsetInterval(() => {
/* eslint-disable */`n  cleanupExpiredScopeSessions().catch((err) => {
/* eslint-disable */`n    console.error("[scope] cleanup failed:", err.message);
/* eslint-disable */`n  });
/* eslint-disable */`n}, 60 * 60 * 1000).unref();
/* eslint-disable */`n
/* eslint-disable */`nconst indexerService = new IndexerService({
/* eslint-disable */`n  platformWallet: process.env.PLATFORM_WALLET_ADDRESS,
/* eslint-disable */`n  horizonUrl: process.env.HORIZON_URL,
/* eslint-disable */`n  broadcast: broadcastRealtime,
/* eslint-disable */`n});
/* eslint-disable */`nconst smtpEnabled = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
/* eslint-disable */`nconst smtpTransport = smtpEnabled
/* eslint-disable */`n  ? nodemailer.createTransport({
/* eslint-disable */`n      host: process.env.SMTP_HOST,
/* eslint-disable */`n      port: Number(process.env.SMTP_PORT || 587),
/* eslint-disable */`n      secure: false,
/* eslint-disable */`n      auth: {
/* eslint-disable */`n        user: process.env.SMTP_USER,
/* eslint-disable */`n        pass: process.env.SMTP_PASS,
/* eslint-disable */`n      },
/* eslint-disable */`n    })
/* eslint-disable */`n  : null;
/* eslint-disable */`nconst priceAlertService = new PriceAlertService({
/* eslint-disable */`n  broadcast: broadcastRealtime,
/* eslint-disable */`n  sendEmail: async ({ to, subject, text }) => {
/* eslint-disable */`n    if (!smtpTransport || !to) return;
/* eslint-disable */`n    await smtpTransport.sendMail({
/* eslint-disable */`n      from: process.env.SMTP_FROM || process.env.SMTP_USER,
/* eslint-disable */`n      to,
/* eslint-disable */`n      subject,
/* eslint-disable */`n      text,
/* eslint-disable */`n    });
/* eslint-disable */`n  },
/* eslint-disable */`n});
/* eslint-disable */`n
/* eslint-disable */`napp.locals.indexerService = indexerService;
/* eslint-disable */`napp.locals.broadcastRealtime = broadcastRealtime;
/* eslint-disable */`n
/* eslint-disable */`n// Middleware
/* eslint-disable */`napp.use(helmet());
/* eslint-disable */`napp.use(morgan("dev"));
/* eslint-disable */`napp.use(express.json({ limit: "20kb" }));
/* eslint-disable */`n
/* eslint-disable */`nconst allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map(o => o.trim());
/* eslint-disable */`napp.use(cors({
/* eslint-disable */`n  origin: (origin, cb) => (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error("CORS blocked")),
/* eslint-disable */`n  methods: ["GET", "POST", "PATCH", "DELETE"],
/* eslint-disable */`n  allowedHeaders: ["Content-Type", "Authorization"],
/* eslint-disable */`n  credentials: true,
/* eslint-disable */`n}));
/* eslint-disable */`n
/* eslint-disable */`napp.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: true }));
/* eslint-disable */`n
/* eslint-disable */`n// ─── Routes ───────────────────────────────────────────────────────────────────
/* eslint-disable */`napp.use("/health",            healthRoutes);
/* eslint-disable */`napp.use("/api/auth",          authRoutes);
/* eslint-disable */`napp.use("/api/jobs",          jobRoutes);
/* eslint-disable */`napp.use("/api/applications",  applicationRoutes);
/* eslint-disable */`napp.use("/api/profiles",      profileRoutes);
/* eslint-disable */`napp.use("/api/escrow",        escrowRoutes);
/* eslint-disable */`napp.use("/api/ratings",       ratingRoutes);
/* eslint-disable */`napp.use("/api/progress",      progressRoutes);
/* eslint-disable */`napp.use("/api/events",        eventRoutes);
/* eslint-disable */`napp.use("/api/stats",         statsRoutes);
/* eslint-disable */`napp.use("/api/contributors",  contributorRoutes);
/* eslint-disable */`napp.use("/api/verification",  verificationRoutes);
/* eslint-disable */`napp.use("/api/nft",           nftRoutes);
/* eslint-disable */`napp.use("/api/ai-scorer",     aiScorerRoutes);
/* eslint-disable */`n
/* eslint-disable */`napp.get("/api/indexer/health", (req, res) => {
/* eslint-disable */`n  res.json({
/* eslint-disable */`n    status: "ok",
/* eslint-disable */`n    indexer: indexerService.getHealth(),
/* eslint-disable */`n  });
/* eslint-disable */`n});
/* eslint-disable */`napp.use("/api/contributors",    contributorRoutes);
/* eslint-disable */`napp.use("/api/gas-estimate",    gasEstimatorRoutes);
/* eslint-disable */`napp.use("/api/transactions",   transactionRoutes);
/* eslint-disable */`napp.use("/api/dao",            daoRoutes);
/* eslint-disable */`napp.use("/api/proposal-templates", proposalTemplateRoutes);
/* eslint-disable */`napp.use("/api/price-alerts",      priceAlertRoutes);
/* eslint-disable */`napp.use("/api/ai",                aiScorerRoutes);
/* eslint-disable */`napp.use("/api/nft",               nftRoutes);
/* eslint-disable */`napp.use("/api/turrets",           turretRoutes);
/* eslint-disable */`napp.use("/api/referrals",         referralRoutes);
/* eslint-disable */`napp.use("/api/reputation",        reputationRoutes);
/* eslint-disable */`napp.use("/api/auto-convert",      autoConvertRoutes);
/* eslint-disable */`n
/* eslint-disable */`n// 404 handler — must come after all routes
/* eslint-disable */`napp.use((req, res) => {
/* eslint-disable */`n  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
/* eslint-disable */`n});
/* eslint-disable */`n
/* eslint-disable */`napp.use((err, req, res, _next) => {
/* eslint-disable */`n  console.error("[Error]", err.message);
/* eslint-disable */`n
/* eslint-disable */`n  res.status(err.status || 500).json({
/* eslint-disable */`n    error: err.message || "Internal server error",
/* eslint-disable */`n  });
/* eslint-disable */`n});
/* eslint-disable */`n
/* eslint-disable */`nconst wsServer = new WebSocketServer({ noServer: true });
/* eslint-disable */`n
/* eslint-disable */`nfunction sendJson(ws, event, payload) {
/* eslint-disable */`n  if (ws.readyState === WS_OPEN) {
/* eslint-disable */`n    ws.send(JSON.stringify({ event, payload }));
/* eslint-disable */`n  }
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nfunction getScopeSessionSet(sessionId) {
/* eslint-disable */`n  if (!scopeSessionClients.has(sessionId)) scopeSessionClients.set(sessionId, new Set());
/* eslint-disable */`n  return scopeSessionClients.get(sessionId);
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nserver.on("upgrade", (request, socket, head) => {
/* eslint-disable */`n  const url = new URL(request.url, `http://${request.headers.host}`);
/* eslint-disable */`n  if (url.pathname === "/ws/realtime" || url.pathname.startsWith("/ws/scope/")) {
/* eslint-disable */`n    wsServer.handleUpgrade(request, socket, head, (ws) => {
/* eslint-disable */`n      wsServer.emit("connection", ws, request);
/* eslint-disable */`n    });
/* eslint-disable */`n    return;
/* eslint-disable */`n  }
/* eslint-disable */`n  socket.destroy();
/* eslint-disable */`n});
/* eslint-disable */`n
/* eslint-disable */`nwsServer.on("connection", async (ws, request) => {
/* eslint-disable */`n  const url = new URL(request.url, `http://${request.headers.host}`);
/* eslint-disable */`n
/* eslint-disable */`n  if (url.pathname === "/ws/realtime") {
/* eslint-disable */`n    realtimeClients.add(ws);
/* eslint-disable */`n    sendJson(ws, "connected", { channel: "realtime" });
/* eslint-disable */`n
/* eslint-disable */`n    // Replay notifications missed while the user was disconnected
/* eslint-disable */`n    if (userAddress) {
/* eslint-disable */`n      try {
/* eslint-disable */`n        const lastSeen = userLastSeen.get(userAddress) || new Date(0);
/* eslint-disable */`n        const { rows: recent } = await pool.query(
/* eslint-disable */`n          `SELECT * FROM notifications WHERE user_address = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
/* eslint-disable */`n          [userAddress, 20],
/* eslint-disable */`n        );
/* eslint-disable */`n        const missed = recent
/* eslint-disable */`n          .filter((n) => new Date(n.created_at) > lastSeen)
/* eslint-disable */`n          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);
/* eslint-disable */`n        for (const row of missed) {
/* eslint-disable */`n          sendJson(ws, "notification:created", {
/* eslint-disable */`n            id: row.id,
/* eslint-disable */`n            userAddress: row.user_address,
/* eslint-disable */`n            type: row.type,
/* eslint-disable */`n            title: row.title,
/* eslint-disable */`n            body: row.body,
/* eslint-disable */`n            read: row.read,
/* eslint-disable */`n            jobId: row.job_id,
/* eslint-disable */`n            linkPath: row.link_path || (row.job_id ? `/jobs/${row.job_id}` : "/notifications"),
/* eslint-disable */`n            createdAt: row.created_at,
/* eslint-disable */`n          });
/* eslint-disable */`n        }
/* eslint-disable */`n      } catch { /* non-fatal */ }
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    ws.on("close", () => {
/* eslint-disable */`n      realtimeClients.delete(ws);
/* eslint-disable */`n      setWebsocketConnections("realtime", realtimeClients.size);
/* eslint-disable */`n      if (userAddress) {
/* eslint-disable */`n        userLastSeen.set(userAddress, new Date());
/* eslint-disable */`n        const sockets = userClients.get(userAddress);
/* eslint-disable */`n        if (sockets) {
/* eslint-disable */`n          sockets.delete(ws);
/* eslint-disable */`n          if (!sockets.size) userClients.delete(userAddress);
/* eslint-disable */`n        }
/* eslint-disable */`n      }
/* eslint-disable */`n    });
/* eslint-disable */`n    return;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  if (url.pathname.startsWith("/ws/scope/")) {
/* eslint-disable */`n    const sessionId = decodeURIComponent(url.pathname.replace("/ws/scope/", "")).trim();
/* eslint-disable */`n    const participantId = (url.searchParams.get("participantId") || `anon-${Date.now()}`).slice(0, 64);
/* eslint-disable */`n    if (!sessionId) {
/* eslint-disable */`n      ws.close(1008, "Invalid session id");
/* eslint-disable */`n      return;
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    const clients = getScopeSessionSet(sessionId);
/* eslint-disable */`n    clients.add(ws);
/* eslint-disable */`n
/* eslint-disable */`n    let session = await loadScopeSession(sessionId);
/* eslint-disable */`n    if (!session) {
/* eslint-disable */`n      session = await upsertScopeSession(sessionId, { content: "", cursors: {}, finalized: false });
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    sendJson(ws, "scope:init", {
/* eslint-disable */`n      sessionId,
/* eslint-disable */`n      participantId,
/* eslint-disable */`n      content: session.content || "",
/* eslint-disable */`n      cursors: session.cursors || {},
/* eslint-disable */`n      finalized: session.finalized,
/* eslint-disable */`n      finalizedPayload: session.finalized_payload || null,
/* eslint-disable */`n      expiresAt: session.expires_at,
/* eslint-disable */`n    });
/* eslint-disable */`n
/* eslint-disable */`n    ws.on("message", async (raw) => {
/* eslint-disable */`n      try {
/* eslint-disable */`n        const message = JSON.parse(String(raw));
/* eslint-disable */`n        if (!message || typeof message !== "object") return;
/* eslint-disable */`n        if (message.type === "scope:update") {
/* eslint-disable */`n          const nextCursors = { ...(session.cursors || {}), ...(message.cursors || {}) };
/* eslint-disable */`n          session = await upsertScopeSession(sessionId, {
/* eslint-disable */`n            content: typeof message.content === "string" ? message.content : session.content,
/* eslint-disable */`n            cursors: nextCursors,
/* eslint-disable */`n            finalized: false,
/* eslint-disable */`n            finalizedPayload: session.finalized_payload || null,
/* eslint-disable */`n          });
/* eslint-disable */`n          for (const client of clients) {
/* eslint-disable */`n            sendJson(client, "scope:update", {
/* eslint-disable */`n              sessionId,
/* eslint-disable */`n              content: session.content,
/* eslint-disable */`n              cursors: session.cursors || {},
/* eslint-disable */`n              updatedAt: session.updated_at,
/* eslint-disable */`n            });
/* eslint-disable */`n          }
/* eslint-disable */`n          return;
/* eslint-disable */`n        }
/* eslint-disable */`n
/* eslint-disable */`n        if (message.type === "scope:finalize") {
/* eslint-disable */`n          session = await upsertScopeSession(sessionId, {
/* eslint-disable */`n            content: typeof message.content === "string" ? message.content : session.content,
/* eslint-disable */`n            cursors: session.cursors || {},
/* eslint-disable */`n            finalized: true,
/* eslint-disable */`n            finalizedPayload: message.payload || null,
/* eslint-disable */`n          });
/* eslint-disable */`n          for (const client of clients) {
/* eslint-disable */`n            sendJson(client, "scope:finalized", {
/* eslint-disable */`n              sessionId,
/* eslint-disable */`n              content: session.content,
/* eslint-disable */`n              payload: session.finalized_payload || null,
/* eslint-disable */`n              updatedAt: session.updated_at,
/* eslint-disable */`n            });
/* eslint-disable */`n          }
/* eslint-disable */`n        }
/* eslint-disable */`n      } catch (error) {
/* eslint-disable */`n        sendJson(ws, "scope:error", { error: "Invalid message payload" });
/* eslint-disable */`n      }
/* eslint-disable */`n    });
/* eslint-disable */`n
/* eslint-disable */`n    ws.on("close", async () => {
/* eslint-disable */`n      clients.delete(ws);
/* eslint-disable */`n      if (!clients.size) scopeSessionClients.delete(sessionId);
/* eslint-disable */`n      refreshWsMetrics();
/* eslint-disable */`n      try {
/* eslint-disable */`n        const freshSession = await loadScopeSession(sessionId);
/* eslint-disable */`n        if (!freshSession) return;
/* eslint-disable */`n        const nextCursors = { ...(freshSession.cursors || {}) };
/* eslint-disable */`n        delete nextCursors[participantId];
/* eslint-disable */`n        await upsertScopeSession(sessionId, {
/* eslint-disable */`n          content: freshSession.content || "",
/* eslint-disable */`n          cursors: nextCursors,
/* eslint-disable */`n          finalized: freshSession.finalized,
/* eslint-disable */`n          finalizedHash: freshSession.finalized_hash || null,
/* eslint-disable */`n          finalizedPayload: freshSession.finalized_payload || null,
/* eslint-disable */`n        });
/* eslint-disable */`n      } catch {
/* eslint-disable */`n        /* ignore close cleanup errors */
/* eslint-disable */`n      }
/* eslint-disable */`n    });
/* eslint-disable */`n  }
/* eslint-disable */`n});
/* eslint-disable */`n
/* eslint-disable */`nasync function bootstrap() {
/* eslint-disable */`n  try {
/* eslint-disable */`n  await migrate();
/* eslint-disable */`n  await cleanupExpiredScopeSessions();
/* eslint-disable */`n  await indexerService.start();
/* eslint-disable */`n  priceAlertService.start();
/* eslint-disable */`n
/* eslint-disable */`n  // Start job expiry checker - run every hour
/* eslint-disable */`n  startJobExpiryChecker();
/* eslint-disable */`n
/* eslint-disable */`n  server.listen(PORT, () => {
/* eslint-disable */`n    console.log(`
/* eslint-disable */`n  🏪 Stellar MarketPay API
/* eslint-disable */`n  🚀 Running at http://localhost:${PORT}
/* eslint-disable */`n  🌐 Network: ${process.env.STELLAR_NETWORK || "testnet"}
/* eslint-disable */`n  `);
/* eslint-disable */`n  });
/* eslint-disable */`n  } catch (err) {
/* eslint-disable */`n    console.error("Failed to bootstrap server:", err.message);
/* eslint-disable */`n    process.exit(1);
/* eslint-disable */`n  }
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Periodically check for and expire old jobs (runs every hour).
/* eslint-disable */`n * Also sends warning notifications for jobs expiring within 3 days.
/* eslint-disable */`n */
/* eslint-disable */`nasync function startJobExpiryChecker() {
/* eslint-disable */`n  const { expireOldJobs, getExpiringJobs } = require("./services/jobService");
/* eslint-disable */`n
/* eslint-disable */`n  // Run immediately on startup
/* eslint-disable */`n  try {
/* eslint-disable */`n    const expiredCount = await expireOldJobs();
/* eslint-disable */`n    if (expiredCount > 0) {
/* eslint-disable */`n      console.log(`[job-expiry] Auto-expired ${expiredCount} old job(s)`);
/* eslint-disable */`n    }
/* eslint-disable */`n  } catch (err) {
/* eslint-disable */`n    console.error("[job-expiry] Error on initial expiry check:", err.message);
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  // Schedule hourly checks
/* eslint-disable */`n  setInterval(async () => {
/* eslint-disable */`n    try {
/* eslint-disable */`n      const expiredCount = await expireOldJobs();
/* eslint-disable */`n      if (expiredCount > 0) {
/* eslint-disable */`n        console.log(`[job-expiry] Auto-expired ${expiredCount} old job(s)`);
/* eslint-disable */`n      }
/* eslint-disable */`n
/* eslint-disable */`n      // Check for expiring jobs within 3 days and broadcast warnings
/* eslint-disable */`n      const expiringJobs = await getExpiringJobs(3);
/* eslint-disable */`n      if (expiringJobs.length > 0) {
/* eslint-disable */`n        console.log(`[job-expiry] ${expiringJobs.length} job(s) expiring within 3 days`);
/* eslint-disable */`n        broadcastRealtime("job:expiry-warning", {
/* eslint-disable */`n          count: expiringJobs.length,
/* eslint-disable */`n          jobs: expiringJobs.map(j => ({
/* eslint-disable */`n            id: j.id,
/* eslint-disable */`n            title: j.title,
/* eslint-disable */`n            expiresAt: j.expiresAt
/* eslint-disable */`n          }))
/* eslint-disable */`n        });
/* eslint-disable */`n      }
/* eslint-disable */`n    } catch (err) {
/* eslint-disable */`n      console.error("[job-expiry] Error on scheduled check:", err.message);
/* eslint-disable */`n    }
/* eslint-disable */`n  }, 60 * 60 * 1000).unref();
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nbootstrap();
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Periodically process pending notifications (runs every 2 minutes).
/* eslint-disable */`n */
/* eslint-disable */`nasync function startNotificationProcessor() {
/* eslint-disable */`n  const { processPendingNotifications } = require("./services/notificationService");
/* eslint-disable */`n  const notificationLogger = createServiceLogger('notifications');
/* eslint-disable */`n  
/* eslint-disable */`n  const sendEmailFn = async ({ to, subject, text, html }) => {
/* eslint-disable */`n    await sendEmail({ to, subject, text, html });
/* eslint-disable */`n  };
/* eslint-disable */`n
/* eslint-disable */`n  // Run immediately on startup
/* eslint-disable */`n  try {
/* eslint-disable */`n    const stats = await processPendingNotifications(sendEmailFn);
/* eslint-disable */`n    if (stats.total > 0) {
/* eslint-disable */`n      notificationLogger.info({
/* eslint-disable */`n        total: stats.total,
/* eslint-disable */`n        sent: stats.sent,
/* eslint-disable */`n        failed: stats.failed
/* eslint-disable */`n      }, 'Processed pending notifications on startup');
/* eslint-disable */`n    }
/* eslint-disable */`n  } catch (err) {
/* eslint-disable */`n    logError(notificationLogger, err, { operation: 'initial_notification_processing' });
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  // Schedule checks every 2 minutes
/* eslint-disable */`n  setInterval(async () => {
/* eslint-disable */`n    try {
/* eslint-disable */`n      const stats = await processPendingNotifications(sendEmailFn);
/* eslint-disable */`n      if (stats.total > 0) {
/* eslint-disable */`n        notificationLogger.info({
/* eslint-disable */`n          total: stats.total,
/* eslint-disable */`n          sent: stats.sent,
/* eslint-disable */`n          failed: stats.failed
/* eslint-disable */`n        }, 'Processed pending notifications');
/* eslint-disable */`n      }
/* eslint-disable */`n    } catch (err) {
/* eslint-disable */`n      logError(notificationLogger, err, { operation: 'scheduled_notification_processing' });
/* eslint-disable */`n    }
/* eslint-disable */`n  }, 2 * 60 * 1000).unref();
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Periodically finalize expired API key rotations (runs every hour).
/* eslint-disable */`n * Keys in rotating state for more than 24 hours get their rotating_key_hash
/* eslint-disable */`n * promoted to the active key_hash.
/* eslint-disable */`n */
/* eslint-disable */`nfunction startApiKeyRotationFinalizer() {
/* eslint-disable */`n  const { finalizeExpiredRotations } = require("./services/developerService");
/* eslint-disable */`n  const rotationLogger = createServiceLogger('api-key-rotation');
/* eslint-disable */`n
/* eslint-disable */`n  async function checkAndFinalize() {
/* eslint-disable */`n    try {
/* eslint-disable */`n      const finalized = await finalizeExpiredRotations();
/* eslint-disable */`n      if (finalized.length > 0) {
/* eslint-disable */`n        rotationLogger.info({ count: finalized.length }, 'Finalized expired API key rotations');
/* eslint-disable */`n      }
/* eslint-disable */`n    } catch (err) {
/* eslint-disable */`n      logError(rotationLogger, err, { operation: 'api_key_rotation_finalizer' });
/* eslint-disable */`n    }
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  setInterval(checkAndFinalize, 60 * 60 * 1000).unref();
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Schedule the weekly job-digest email for every Monday at 09:00 UTC.
/* eslint-disable */`n *
/* eslint-disable */`n * Strategy:
/* eslint-disable */`n *   1. Compute milliseconds until the next Monday 09:00 UTC.
/* eslint-disable */`n *   2. Fire a one-shot setTimeout to hit that exact moment.
/* eslint-disable */`n *   3. Inside the callback, run the digest then start a 7-day setInterval
/* eslint-disable */`n *      for all subsequent Mondays — avoiding drift from repeated short polls.
/* eslint-disable */`n */
/* eslint-disable */`nfunction startWeeklyDigestScheduler() {
/* eslint-disable */`n  const weeklyDigestService = require("./services/weeklyDigestService");
/* eslint-disable */`n  const digestLogger = createServiceLogger("weekly-digest-scheduler");
/* eslint-disable */`n
/* eslint-disable */`n  // Reuse the same sendEmail transport already wired for notifications
/* eslint-disable */`n  const sendEmailFn = async ({ to, subject, text, html }) => {
/* eslint-disable */`n    await sendEmail({ to, subject, text, html });
/* eslint-disable */`n  };
/* eslint-disable */`n
/* eslint-disable */`n  /**
/* eslint-disable */`n   * Returns the number of milliseconds from now until the next
/* eslint-disable */`n   * Monday at 09:00:00.000 UTC.  If today is already Monday and
/* eslint-disable */`n   * it's before 09:00 UTC, fires today; otherwise next Monday.
/* eslint-disable */`n   */
/* eslint-disable */`n  function msUntilNextMonday9amUTC() {
/* eslint-disable */`n    const now = new Date();
/* eslint-disable */`n    const target = new Date(now);
/* eslint-disable */`n
/* eslint-disable */`n    // getUTCDay(): 0=Sun, 1=Mon … 6=Sat
/* eslint-disable */`n    const currentDay = now.getUTCDay();
/* eslint-disable */`n    const daysUntilMonday = currentDay === 1 ? 0 : (8 - currentDay) % 7 || 7;
/* eslint-disable */`n    target.setUTCDate(now.getUTCDate() + daysUntilMonday);
/* eslint-disable */`n    target.setUTCHours(9, 0, 0, 0);
/* eslint-disable */`n
/* eslint-disable */`n    // If we landed on today-Monday but the window has already passed, push 7 days
/* eslint-disable */`n    if (target <= now) {
/* eslint-disable */`n      target.setUTCDate(target.getUTCDate() + 7);
/* eslint-disable */`n    }
/* eslint-disable */`n
/* eslint-disable */`n    return target - now;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  async function runDigest() {
/* eslint-disable */`n    try {
/* eslint-disable */`n      const stats = await weeklyDigestService.sendWeeklyDigest(sendEmailFn);
/* eslint-disable */`n      digestLogger.info(stats, "Weekly digest run complete");
/* eslint-disable */`n    } catch (err) {
/* eslint-disable */`n      logError(digestLogger, err, { operation: "weekly_digest_run" });
/* eslint-disable */`n    }
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const delay = msUntilNextMonday9amUTC();
/* eslint-disable */`n  const nextRun = new Date(Date.now() + delay);
/* eslint-disable */`n
/* eslint-disable */`n  digestLogger.info(
/* eslint-disable */`n    { nextRunUTC: nextRun.toISOString(), delayMs: delay },
/* eslint-disable */`n    "Weekly digest scheduler armed"
/* eslint-disable */`n  );
/* eslint-disable */`n
/* eslint-disable */`n  // One-shot: fires at the exact next Monday 09:00 UTC
/* eslint-disable */`n  setTimeout(async () => {
/* eslint-disable */`n    await runDigest();
/* eslint-disable */`n    // Then run every 7 days from that point onward
/* eslint-disable */`n    setInterval(runDigest, 7 * 24 * 60 * 60 * 1000).unref();
/* eslint-disable */`n  }, delay).unref();
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Schedule the weekly admin PDF report for every Monday at 08:00 UTC
/* eslint-disable */`n * (one hour before the freelancer digest at 09:00 UTC).
/* eslint-disable */`n *
/* eslint-disable */`n * Uses the same one-shot + 7-day interval pattern as startWeeklyDigestScheduler
/* eslint-disable */`n * to avoid drift.
/* eslint-disable */`n */
/* eslint-disable */`nfunction startAdminReportScheduler() {
/* eslint-disable */`n  const { generateAndSendAdminReport } = require("./services/adminReportService");
/* eslint-disable */`n  const reportLogger = createServiceLogger("admin-report-scheduler");
/* eslint-disable */`n
/* eslint-disable */`n  const sendEmailFn = async (payload) => {
/* eslint-disable */`n    await sendEmail(payload);
/* eslint-disable */`n  };
/* eslint-disable */`n
/* eslint-disable */`n  function msUntilNextMonday8amUTC() {
/* eslint-disable */`n    const now = new Date();
/* eslint-disable */`n    const target = new Date(now);
/* eslint-disable */`n    const currentDay = now.getUTCDay();
/* eslint-disable */`n    const daysUntilMonday = currentDay === 1 ? 0 : (8 - currentDay) % 7 || 7;
/* eslint-disable */`n    target.setUTCDate(now.getUTCDate() + daysUntilMonday);
/* eslint-disable */`n    target.setUTCHours(8, 0, 0, 0);
/* eslint-disable */`n    if (target <= now) {
/* eslint-disable */`n      target.setUTCDate(target.getUTCDate() + 7);
/* eslint-disable */`n    }
/* eslint-disable */`n    return target - now;
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  async function runReport() {
/* eslint-disable */`n    try {
/* eslint-disable */`n      const result = await generateAndSendAdminReport(sendEmailFn);
/* eslint-disable */`n      reportLogger.info(result, "Weekly admin PDF report complete");
/* eslint-disable */`n    } catch (err) {
/* eslint-disable */`n      logError(reportLogger, err, { operation: "weekly_admin_report" });
/* eslint-disable */`n    }
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  const delay = msUntilNextMonday8amUTC();
/* eslint-disable */`n  const nextRun = new Date(Date.now() + delay);
/* eslint-disable */`n
/* eslint-disable */`n  reportLogger.info(
/* eslint-disable */`n    { nextRunUTC: nextRun.toISOString(), delayMs: delay },
/* eslint-disable */`n    "Admin report scheduler armed"
/* eslint-disable */`n  );
/* eslint-disable */`n
/* eslint-disable */`n  setTimeout(async () => {
/* eslint-disable */`n    await runReport();
/* eslint-disable */`n    setInterval(runReport, 7 * 24 * 60 * 60 * 1000).unref();
/* eslint-disable */`n  }, delay).unref();
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Periodically purge soft-deleted jobs and profiles older than 90 days (runs daily).
/* eslint-disable */`n */
/* eslint-disable */`nfunction startPurgeDeletedRecords() {
/* eslint-disable */`n  const { purgeDeletedJobs } = require("./services/jobService");
/* eslint-disable */`n  const { purgeDeletedProfiles } = require("./services/profileService");
/* eslint-disable */`n  const purgeLogger = createServiceLogger("purge-deleted");
/* eslint-disable */`n
/* eslint-disable */`n  async function purge() {
/* eslint-disable */`n    try {
/* eslint-disable */`n      const jobsCount = await purgeDeletedJobs(90);
/* eslint-disable */`n      const profilesCount = await purgeDeletedProfiles(90);
/* eslint-disable */`n      if (jobsCount > 0 || profilesCount > 0) {
/* eslint-disable */`n        purgeLogger.info({ jobsPurged: jobsCount, profilesPurged: profilesCount }, "Purged soft-deleted records older than 90 days");
/* eslint-disable */`n      }
/* eslint-disable */`n    } catch (err) {
/* eslint-disable */`n      logError(purgeLogger, err, { operation: "purge_deleted_records" });
/* eslint-disable */`n    }
/* eslint-disable */`n  }
/* eslint-disable */`n
/* eslint-disable */`n  setInterval(purge, 24 * 60 * 60 * 1000).unref();
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n/**
/* eslint-disable */`n * Start the recurring escrow ticker (Issue #450).
/* eslint-disable */`n * Ticks recurring escrows every hour to release payments on schedule.
/* eslint-disable */`n */
/* eslint-disable */`nfunction startRecurringEscrowTicker() {
/* eslint-disable */`n  const { startRecurringEscrowTicker: startTicker } = require("./services/recurringEscrowService");
/* eslint-disable */`n  startTicker();
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`nif (process.env.NODE_ENV !== 'test') {
/* eslint-disable */`n  bootstrap();
/* eslint-disable */`n}
/* eslint-disable */`n
/* eslint-disable */`n// Expose WebSocket internals for testing
/* eslint-disable */`napp._ws = wsServer;
/* eslint-disable */`napp._ws.server = server;
/* eslint-disable */`napp._ws.wsServer = wsServer;
/* eslint-disable */`napp._ws.realtimeClients = realtimeClients;
/* eslint-disable */`napp._ws.userClients = userClients;
/* eslint-disable */`napp._ws.userLastSeen = userLastSeen;
/* eslint-disable */`napp._ws.scopeSessionClients = scopeSessionClients;
/* eslint-disable */`napp._ws.broadcastRealtime = broadcastRealtime;
/* eslint-disable */`napp._ws.broadcastToUser = broadcastToUser;
/* eslint-disable */`n
/* eslint-disable */`napp.startEscrowTimeoutChecker = startEscrowTimeoutChecker;
/* eslint-disable */`n
/* eslint-disable */`nlet isShuttingDown = false;
process.on('SIGTERM', () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[server] SIGTERM received. Broadcasting server_shutdown...');
  
  if (typeof broadcastRealtime === 'function') {
    broadcastRealtime('server_shutdown', { reconnectIn: 5 });
  }

  // Wait 5 seconds for clients to receive the message and initiate reconnection
  setTimeout(() => {
    console.log('[server] Shutting down gracefully...');
    server.close(() => {
      console.log('[server] HTTP server closed.');
      process.exit(0);
    });
  }, 5000);
});

module.exports = app;
