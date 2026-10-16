import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { CLIENT_ADDRESS, FREELANCER_ADDRESS } from "./helpers/marketplaceState";

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_ID = "job-msg-1";
const JOB_TITLE = "Add realtime messaging to the marketplace app";
const JOB_DESCRIPTION =
  "Wire MessageThread into the job detail page so the client and the assigned freelancer can talk privately without leaving the job.";

const MSG_FROM_CLIENT = "Hi! Escrow is funded — starting the first milestone today.";
const MSG_FROM_FREELANCER = "Great — first deliverable lands tomorrow evening.";

// ─── State shared by the route handlers of both browser contexts ─────────────
// Handlers run in Node (Playwright's router), so a plain object closure is
// enough to share mutations across contexts and navigations within the test.

interface MockMessage {
  id: string;
  jobId: string;
  senderAddress: string;
  receiverAddress: string;
  content: string;
  read: boolean;
  createdAt: string;
}

interface MockNotification {
  id: string;
  userAddress: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  jobId: string;
  linkPath: string;
  createdAt: string;
}

interface JobState {
  id: string;
  title: string;
  description: string;
  budget: string;
  currency: string;
  category: string;
  skills: string[];
  status: string;
  clientAddress: string;
  freelancerAddress: string;
  escrowContractId: string;
  applicantCount: number;
  createdAt: string;
  updatedAt: string;
}

interface MessagingState {
  job: JobState;
  messages: MockMessage[];
  notifications: Record<string, MockNotification[]>;
}

function createMessagingState(): MessagingState {
  const now = new Date().toISOString();
  return {
    job: {
      id: JOB_ID,
      title: JOB_TITLE,
      description: JOB_DESCRIPTION,
      budget: "400",
      currency: "XLM",
      category: "Web Development",
      skills: ["React", "TypeScript"],
      status: "in_progress",
      clientAddress: CLIENT_ADDRESS,
      freelancerAddress: FREELANCER_ADDRESS,
      escrowContractId: "CMOCKCONTRACTID",
      applicantCount: 1,
      createdAt: now,
      updatedAt: now,
    },
    messages: [],
    notifications: {
      [CLIENT_ADDRESS]: [],
      [FREELANCER_ADDRESS]: [],
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function installFreighter(context: BrowserContext, address: string) {
  await context.addInitScript((key) => {
    (window as any).__currentFreighterKey__ = key;
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: true }),
      isAllowed: async () => ({ isAllowed: true }),
      requestAccess: async () => ({ error: null }),
      getPublicKey: async () => ({ publicKey: key }),
      signTransaction: async () => ({ signedTransaction: "signed-xdr-mock" }),
    };
  }, address);
}

/**
 * Replace `window.WebSocket` with a controllable double before any page
 * script runs. The realtime endpoint has no proxy through `next dev`, so a
 * real socket could never connect — and more importantly the test needs to
 * *decide* exactly when a `message:new` frame is delivered (Issue #1893's
 * flake-resistance AC: explicit waits on WS events, not timeouts).
 *
 * Every instance registers on `window.__wsMock`; frames the app sends are
 * recorded, and `window.__wsMock.emit(event, payload)` fires `onmessage`
 * on every open socket — exactly what the backend's `broadcastRealtime`
 * does for room subscribers.
 */
async function installFakeWebSocket(context: BrowserContext) {
  await context.addInitScript(() => {
    const sockets: any[] = [];

    (window as any).__wsMock = {
      sockets,
      sentFrames: (): string[] =>
        sockets.flatMap((s: any) => (s.__frames as string[]) ?? []),
      openCount: (): number =>
        sockets.filter((s: any) => s.readyState === 1).length,
      emit: (event: string, payload: unknown): void => {
        const data = JSON.stringify({ event, payload });
        for (const s of sockets) {
          if (s.readyState !== 1) continue;
          s.__fire("message", { data });
        }
      },
    };

    class FakeWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      url: string;
      readyState = FakeWebSocket.CONNECTING;
      onopen: ((ev: unknown) => void) | null = null;
      onmessage: ((ev: unknown) => void) | null = null;
      onclose: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      __frames: string[] = [];
      __listeners: Record<string, Array<(ev: unknown) => void>> = {};

      constructor(url: string | URL) {
        this.url = String(url);
        sockets.push(this);
        setTimeout(() => {
          if (this.readyState === FakeWebSocket.CONNECTING) {
            this.readyState = FakeWebSocket.OPEN;
            this.__fire("open", {});
          }
        }, 0);
      }

      __fire(type: string, ev: unknown): void {
        const handler = (this as any)["on" + type];
        if (typeof handler === "function") handler(ev);
        for (const listener of this.__listeners[type] ?? []) listener(ev);
      }

      send(data: string): void {
        this.__frames.push(data);
      }

      close(code = 1000, reason = ""): void {
        if (this.readyState >= FakeWebSocket.CLOSING) return;
        this.readyState = FakeWebSocket.CLOSED;
        this.__fire("close", { code, reason, wasClean: true });
      }

      addEventListener(type: string, listener: (ev: unknown) => void): void {
        (this.__listeners[type] ??= []).push(listener);
      }

      removeEventListener(type: string, listener: (ev: unknown) => void): void {
        this.__listeners[type] = (this.__listeners[type] ?? []).filter(
          (l) => l !== listener,
        );
      }
    }

    (window as any).WebSocket = FakeWebSocket;
  });
}

function createApiHandler(state: MessagingState, persona: string) {
  const otherAddress =
    persona === CLIENT_ADDRESS ? FREELANCER_ADDRESS : CLIENT_ADDRESS;

  const corsHeaders = (route: Route) => {
    const origin = route.request().headers()["origin"] || "*";
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Request-ID, X-CSRF-Token",
    };
  };

  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: corsHeaders(route),
      body: JSON.stringify(body),
    });

  return async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;

    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders(route) });
      return;
    }

    // ── Auth (SEP-0010) ──────────────────────────────────────────────────
    if (path === "/api/auth" && method === "GET") {
      await json(route, 200, { transaction: "MOCK_UNSIGNED_XDR" });
      return;
    }
    if (path === "/api/auth" && method === "POST") {
      await json(route, 200, {
        success: true,
        token: "e2e-jwt-token",
        csrfToken: "e2e-csrf-token",
      });
      return;
    }
    if (path === "/api/auth/refresh" && method === "POST") {
      await json(route, 200, {
        success: true,
        token: "e2e-jwt-token",
        csrfToken: "e2e-csrf-token",
      });
      return;
    }
    if (path === "/api/auth/csrf-token") {
      await json(route, 200, { csrfToken: "e2e-csrf-token" });
      return;
    }

    // ── Notification bell (Navbar) — full NotificationsResponse shape, ──
    // not an array, or NotificationBell crashes on render. Unread count is
    // tracked per persona, keyed off the messages that arrived for them.
    if (path === "/api/notifications" && method === "GET") {
      const items = state.notifications[persona] ?? [];
      await json(route, 200, {
        success: true,
        data: {
          notifications: items,
          unreadCount: items.filter((n) => !n.read).length,
          nextCursor: null,
          hasMore: false,
        },
      });
      return;
    }

    // ── Single job fetch (job detail page) ────────────────────────────────
    if (path === `/api/jobs/${JOB_ID}` && method === "GET") {
      await json(route, 200, { success: true, data: state.job });
      return;
    }

    // ── Message thread: history + send ────────────────────────────────────
    const messagesMatch = path.match(/^\/api\/messages\/job\/([^/]+)$/);
    if (messagesMatch && method === "GET") {
      await json(route, 200, {
        success: true,
        data: { messages: state.messages, nextCursor: null },
      });
      return;
    }
    if (messagesMatch && method === "POST") {
      const body = request.postDataJSON() as { content?: string };
      const content = (body.content ?? "").trim();
      const now = new Date().toISOString();
      const message: MockMessage = {
        id: `msg-${state.messages.length + 1}`,
        jobId: messagesMatch[1],
        senderAddress: persona,
        receiverAddress: otherAddress,
        content,
        read: false,
        createdAt: now,
      };
      state.messages.push(message);

      // Mirror the backend: creating a message notifies the *other* party.
      const inbox = (state.notifications[otherAddress] ??= []);
      inbox.push({
        id: `notif-${inbox.length + 1}`,
        userAddress: otherAddress,
        type: "NEW_MESSAGE",
        title: "New message",
        body: content.slice(0, 120),
        read: false,
        jobId: messagesMatch[1],
        linkPath: `/jobs/${messagesMatch[1]}`,
        createdAt: now,
      });

      await json(route, 201, { success: true, data: message });
      return;
    }
    if (path === "/api/messages/unread-count" && method === "GET") {
      const items = state.notifications[persona] ?? [];
      await json(route, 200, {
        success: true,
        data: { unreadCount: items.filter((n) => !n.read).length },
      });
      return;
    }

    // ── Skills autocomplete is a raw `fetch`, not axios — bare array ──────
    if (path === "/api/skills") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(route),
        body: JSON.stringify([]),
      });
      return;
    }

    // ── Everything else (time entries, applications, profile, templates…) ─
    await json(route, 200, { success: true, data: [] });
  };
}

async function installMessagingMocks(
  context: BrowserContext,
  state: MessagingState,
  persona: string,
) {
  // RegExp instead of glob so cross-origin requests to localhost:4000 are
  // intercepted too (axios baseURL).
  await context.route(/\/api\//, createApiHandler(state, persona));

  // External origins used by PriceContext / balance helpers.
  await context.route("https://api.coingecko.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stellar: { usd: 0.12 } }),
    });
  });
  await context.route("https://horizon*.stellar.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        balances: [{ asset_type: "native", balance: "1000.0000000" }],
      }),
    });
  });
}

/** Explicit wait: MessageThread's socket must have sent its room-subscribe frame. */
async function waitForRoomSubscription(page: Page) {
  await page.waitForFunction(
    (room) => {
      const frames: string[] =
        (window as any).__wsMock?.sentFrames?.() ?? [];
      return frames.some((frame) => frame.includes(room));
    },
    `job:${JOB_ID}`,
    { timeout: 20_000 },
  );
}

/** Deliver a `message:new` frame the way broadcastRealtime would: to every open socket. */
async function deliverMessageFrame(page: Page, message: MockMessage) {
  await page.evaluate(
    ({ jobId, message: payload }) => {
      (window as any).__wsMock.emit(`job:${jobId}:messages`, {
        type: "message:new",
        message: payload,
        jobId,
      });
    },
    { jobId: JOB_ID, message },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("messaging flow (#1893)", () => {
  test.slow();

  test("client and freelancer exchange messages in the job thread", async ({
    browser,
  }) => {
    const state = createMessagingState();

    const clientCtx = await browser.newContext();
    const freelancerCtx = await browser.newContext();

    try {
      for (const [ctx, persona] of [
        [clientCtx, CLIENT_ADDRESS],
        [freelancerCtx, FREELANCER_ADDRESS],
      ] as const) {
        await installFakeWebSocket(ctx);
        await installFreighter(ctx, persona);
        await installMessagingMocks(ctx, state, persona);
      }

      const clientPage = await clientCtx.newPage();
      const freelancerPage = await freelancerCtx.newPage();

      // ── Phase 1: both participants open the thread from the job ────────
      await clientPage.goto(`/jobs/${JOB_ID}`);
      await freelancerPage.goto(`/jobs/${JOB_ID}`);

      const clientThread = clientPage.getByTestId("message-thread");
      const freelancerThread = freelancerPage.getByTestId("message-thread");
      await expect(clientThread).toBeVisible({ timeout: 20_000 });
      await expect(freelancerThread).toBeVisible({ timeout: 20_000 });

      const emptyState = "No messages yet. Start the conversation!";
      await expect(clientThread.getByText(emptyState, { exact: true })).toBeVisible();
      await expect(freelancerThread.getByText(emptyState, { exact: true })).toBeVisible();

      // Both realtime sockets must have joined `job:<id>` before any
      // delivery — an explicit wait on the WS handshake, no sleeps.
      await waitForRoomSubscription(clientPage);
      await waitForRoomSubscription(freelancerPage);

      // ── Phase 2: client sends; freelancer receives over the WS ─────────
      await clientPage.getByPlaceholder("Type your message...").fill(MSG_FROM_CLIENT);
      await clientPage.getByRole("button", { name: "Send" }).click();

      // Optimistic row renders immediately, then the confirmed copy replaces it.
      await expect(
        clientThread.getByText(MSG_FROM_CLIENT, { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      // The POST resolved and the backend mock stored the message…
      await expect.poll(() => state.messages.length, { timeout: 10_000 }).toBe(1);

      // …but the freelancer has NOT seen it yet: nothing renders without the frame.
      await expect(
        freelancerThread.getByText(MSG_FROM_CLIENT, { exact: true }),
      ).toHaveCount(0);

      // Deliver the realtime frame (what broadcastRealtime does server-side).
      await deliverMessageFrame(freelancerPage, state.messages[0]);
      await expect(
        freelancerThread.getByText(MSG_FROM_CLIENT, { exact: true }),
      ).toBeVisible({ timeout: 10_000 });

      // ── Phase 3: freelancer replies; client receives over the WS ───────
      await freelancerPage
        .getByPlaceholder("Type your message...")
        .fill(MSG_FROM_FREELANCER);
      await freelancerPage.getByRole("button", { name: "Send" }).click();

      await expect(
        freelancerThread.getByText(MSG_FROM_FREELANCER, { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => state.messages.length, { timeout: 10_000 }).toBe(2);

      await expect(
        clientThread.getByText(MSG_FROM_FREELANCER, { exact: true }),
      ).toHaveCount(0);

      await deliverMessageFrame(clientPage, state.messages[1]);
      await expect(
        clientThread.getByText(MSG_FROM_FREELANCER, { exact: true }),
      ).toBeVisible({ timeout: 10_000 });

      // ── Phase 4: persistence on reload + unread badge ──────────────────
      await clientPage.reload();
      await expect(clientThread).toBeVisible({ timeout: 20_000 });
      await expect(
        clientThread.getByText(MSG_FROM_CLIENT, { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        clientThread.getByText(MSG_FROM_FREELANCER, { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      // The reply produced one unread notification for the client.
      await expect(clientPage.getByLabel("Notifications")).toContainText("1", {
        timeout: 15_000,
      });

      // ── Backend state sanity ────────────────────────────────────────────
      expect(state.messages.map((m) => m.content)).toEqual([
        MSG_FROM_CLIENT,
        MSG_FROM_FREELANCER,
      ]);
      expect(state.messages[0].senderAddress).toBe(CLIENT_ADDRESS);
      expect(state.messages[1].senderAddress).toBe(FREELANCER_ADDRESS);
      expect(
        state.notifications[CLIENT_ADDRESS].filter((n) => !n.read),
      ).toHaveLength(1);
      expect(
        state.notifications[FREELANCER_ADDRESS].filter((n) => !n.read),
      ).toHaveLength(1);
    } finally {
      await clientCtx.close();
      await freelancerCtx.close();
    }
  });
});
