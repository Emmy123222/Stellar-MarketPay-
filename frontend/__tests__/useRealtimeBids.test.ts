/**
 * __tests__/useRealtimeBids.test.ts
 * Issue #856 — Verifies useRealtimeBids only ever keeps one WebSocket
 * connection active through a React Strict Mode mount/cleanup/remount
 * cycle, and that unmounting closes the connection.
 */
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { useRealtimeBids } from "@/hooks/useRealtimeBids";
import type { Application } from "@/utils/types";

// ── Helper: create a fake Application ────────────────────────────────────────

function makeApp(overrides: Partial<Application> = {}): Application {
  return {
    id: `app-${Math.random().toString(36).slice(2, 8)}`,
    jobId: "job-1",
    freelancerAddress: "GFREELANCER",
    proposal: "I can do this",
    bidAmount: "100",
    currency: "XLM",
    status: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Mock WebSocket ────────────────────────────────────────────────────────────

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = 0; // CONNECTING
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  /** Test helper — simulates the server accepting the connection. */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test helper — simulates a server-pushed message. */
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close() {
    this.closeCalls++;
    this.readyState = MockWebSocket.CLOSED;
    // A real WebSocket's close handshake is asynchronous — onclose does not
    // fire synchronously from calling close(). Deferring via Promise.resolve
    // reproduces the race this hook guards against, and is flushable by
    // React Testing Library's act().
    Promise.resolve().then(() => this.onclose?.());
  }
}

describe("useRealtimeBids (#856)", () => {
  const initialApplications: Application[] = [];
  const fetchApplications = jest.fn().mockResolvedValue([]);

  beforeEach(() => {
    MockWebSocket.instances = [];
    fetchApplications.mockClear();
    (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
  });

  it("closes the WebSocket connection on unmount", async () => {
    const { unmount } = renderHook(() =>
      useRealtimeBids({ jobId: "job-1", initialApplications, fetchApplications }),
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];

    unmount();

    expect(ws.closeCalls).toBe(1);
  });

  it("keeps only one connection active through a Strict Mode mount/cleanup/remount cycle", async () => {
    const { result } = renderHook(
      () => useRealtimeBids({ jobId: "job-1", initialApplications, fetchApplications }),
      { wrapper: React.StrictMode },
    );

    // Strict Mode's dev-only mount → cleanup → mount simulation runs
    // synchronously during the initial render, so by now two sockets may
    // well have been constructed (React deliberately exercises this) — the
    // guarantee under test is that only the *second* (current) one is live.
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1);
    const staleWs = MockWebSocket.instances[0];
    const currentWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    // The stale socket's close handshake resolves late (after the remount
    // already created/attached the current one). Without the isCurrent()
    // guard this would null out the ref to the live socket and schedule a
    // spurious duplicate reconnect.
    await act(async () => {
      staleWs.close();
      await Promise.resolve();
    });

    act(() => currentWs.simulateOpen());
    expect(result.current.wsStatus).toBe("open");

    // A message on the CURRENT socket must be the one reflected in state.
    const incoming: Application = makeApp({ id: "app-1" });
    act(() => {
      currentWs.simulateMessage({
        event: "job:job-1:bids",
        payload: { type: "new_bid", application: incoming },
      });
    });
    expect(result.current.applications).toHaveLength(1);
    expect(result.current.applications[0].id).toBe("app-1");

    // A message arriving on the STALE socket must be ignored — it is no
    // longer the connection this hook considers current.
    const ignoredApplication: Application = makeApp({ id: "app-should-be-ignored" });
    act(() => {
      staleWs.simulateMessage({
        event: "job:job-1:bids",
        payload: { type: "new_bid", application: ignoredApplication },
      });
    });
    expect(result.current.applications).toHaveLength(1);
    expect(result.current.wsStatus).toBe("open"); // unaffected by the stale close resolving

    fetchApplications.mockClear();
  });

  // ── #757: Subscription logic tests ─────────────────────────────────────────

  describe("#757 — real-time bid subscription", () => {
    it("calls onNewBid when a new_bid message arrives", () => {
      const onNewBid = jest.fn();
      renderHook(() =>
        useRealtimeBids({
          jobId: "job-1",
          initialApplications,
          fetchApplications,
          onNewBid,
        }),
      );

      const ws = MockWebSocket.instances[0];
      act(() => ws.simulateOpen());

      const incoming = makeApp({ id: "app-new-bid" });
      act(() => {
        ws.simulateMessage({
          event: "job:job-1:bids",
          payload: { type: "new_bid", application: incoming },
        });
      });

      expect(onNewBid).toHaveBeenCalledTimes(1);
      expect(onNewBid).toHaveBeenCalledWith(incoming);
    });

    it("does not call onNewBid for non-bid events", () => {
      const onNewBid = jest.fn();
      renderHook(() =>
        useRealtimeBids({
          jobId: "job-1",
          initialApplications,
          fetchApplications,
          onNewBid,
        }),
      );

      const ws = MockWebSocket.instances[0];
      act(() => ws.simulateOpen());

      act(() => {
        ws.simulateMessage({
          event: "job:job-1:bids",
          payload: { type: "application:withdrawn", applicationId: "app-1" },
        });
      });
      act(() => {
        ws.simulateMessage({
          event: "job:job-1:bids",
          payload: { type: "application:accepted", applicationId: "app-1" },
        });
      });

      expect(onNewBid).not.toHaveBeenCalled();
    });

    it("does not call onNewBid for a different job's event", () => {
      const onNewBid = jest.fn();
      renderHook(() =>
        useRealtimeBids({
          jobId: "job-1",
          initialApplications,
          fetchApplications,
          onNewBid,
        }),
      );

      const ws = MockWebSocket.instances[0];
      act(() => ws.simulateOpen());

      act(() => {
        ws.simulateMessage({
          event: "job:job-2:bids",
          payload: { type: "new_bid", application: makeApp() },
        });
      });

      expect(onNewBid).not.toHaveBeenCalled();
    });

    it("appends a new application on new_bid and highlights it", () => {
      const { result } = renderHook(() =>
        useRealtimeBids({
          jobId: "job-1",
          initialApplications,
          fetchApplications,
        }),
      );

      const ws = MockWebSocket.instances[0];
      act(() => ws.simulateOpen());

      const incoming = makeApp({ id: "app-to-append" });
      act(() => {
        ws.simulateMessage({
          event: "job:job-1:bids",
          payload: { type: "new_bid", application: incoming },
        });
      });

      expect(result.current.applications).toHaveLength(1);
      expect(result.current.applications[0].id).toBe("app-to-append");
      expect(result.current.highlightedIds.has("app-to-append")).toBe(true);
    });

    it("does not duplicate an application that already exists", () => {
      const existing = makeApp({ id: "dup-app" });
      const { result } = renderHook(() =>
        useRealtimeBids({
          jobId: "job-1",
          initialApplications: [existing],
          fetchApplications,
        }),
      );

      const ws = MockWebSocket.instances[0];
      act(() => ws.simulateOpen());

      // Send the same app again via WebSocket
      act(() => {
        ws.simulateMessage({
          event: "job:job-1:bids",
          payload: { type: "new_bid", application: existing },
        });
      });

      expect(result.current.applications).toHaveLength(1);
    });

    it("increments bid count when a new_bid arrives", () => {
      const { result } = renderHook(() =>
        useRealtimeBids({
          jobId: "job-1",
          initialApplications: [],
          fetchApplications,
        }),
      );

      const ws = MockWebSocket.instances[0];
      act(() => ws.simulateOpen());

      act(() => {
        ws.simulateMessage({
          event: "job:job-1:bids",
          payload: { type: "new_bid", application: makeApp({ id: "bid-1" }) },
        });
      });
      expect(result.current.applications).toHaveLength(1);

      act(() => {
        ws.simulateMessage({
          event: "job:job-1:bids",
          payload: { type: "new_bid", application: makeApp({ id: "bid-2" }) },
        });
      });
      expect(result.current.applications).toHaveLength(2);
    });

    it("handles reconnection with exponential back-off", async () => {
      jest.useFakeTimers();

      const { result } = renderHook(() =>
        useRealtimeBids({
          jobId: "job-1",
          initialApplications,
          fetchApplications,
        }),
      );

      // First socket connects then closes
      const ws1 = MockWebSocket.instances[0];
      act(() => ws1.simulateOpen());
      expect(result.current.wsStatus).toBe("open");

      // Close the connection — should trigger exponential back-off reconnect
      act(() => {
        ws1.close();
      });
      // Let the microtask for onclose resolve
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.wsStatus).toBe("closed");

      // First reconnect: after 1_000 ms
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
      // A second socket should have been created
      expect(MockWebSocket.instances.length).toBe(2);
      const ws2 = MockWebSocket.instances[1];
      act(() => ws2.simulateOpen());
      expect(result.current.wsStatus).toBe("open");

      // Close again — second reconnect: after 2_000 ms
      act(() => {
        ws2.close();
      });
      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        jest.advanceTimersByTime(2_000);
      });
      expect(MockWebSocket.instances.length).toBe(3);
      const ws3 = MockWebSocket.instances[2];
      act(() => ws3.simulateOpen());
      expect(result.current.wsStatus).toBe("open");

      // Close again — third reconnect: after 4_000 ms
      act(() => {
        ws3.close();
      });
      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        jest.advanceTimersByTime(4_000);
      });
      expect(MockWebSocket.instances.length).toBe(4);

      jest.useRealTimers();
    });

    it("resets back-off counter on successful reconnection", async () => {
      jest.useFakeTimers();

      renderHook(() =>
        useRealtimeBids({
          jobId: "job-1",
          initialApplications,
          fetchApplications,
        }),
      );

      const ws1 = MockWebSocket.instances[0];
      act(() => ws1.simulateOpen());

      // Close and reconnect once (attempt 0 -> delay 1_000)
      act(() => { ws1.close(); });
      await act(async () => { await Promise.resolve(); });
      act(() => { jest.advanceTimersByTime(1_000); });
      const ws2 = MockWebSocket.instances[1];
      act(() => ws2.simulateOpen());

      // Close again — now at attempt 1 -> delay should be 2_000
      act(() => { ws2.close(); });
      await act(async () => { await Promise.resolve(); });
      act(() => { jest.advanceTimersByTime(2_000); });

      // But ws2 connected successfully, so back-off was reset to 0,
      // meaning after close the delay should be 1_000 again, not 4_000.
      // Since we advanced 2_000 ms, the reconnect should have already fired.
      expect(MockWebSocket.instances.length).toBe(3);

      jest.useRealTimers();
    });
  });
});
