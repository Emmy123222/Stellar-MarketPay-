/**
 * k6/scripts/websocket-realtime.js
 *
 * WebSocket load scenario for Stellar MarketPay's realtime notification
 * and job room fan-out layer (/ws/realtime).
 *
 * Measures:
 *   - Concurrent connection ramp & hold scaling behavior
 *   - Room subscription handling (realtimeRooms Map)
 *   - Message delivery latency during broadcast bursts
 *   - Connection-failure rates and connection handshake durations
 *
 * Issue #1824
 */
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { WS_BASE_URL, wsThresholds, commonTags } from "../config.js";

// Custom metrics for WebSocket performance
export const wsConnecting = new Trend("ws_connecting");
export const wsDeliveryLatency = new Trend("ws_delivery_latency");
export const wsSessionDuration = new Trend("ws_session_duration");
export const wsConnectionFailures = new Rate("ws_connection_failures");
export const wsMessagesReceived = new Counter("ws_messages_received");
export const wsBroadcastsReceived = new Counter("ws_broadcasts_received");
export const wsPingsSent = new Counter("ws_pings_sent");

const TARGET_VUS = Number(__ENV.K6_WS_VUS || 50);
const NUM_ROOMS = Number(__ENV.K6_WS_ROOMS || 5);
const SESSION_SECONDS = Number(__ENV.K6_WS_SESSION_SECS || 15);

export const options = {
  tags: commonTags("websocket-realtime"),
  thresholds: {
    ...wsThresholds,
  },
  stages: [
    { duration: "10s", target: Math.min(10, TARGET_VUS) }, // warm-up
    { duration: "20s", target: TARGET_VUS },               // ramp to peak concurrent sockets
    { duration: "30s", target: TARGET_VUS },               // hold sustained peak load
    { duration: "10s", target: 0 },                        // ramp-down
  ],
};

export default function () {
  const vuId = __VU || 1;
  const roomId = (vuId % NUM_ROOMS) + 1;
  const roomName = `job:${roomId}`;
  const url = `${WS_BASE_URL}/ws/realtime`;

  const startTime = Date.now();
  let connectSuccess = false;

  const res = ws.connect(url, {}, function (socket) {
    socket.on("open", () => {
      connectSuccess = true;
      wsConnecting.add(Date.now() - startTime);

      // Subscribe to target job room
      socket.send(JSON.stringify({
        type: "subscribe",
        room: roomName,
      }));

      // Periodically ping to measure latency and keep alive
      socket.setInterval(() => {
        wsPingsSent.add(1);
        socket.send(JSON.stringify({
          type: "ping",
          timestamp: Date.now(),
        }));
      }, 2000);

      // Designated broadcaster VUs emit periodic room broadcasts
      if (vuId % 5 === 1) {
        socket.setInterval(() => {
          socket.send(JSON.stringify({
            type: "broadcast",
            room: roomName,
            event: "job:update",
            timestamp: Date.now(),
            payload: {
              jobId: roomId,
              updatedAt: new Date().toISOString(),
              broadcasterVu: vuId,
            },
          }));
        }, 3000);
      }

      // Close connection after session duration
      socket.setTimeout(() => {
        socket.close();
      }, SESSION_SECONDS * 1000);
    });

    socket.on("message", (raw) => {
      wsMessagesReceived.add(1);
      try {
        const msg = JSON.parse(raw);

        // Record latency if sender timestamp is attached
        if (msg.timestamp || (msg.payload && msg.payload.timestamp)) {
          const sentTs = msg.timestamp || msg.payload.timestamp;
          const latency = Date.now() - sentTs;
          if (latency >= 0) {
            wsDeliveryLatency.add(latency);
          }
        }

        if (msg.event === "job:update" || msg.room === roomName) {
          wsBroadcastsReceived.add(1);
        }
      } catch (_e) {
        // Non-JSON message
      }
    });

    socket.on("close", () => {
      wsSessionDuration.add(Date.now() - startTime);
    });

    socket.on("error", (err) => {
      wsConnectionFailures.add(1);
    });
  });

  const checkResult = check(res, {
    "status is 101": (r) => r && r.status === 101,
  });

  if (!checkResult || !connectSuccess) {
    wsConnectionFailures.add(1);
  } else {
    wsConnectionFailures.add(0);
  }

  sleep(1);
}
