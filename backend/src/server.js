/**
 * src/server.js
 * Stellar MarketPay — Express API server
 */
"use strict";

const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const morgan      = require("morgan");
const rateLimit   = require("express-rate-limit");
const http        = require("http");
const { WebSocketServer } = require("ws");
const nodemailer  = require("nodemailer");
require("dotenv").config();

const jobRoutes         = require("./routes/jobs");
const applicationRoutes = require("./routes/applications");
const profileRoutes     = require("./routes/profiles");
const escrowRoutes      = require("./routes/escrow");
const healthRoutes      = require("./routes/health");
const authRoutes        = require("./routes/auth");
const ratingRoutes      = require("./routes/ratings");
const progressRoutes    = require("./routes/progress");
const eventRoutes       = require("./routes/events");
const statsRoutes       = require("./routes/stats");

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

// ─── Middleware ───────────────────────────────────────────────────────────────
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

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: false }));

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

app.get("/api/indexer/health", (req, res) => {
  res.json({
    status: "ok",
    indexer: indexerService.getHealth(),
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));
app.use((err, req, res) => {
  console.error("[Error]", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
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
    server.listen(PORT, () => {
      console.log(`
  🏪 Stellar MarketPay API
  🚀 Running at http://localhost:${PORT}
  🌐 Network: ${process.env.STELLAR_NETWORK || "testnet"}
  `);
    });
  } catch (error) {
    console.error("[startup] failed:", error.message);
    process.exit(1);
  }
}

bootstrap();

module.exports = app;
