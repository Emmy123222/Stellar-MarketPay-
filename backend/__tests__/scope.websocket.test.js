"use strict";

const { WebSocket: WsClient } = require("ws");

const TEST_PARTICIPANT_1 = "participant-alpha";
const TEST_PARTICIPANT_2 = "participant-beta";
const TEST_SESSION_ID = "test-scope-session-001";
const TEST_TIMEOUT_MS = 5000;

jest.mock("../src/db/pool", () => {
  const sessions = new Map();

  return {
    query: jest.fn(async (sql, params) => {
      const text = sql.replace(/\s+/g, " ").trim();

      if (/INSERT INTO scope_sessions/i.test(text)) {
        const [sessionId, content, cursors, finalized, finalizedHash, finalizedPayload] = params;
        const row = {
          session_id: sessionId,
          content: content || "",
          cursors: typeof cursors === "string" ? JSON.parse(cursors) : (cursors || {}),
          finalized: Boolean(finalized),
          finalized_hash: finalizedHash || null,
          finalized_payload: finalizedPayload ? (typeof finalizedPayload === "string" ? JSON.parse(finalizedPayload) : finalizedPayload) : null,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        sessions.set(sessionId, row);
        return { rows: [row] };
      }

      if (/SELECT.*FROM scope_sessions/i.test(text)) {
        const sessionId = params[0];
        const row = sessions.get(sessionId) || null;
        if (row && new Date(row.expires_at) > new Date()) {
          return { rows: [row] };
        }
        return { rows: [] };
      }

      return { rows: [] };
    }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  };
});

jest.mock("../src/services/indexerService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() })),
);

jest.mock("../src/services/priceAlertService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() })),
);

jest.mock("../src/db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

const app = require("../src/server");

describe("WebSocket scope session", () => {
  let server;
  let port;

  beforeAll(async () => {
    server = app._ws.server;
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  }, 10000);

  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    app._ws.scopeSessionClients.clear();
  });

  function wsConnectScope(sessionId, participantId) {
    const ws = new WsClient(
      `ws://localhost:${port}/ws/scope/${encodeURIComponent(sessionId)}?participantId=${encodeURIComponent(participantId)}`,
    );
    const messages = [];
    const messageCallbacks = [];
    ws.on("message", (data) => {
      const parsed = JSON.parse(data.toString());
      messages.push(parsed);
      messageCallbacks.forEach((cb) => cb(parsed));
    });
    ws._messages = messages;
    ws._waitForMessage = (filter, timeoutMs = TEST_TIMEOUT_MS) => {
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

  test("TC1: client receives scope:init on connect with session data", async () => {
    const ws = wsConnectScope(TEST_SESSION_ID, TEST_PARTICIPANT_1);
    await waitForOpen(ws);

    const msg = await ws._waitForMessage((m) => m.event === "scope:init", 2000);
    expect(msg.event).toBe("scope:init");
    expect(msg.payload.sessionId).toBe(TEST_SESSION_ID);
    expect(msg.payload.participantId).toBe(TEST_PARTICIPANT_1);
    expect(typeof msg.payload.content).toBe("string");
    expect(msg.payload.cursors).toBeDefined();
    expect(msg.payload.finalized).toBe(false);

    ws.close();
  });

  test("TC2: scope:update broadcasts content to all session clients", async () => {
    const ws1 = wsConnectScope("session-broadcast-test", TEST_PARTICIPANT_1);
    const ws2 = wsConnectScope("session-broadcast-test", TEST_PARTICIPANT_2);
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    await ws1._waitForMessage((m) => m.event === "scope:init", 2000);
    await ws2._waitForMessage((m) => m.event === "scope:init", 2000);

    const testContent = "# Test Scope\n\nBuild a payment integration.";
    ws1.send(JSON.stringify({
      type: "scope:update",
      content: testContent,
      cursors: { [TEST_PARTICIPANT_1]: { start: 0, end: 5, updatedAt: Date.now() } },
    }));

    const msgOnWs2 = await ws2._waitForMessage((m) => m.event === "scope:update");
    expect(msgOnWs2.event).toBe("scope:update");
    expect(msgOnWs2.payload.content).toBe(testContent);
    expect(msgOnWs2.payload.cursors[TEST_PARTICIPANT_1]).toBeDefined();
    expect(msgOnWs2.payload.cursors[TEST_PARTICIPANT_1].start).toBe(0);

    ws1.close();
    ws2.close();
  });

  test("TC3: scope:finalize locks document and returns hash", async () => {
    const ws = wsConnectScope("session-finalize-test", TEST_PARTICIPANT_1);
    await waitForOpen(ws);

    await ws._waitForMessage((m) => m.event === "scope:init", 2000);

    const testContent = "# Finalized Scope\n\nThis document should be locked.";
    ws.send(JSON.stringify({
      type: "scope:finalize",
      content: testContent,
      payload: { title: "Finalized Scope", category: "Frontend Development" },
    }));

    const msg = await ws._waitForMessage((m) => m.event === "scope:finalized");
    expect(msg.event).toBe("scope:finalized");
    expect(msg.payload.finalizedHash).toBeDefined();
    expect(msg.payload.finalizedHash.length).toBe(64);
    expect(msg.payload.content).toBe(testContent);
    expect(msg.payload.payload.title).toBe("Finalized Scope");

    ws.close();
  });

  test("TC4: finalized document hash is deterministic (same content = same hash)", async () => {
    const ws1 = wsConnectScope("session-hash-test-1", TEST_PARTICIPANT_1);
    await waitForOpen(ws1);
    await ws1._waitForMessage((m) => m.event === "scope:init", 2000);

    const content = "# Deterministic hash test\n\nSame content should produce the same hash.";
    ws1.send(JSON.stringify({ type: "scope:finalize", content }));
    const msg1 = await ws1._waitForMessage((m) => m.event === "scope:finalized");
    ws1.close();

    const ws2 = wsConnectScope("session-hash-test-2", TEST_PARTICIPANT_2);
    await waitForOpen(ws2);
    await ws2._waitForMessage((m) => m.event === "scope:init", 2000);

    ws2.send(JSON.stringify({ type: "scope:finalize", content }));
    const msg2 = await ws2._waitForMessage((m) => m.event === "scope:finalized");
    ws2.close();

    expect(msg1.payload.finalizedHash).toBe(msg2.payload.finalizedHash);
  });
});
