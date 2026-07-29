"use strict";

const { WebSocket: WsClient } = require("ws");
const jwt = require("jsonwebtoken");

const TEST_USER_1 = "GAXJ4S6F7W2K3H5N8D9P0Q2R4T6V8W1Z3X5C7V9B2N4M6P8R0T2V4X6Z8";
const TEST_USER_2 = "GBYJ4S6F7W2K3H5N8D9P0Q2R4T6V8W1Z3X5C7V9B2N4M6P8R0T2V4X6Z9";

// ─── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("../db/pool", () => {
  const notifications = [];
  return {
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
          (a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id,
        );
        const limit = params[params.length - 1] || 20;
        return { rows: rows.slice(0, limit) };
      }
      if (/SELECT COUNT\(\*\)::int AS count FROM notifications WHERE user_address/i.test(text)) {
        const count = notifications.filter(
          (n) => n.user_address === params[0] && !n.read,
        ).length;
        return { rows: [{ count }] };
      }
      return { rows: [] };
    }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  };
});

jest.mock("../services/indexerService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() })),
);

jest.mock("../services/priceAlertService", () =>
  jest.fn().mockImplementation(() => ({ start: jest.fn() })),
);

jest.mock("../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

const app = require("../server");
const { createInAppNotification } = require("./notificationService");

function userToken(userAddress) {
  return jwt.sign({ publicKey: userAddress }, process.env.JWT_SECRET);
}

describe("WebSocket real-time notification delivery", () => {
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
    app._ws.userClients.clear();
    app._ws.realtimeClients.clear();
  });

  function wsConnect(userAddress) {
    const ws = new WsClient(
      `ws://localhost:${port}/ws/realtime?token=${userToken(userAddress)}`,
    );
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

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance criterion 1
  // ───────────────────────────────────────────────────────────────────────────
  test("TC1: delivers notification to connected WebSocket client within 500ms", async () => {
    const ws = wsConnect(TEST_USER_1);
    await waitForOpen(ws);

    // Wait for the initial "connected" message
    await ws._waitForMessage((m) => m.event === "connected", 1000);

    // Trigger a notification for the connected user
    await createInAppNotification({
      userAddress: TEST_USER_1,
      type: "escrow_created",
      title: "Test notification",
      body: "This is a test notification body",
      jobId: "job-123",
    });

    const msg = await ws._waitForMessage(
      (m) => m.event === "notification:created",
      500,
    );

    expect(msg.event).toBe("notification:created");
    expect(msg.payload.type).toBe("escrow_created");
    expect(msg.payload.title).toBe("Test notification");
    expect(msg.payload.body).toBe("This is a test notification body");
    expect(msg.payload.userAddress).toBe(TEST_USER_1);

    ws.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance criterion 2
  // ───────────────────────────────────────────────────────────────────────────
  test("TC2: disconnected client's notification persisted in DB and delivered on reconnect", async () => {
    // Connect and immediately close
    const ws1 = wsConnect(TEST_USER_1);
    await waitForOpen(ws1);
    const connectedMsg = await ws1._waitForMessage((m) => m.event === "connected", 1000);
    expect(connectedMsg.event).toBe("connected");
    ws1.close();

    // Give the server time to clean up the closed connection
    await new Promise((r) => setTimeout(r, 50));

    // Create a notification while the client is disconnected
    const notification = await createInAppNotification({
      userAddress: TEST_USER_1,
      type: "new_message",
      title: "Missed message",
      body: "You have a new message while offline",
      jobId: "job-456",
    });
    expect(notification).toBeTruthy();
    expect(notification.title).toBe("Missed message");

    // Reconnect — server should send the missed notification
    const ws2 = wsConnect(TEST_USER_1);
    await waitForOpen(ws2);

    const msg = await ws2._waitForMessage(
      (m) => m.event === "notification:created",
      1000,
    );
    expect(msg.event).toBe("notification:created");
    expect(msg.payload.title).toBe("Missed message");

    ws2.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Acceptance criterion 3
  // ───────────────────────────────────────────────────────────────────────────
  test("TC3: only the intended user receives their notification (no broadcast leaks)", async () => {
    const ws1 = wsConnect(TEST_USER_1);
    const ws2 = wsConnect(TEST_USER_2);
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    // Consume initial "connected" messages
    await ws1._waitForMessage((m) => m.event === "connected", 1000);
    await ws2._waitForMessage((m) => m.event === "connected", 1000);

    // Create a notification only for TEST_USER_1
    await createInAppNotification({
      userAddress: TEST_USER_1,
      type: "payment_released",
      title: "Private notification",
      body: "Only user 1 should see this",
      jobId: "job-789",
    });

    // User 1 should receive it
    const msg1 = await ws1._waitForMessage(
      (m) => m.event === "notification:created",
      500,
    );
    expect(msg1.event).toBe("notification:created");
    expect(msg1.payload.userAddress).toBe(TEST_USER_1);

    // Wait a short period to ensure no message leaks to user 2
    await new Promise((r) => setTimeout(r, 300));

    const leaked = ws2._messages.filter(
      (m) => m.event === "notification:created",
    );
    expect(leaked).toHaveLength(0);

    ws1.close();
    ws2.close();
  });
});
