"use strict";

const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { setWebsocketConnections } = require("../metrics");

const WS_OPEN = 1;

const realtimeClients = new Set();
const userClients = new Map();
const userLastSeen = new Map();
const realtimeRooms = new Map();

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
  const roomIds = eventRooms(payload);
  const recipients = roomIds.length
    ? new Set(roomIds.flatMap((roomId) => [...(realtimeRooms.get(roomId) || [])]))
    : realtimeClients;
  for (const ws of recipients) {
    if (ws.readyState === WS_OPEN) ws.send(message);
  }
}

function broadcastToUser(userAddress, event, payload) {
  const message = JSON.stringify({ event, payload });
  for (const ws of userClients.get(userAddress) || []) {
    if (ws.readyState === WS_OPEN) ws.send(message);
  }
}

function sendJson(ws, event, payload) {
  if (ws.readyState === WS_OPEN) {
    ws.send(JSON.stringify({ event, payload }));
  }
}

function refreshRealtimeMetrics() {
  setWebsocketConnections("realtime", realtimeClients.size);
}

async function handleRealtimeConnection(ws, request) {
  const url = new URL(request.url, `http://${request.headers.host}`);
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
    refreshRealtimeMetrics();
    if (userAddress) {
      userLastSeen.set(userAddress, new Date());
    }

    if (userAddress) {
      const sockets = userClients.get(userAddress);
      if (sockets) {
        sockets.delete(ws);
        if (!sockets.size) userClients.delete(userAddress);
      }
    }
  });
}

module.exports = {
  realtimeClients,
  userClients,
  userLastSeen,
  realtimeRooms,
  subscribeRealtime,
  unsubscribeRealtime,
  broadcastRealtime,
  broadcastToUser,
  refreshRealtimeMetrics,
  handleRealtimeConnection,
};
