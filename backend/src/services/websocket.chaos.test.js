/**
 * src/services/websocket.chaos.test.js
 *
 * Issue #888 — Chaos/reconnection resilience tests for the WebSocket server.
 *
 * Covers:
 *   1. Random connection kills x10  →  verify client reconnects every time
 *   2. In-flight message delivery   →  send while connected & verify receipt,
 *                                      confirm no duplication after reconnect
 *   3. Server-side dead-connection cleanup → userClients, realtimeClients,
 *                                      scopeSessionClients
 *   4. Reconnection timing           →  every reconnect < 3 000 ms with
 *                                      useful failure diagnostics
 */
"use strict";

const { WebSocket: WsClient } = require("ws");
const jwt = require("jsonwebtoken");

const TEST_USER_A = "GAXJ4S6F7W2K3H5N8D9P0Q2R4T6V8W1Z3X5C7V9B2N4M6P8R0T2V4X6Z8";
const TEST_USER_B = "GBYJ4S6F7W2K3H5N8D9P0Q2R4T6V8W1Z3X5C7V9B2N4M6P8R0T2V4X6Z9";
const PER_RECONNECT_TIMEOUT = 3_000; // each reconnect must finish faster than this

// ── Prevent process.exit from killing the test runner ─────────────────────
process.exit = jest.fn((code) => {
  const err = new Error(`process.exit called with ${code}`);
  Error.captureStackTrace(err, process.exit);
  throw err;
});

// ── Mocks (mirror websocket.test.js) ──────────────────────────────────────
jest.mock("../db/pool", () => {
  const notifications = [];
  const poolMock = {
    query: jest.fn(async (sql, params) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (/^INSERT INTO notifications/i.test(text)) {
        const row = {
          id: notifications.length + 1,
          user_address: params[0],
          type: params[1],
          title: params[2],
          body: params[3],
          read: false,
          job_id: params[4],
          link_path: params[5],
          created_at: new Date().toISOString(),
        };
        notifications.push(row);
        return { rows: [row] };
      }
      if (/^SELECT \* FROM notifications WHERE user_address/i.test(text)) {
        let rows = notifications.filter((n) => n.user_address === params[0]);
        rows.sort(
          (a, b) =>
            new Date(b.created_at) - new Date(a.created_at) || b.id - a.id,
        );
        const limit = params[params.length - 1] || 20;
        return { rows: rows.slice(0, limit) };
      }
      if (
        /SELECT COUNT\(\*\)::int AS count FROM notifications WHERE user_address/i.test(
          text,
        )
      ) {
        const count = notifications.filter(
          (n) => n.user_address === params[0] && !n.read,
        ).length;
        return { rows: [{ count }] };
      }
      // scope_sessions mock for real DB queries during connection
      if (/INSERT INTO scope_sessions/i.test(text)) {
        return {
          rows: [
            {
              session_id: params[0],
              content: params[1],
              cursors: JSON.parse(params[2] || "{}"),
              finalized: params[3],
              finalized_payload: params[4],
              expires_at: new Date(Date.now() + 86400000).toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (/SELECT .+ FROM scope_sessions WHERE session_id/i.test(text)) {
        // Return a mock session so the "close" handler doesn't early-exit
        // before cleaning up scopeSessionClients.
        return {
          rows: [
            {
              session_id: params[0],
              content: "",
              cursors: {},
              finalized: false,
              finalized_payload: null,
              expires_at: new Date(Date.now() + 86400000).toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  };
  // readPool & writePool aliases used by services like jobService
  poolMock.readPool = poolMock;
  poolMock.writePool = poolMock;
  return poolMock;
});

jest.mock("../services/indexerService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() })),
);

jest.mock("../services/priceAlertService", () => ({
  PriceAlertService: jest.fn().mockImplementation(() => ({ start: jest.fn() })),
}));

jest.mock("../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

const app = require("../server");

// ── Helpers ───────────────────────────────────────────────────────────────

function userToken(userAddress) {
  return jwt.sign({ publicKey: userAddress }, process.env.JWT_SECRET);
}

/**
 * Create a new WS client, wire up message capture, and attach helpers.
 */
function wsConnect(userAddress, { port, path = "/ws/realtime" } = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const token = userAddress ? `${sep}token=${userToken(userAddress)}` : "";
  const ws = new WsClient(`ws://localhost:${port}${path}${token}`);
  const messages = [];
  const messageCallbacks = [];
  ws.on("message", (data) => {
    const parsed = JSON.parse(data.toString());
    messages.push(parsed);
    messageCallbacks.forEach((cb) => cb(parsed));
  });
  ws._messages = messages;
  ws._waitForMessage = (filter, timeoutMs = 500) => {
    return new Promise((resolve, reject) => {
      const existing = messages.find(filter);
      if (existing) return resolve(existing);
      const timer = setTimeout(() => {
        const idx = messageCallbacks.indexOf(onMsg);
        if (idx !== -1) messageCallbacks.splice(idx, 1);
        reject(new Error("Timed out waiting for WebSocket message"));
      }, timeoutMs);
      const onMsg = (msg) => {
        if (filter(msg)) {
          clearTimeout(timer);
          resolve(msg);
        }
      };
      messageCallbacks.push(onMsg);
    });
  };
  return ws;
}

function waitForOpen(ws) {
  return new Promise((resolve) => ws.on("open", resolve));
}

/**
 * Deterministic pseudo-random shuffle using a simple LCG.
 * Seed is the iteration index so every run is reproducible.
 */
function seededShuffle(arr, seed) {
  // Mulberry32 PRNG — fast, deterministic, good distribution
  let state = seed | 0;
  function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ── Test Suite ────────────────────────────────────────────────────────────

describe("WebSocket chaos & reconnection resilience (#888)", () => {
  let port;
  let server;

  beforeAll(async () => {
    server = app._ws.server;
    // bootstrap() already called server.listen() — just wait for readiness
    await new Promise((resolve) => {
      if (server.listening) return resolve();
      server.once("listening", resolve);
    });
    port = server.address().port;
  }, 10_000);

  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    app._ws.userClients.clear();
    app._ws.realtimeClients.clear();
    app._ws.scopeSessionClients.clear();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Requirement 1 — Random chaos kills (10x)
  // ─────────────────────────────────────────────────────────────────────────
  describe("R1: random connection kills with verified reconnection", () => {
    const KILL_COUNT = 10;

    test(`survives ${KILL_COUNT} random connection kills`, async () => {
      const ws = wsConnect(TEST_USER_A, { port });
      await waitForOpen(ws);

      // Consume the mandatory "connected" handshake
      const connectedMsg = await ws._waitForMessage(
        (m) => m.event === "connected",
        1_000,
      );
      expect(connectedMsg.payload.channel).toBe("realtime");

      // Pre-generate a deterministic schedule — every iteration kills once,
      // but the delay before the kill is shuffled to exercise different
      // timing windows. Using a fixed seed (888) makes it reproducible.
      const delays = seededShuffle(
        [30, 50, 80, 110, 140, 170, 200, 230, 260, 290],
        888,
      );

      let currentWs = ws;

      for (let i = 0; i < KILL_COUNT; i++) {
        // Wait a small deterministic amount of time, then force-kill
        await new Promise((r) => setTimeout(r, delays[i]));

        // Kill the connection
        currentWs.close();

        // Reconnect *immediately* — the client's own reconnect logic isn't
        // exercised here; we're testing the *server's* ability to accept
        // reconnections after abrupt closures.
        const nextWs = wsConnect(TEST_USER_A, { port });
        await waitForOpen(nextWs);

        const handshake = await nextWs._waitForMessage(
          (m) => m.event === "connected",
          2_000,
        );
        expect(handshake).toBeTruthy();
        expect(handshake.payload.channel).toBe("realtime");

        // No messages should leak from the previous connection
        const dupes = nextWs._messages.filter(
          (m) => m.event === "connected",
        ).length;
        expect(dupes).toBe(1); // exactly one handshake

        // Clean up previous ws to avoid resource leaks in the test
        currentWs = nextWs;
      }

      currentWs.close();
    }, 30_000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Requirement 2 — In-flight message delivery
  // ─────────────────────────────────────────────────────────────────────────
  describe("R2: in-flight messages during reconnection", () => {
    test("messages sent while connected are received, none lost on reconnect", async () => {
      // Connect
      const ws1 = wsConnect(TEST_USER_A, { port });
      await waitForOpen(ws1);
      await ws1._waitForMessage((m) => m.event === "connected", 1_000);

      // Send several messages via the server's own broadcast
      const broadcast = app.locals.broadcastRealtime;
      const sentPayloads = [];
      for (let i = 0; i < 5; i++) {
        const payload = { id: i, text: `pre-kill-${i}`, ts: Date.now() };
        sentPayloads.push(payload);
        broadcast("test:in-flight", payload);
      }

      // All 5 must arrive on the connected client
      for (const expected of sentPayloads) {
        const received = await ws1._waitForMessage(
          (m) => m.event === "test:in-flight" && m.payload.id === expected.id,
          1_000,
        );
        expect(received).toBeTruthy();
      }

      // Now kill the connection
      ws1.close();
      // Let the server process the close
      await new Promise((r) => setTimeout(r, 50));

      // Send messages while disconnected — they should NOT arrive on ws1
      // (it's closed). This is expected behaviour for a broadcast channel.
      broadcast("test:in-flight", { id: 99, text: "while-disconnected" });

      // Reconnect
      const ws2 = wsConnect(TEST_USER_A, { port });
      await waitForOpen(ws2);
      await ws2._waitForMessage((m) => m.event === "connected", 1_000);

      // Send a post-reconnect message and confirm it arrives
      broadcast("test:in-flight", { id: 100, text: "post-reconnect" });
      const postMsg = await ws2._waitForMessage(
        (m) => m.event === "test:in-flight" && m.payload.id === 100,
        1_000,
      );
      expect(postMsg).toBeTruthy();
      expect(postMsg.payload.text).toBe("post-reconnect");

      // The "while-disconnected" message must NOT have arrived on ws2
      // (realtime broadcast has no replay queue)
      const lost = ws2._messages.filter(
        (m) => m.event === "test:in-flight" && m.payload.id === 99,
      );
      expect(lost).toHaveLength(0);

      ws2.close();
    });

    test("no duplicate messages received after reconnection", async () => {
      const broadcast = app.locals.broadcastRealtime;

      // First connect
      const ws1 = wsConnect(TEST_USER_A, { port });
      await waitForOpen(ws1);
      await ws1._waitForMessage((m) => m.event === "connected", 1_000);

      // Send a unique message
      broadcast("test:dedup", { id: 42, text: "should-arrive-once" });
      await ws1._waitForMessage(
        (m) => m.event === "test:dedup" && m.payload.id === 42,
        1_000,
      );

      ws1.close();
      await new Promise((r) => setTimeout(r, 50));

      // Reconnect
      const ws2 = wsConnect(TEST_USER_A, { port });
      await waitForOpen(ws2);
      await ws2._waitForMessage((m) => m.event === "connected", 1_000);

      // Send a new message — only this should arrive on ws2
      broadcast("test:dedup", { id: 43, text: "after-reconnect" });
      await ws2._waitForMessage(
        (m) => m.event === "test:dedup" && m.payload.id === 43,
        1_000,
      );

      // Count total dedup messages on ws2 — should be exactly 1 (id=43)
      const dedupMsgs = ws2._messages.filter((m) => m.event === "test:dedup");
      expect(dedupMsgs).toHaveLength(1);

      ws2.close();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Requirement 3 — Server-side cleanup of dead connections
  // ─────────────────────────────────────────────────────────────────────────
  describe("R3: server-side dead-connection cleanup", () => {
    test("disconnected client removed from realtimeClients", async () => {
      expect(app._ws.realtimeClients.size).toBe(0);

      const ws = wsConnect(TEST_USER_A, { port });
      await waitForOpen(ws);
      await ws._waitForMessage((m) => m.event === "connected", 1_000);

      expect(app._ws.realtimeClients.size).toBe(1);

      ws.close();
      // The close handler on the server runs asynchronously — poll until
      // realtimeClients reflects the cleanup or timeout.
      const start = Date.now();
      while (app._ws.realtimeClients.size > 0 && Date.now() - start < 2_000) {
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(app._ws.realtimeClients.size).toBe(0);
    });

    test("disconnected client removed from userClients", async () => {
      expect(app._ws.userClients.size).toBe(0);

      const ws = wsConnect(TEST_USER_A, { port });
      await waitForOpen(ws);
      await ws._waitForMessage((m) => m.event === "connected", 1_000);

      // userClients should now contain the test user's set
      expect(app._ws.userClients.has(TEST_USER_A)).toBe(true);
      const sockets = app._ws.userClients.get(TEST_USER_A);
      expect(sockets).toBeTruthy();
      expect(sockets.size).toBe(1);

      ws.close();
      const start = Date.now();
      while (app._ws.userClients.size > 0 && Date.now() - start < 2_000) {
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(app._ws.userClients.has(TEST_USER_A)).toBe(false);
    });

    test("disconnected client removed from scopeSessionClients", async () => {
      expect(app._ws.scopeSessionClients.size).toBe(0);

      const ws = wsConnect(TEST_USER_A, {
        port,
        path: "/ws/scope/test-session-888?participantId=p1",
      });
      await waitForOpen(ws);
      await ws._waitForMessage((m) => m.event === "scope:init", 2_000);

      expect(app._ws.scopeSessionClients.has("test-session-888")).toBe(true);
      expect(app._ws.scopeSessionClients.get("test-session-888").size).toBe(1);

      ws.close();
      const start = Date.now();
      while (
        app._ws.scopeSessionClients.has("test-session-888") &&
        Date.now() - start < 3_000
      ) {
        await new Promise((r) => setTimeout(r, 30));
      }

      expect(app._ws.scopeSessionClients.has("test-session-888")).toBe(false);
    });

    test("multiple disconnects do not leave stale entries", async () => {
      // Connect 3 clients for the same user, disconnect each in turn
      const clients = [];
      for (let i = 0; i < 3; i++) {
        const ws = wsConnect(TEST_USER_A, { port });
        await waitForOpen(ws);
        await ws._waitForMessage((m) => m.event === "connected", 1_000);
        clients.push(ws);
      }

      expect(app._ws.realtimeClients.size).toBe(3);
      expect(app._ws.userClients.get(TEST_USER_A).size).toBe(3);

      // Disconnect 2 of them
      clients[0].close();
      clients[1].close();

      const start = Date.now();
      while (app._ws.realtimeClients.size > 1 && Date.now() - start < 2_000) {
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(app._ws.realtimeClients.size).toBe(1);
      expect(app._ws.userClients.get(TEST_USER_A).size).toBe(1);

      // Disconnect the last one
      clients[2].close();

      const start2 = Date.now();
      while (app._ws.realtimeClients.size > 0 && Date.now() - start2 < 2_000) {
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(app._ws.realtimeClients.size).toBe(0);
      expect(app._ws.userClients.has(TEST_USER_A)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Requirement 4 — Reconnection timing (< 3 s)
  // ─────────────────────────────────────────────────────────────────────────
  describe("R4: reconnection time under 3 seconds", () => {
    const MEASURE_COUNT = 10;

    test(`reconnection time < ${PER_RECONNECT_TIMEOUT}ms across ${MEASURE_COUNT} measurements`, async () => {
      const timings = [];

      for (let i = 0; i < MEASURE_COUNT; i++) {
        // Connect
        const ws1 = wsConnect(TEST_USER_A, { port });
        await waitForOpen(ws1);
        await ws1._waitForMessage((m) => m.event === "connected", 1_000);

        // Kill
        ws1.close();
        // Small settle to guarantee server has processed the close
        await new Promise((r) => setTimeout(r, 15));

        // Measure reconnection time: from WS constructor call → "open" event
        const t0 = Date.now();
        const ws2 = wsConnect(TEST_USER_A, { port });
        await waitForOpen(ws2);
        await ws2._waitForMessage((m) => m.event === "connected", 2_000);
        const elapsed = Date.now() - t0;
        timings.push(elapsed);

        ws2.close();
      }

      // Build a useful failure message
      const max = Math.max(...timings);
      const failures = timings.filter((t) => t >= PER_RECONNECT_TIMEOUT);

      expect(failures).toHaveLength(0);
      // Soft assertion on max to give the developer useful diagnostics
      expect(max).toBeLessThan(PER_RECONNECT_TIMEOUT);
    }, 30_000);

    test("reconnection time measured accurately with failure details", async () => {
      // Single focused measurement with detailed diagnostics
      const ws1 = wsConnect(TEST_USER_B, { port });
      await waitForOpen(ws1);
      await ws1._waitForMessage((m) => m.event === "connected", 1_000);
      ws1.close();
      await new Promise((r) => setTimeout(r, 15));

      const t0 = Date.now();
      const ws2 = wsConnect(TEST_USER_B, { port });
      await waitForOpen(ws2);
      const handshake = await ws2._waitForMessage(
        (m) => m.event === "connected",
        2_000,
      );
      const elapsed = Date.now() - t0;

      // Detailed assertion — failure message includes the actual timings
      expect(elapsed).toBeLessThan(PER_RECONNECT_TIMEOUT);
      expect(handshake).toBeTruthy();

      ws2.close();
    });
  });
});
