"use strict";

const crypto = require("crypto");
const { setWebsocketConnections } = require("../metrics");
const {
  upsertScopeSession,
  loadScopeSession,
  cleanupExpiredScopeSessions,
  MAX_CONTENT_LENGTH,
} = require("../routes/scope");

const WS_OPEN = 1;

const scopeSessionClients = new Map();

function sendJson(ws, event, payload) {
  if (ws.readyState === WS_OPEN) {
    ws.send(JSON.stringify({ event, payload }));
  }
}

function getScopeSessionSet(sessionId) {
  if (!scopeSessionClients.has(sessionId)) scopeSessionClients.set(sessionId, new Set());
  return scopeSessionClients.get(sessionId);
}

function refreshScopeMetrics() {
  let scopeConnections = 0;
  for (const clients of scopeSessionClients.values()) scopeConnections += clients.size;
  setWebsocketConnections("scope", scopeConnections);
}

async function handleScopeConnection(ws, request) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const sessionId = decodeURIComponent(url.pathname.replace("/ws/scope/", "")).trim();
  const participantId = (url.searchParams.get("participantId") || `anon-${Date.now()}`).slice(0, 64);
  if (!sessionId) {
    ws.close(1008, "Invalid session id");
    return;
  }

  const clients = getScopeSessionSet(sessionId);
  clients.add(ws);
  refreshScopeMetrics();

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
    refreshScopeMetrics();
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

module.exports = {
  scopeSessionClients,
  getScopeSessionSet,
  refreshScopeMetrics,
  handleScopeConnection,
  cleanupExpiredScopeSessions,
};
