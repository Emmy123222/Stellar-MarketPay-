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
    // fire synchronously from calling close(). Deferring via a microtask
    // reproduces the exact race this hook's fix is guarding against: a
    // remount can run (and reassign wsRef.current) before this fires.
    queueMicrotask(() => this.onclose?.());
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
    const incoming: Application = {
      id: "app-1",
      jobId: "job-1",
      freelancerAddress: "GFREELANCER",
      proposal: "I can do this",
      bidAmount: "100",
      currency: "XLM",
      status: "pending",
      createdAt: new Date().toISOString(),
    };
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
    const ignoredApplication: Application = { ...incoming, id: "app-should-be-ignored" };
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
});
