/**
 * __tests__/realtime-bid-comparison.test.tsx
 * Issue #867 — RealtimeBidComparison must update live as new bids arrive
 * over the `job:{id}:bids` WebSocket event, rather than only showing the
 * applications it was initially rendered with.
 *
 * Uses a mocked WebSocket (jsdom does not implement a real one) to drive
 * the component through useRealtimeBids.
 */
import { render, screen, act, cleanup } from "@testing-library/react";
import { ToastProvider } from "@/components/Toast";
import RealtimeBidComparison from "@/components/RealtimeBidComparison";
import type { Application } from "@/utils/types";

// ── Mock WebSocket ────────────────────────────────────────────────────────────

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  /** Test helper — simulate the server accepting the connection. */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test helper — simulate an inbound `{event, payload}` frame. */
  simulateMessage(event: string, payload: unknown) {
    this.onmessage?.({ data: JSON.stringify({ event, payload }) });
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const originalWebSocket = global.WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
  // @ts-expect-error — test double, not a full WebSocket implementation
  global.WebSocket = MockWebSocket;
});

afterEach(() => {
  cleanup();
  global.WebSocket = originalWebSocket;
  jest.restoreAllMocks();
});

function renderComparison(props: Partial<React.ComponentProps<typeof RealtimeBidComparison>> = {}) {
  return render(
    <ToastProvider>
      <RealtimeBidComparison
        jobId="job-1"
        initialApplications={[]}
        isClient
        {...props}
      />
    </ToastProvider>,
  );
}

const newApplication: Application = {
  id: "app-new",
  jobId: "job-1",
  freelancerAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  proposal: "I can deliver this within a week using Soroban.",
  bidAmount: "300.0000000",
  currency: "XLM",
  status: "pending",
  createdAt: "2026-01-15T00:00:00.000Z",
};

describe("RealtimeBidComparison — live updates over WebSocket (#867)", () => {
  it("connects to /ws/realtime scoped by job id", () => {
    renderComparison();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain("/ws/realtime");
  });

  it("appends a new bid the moment a job:{id}:bids new_bid event arrives", () => {
    renderComparison();
    const ws = MockWebSocket.instances[0];

    expect(screen.queryByText(/I can deliver this within a week/)).not.toBeInTheDocument();

    act(() => {
      ws.simulateOpen();
      ws.simulateMessage("job:job-1:bids", {
        type: "new_bid",
        application: newApplication,
      });
    });

    expect(screen.getByText(/I can deliver this within a week/)).toBeInTheDocument();
    expect(screen.getByText(/Applications \(1\)/)).toBeInTheDocument();
  });

  it("ignores bid events for a different job id", () => {
    renderComparison();
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateOpen();
      ws.simulateMessage("job:some-other-job:bids", {
        type: "new_bid",
        application: newApplication,
      });
    });

    expect(screen.queryByText(/I can deliver this within a week/)).not.toBeInTheDocument();
    expect(screen.getByText(/Applications \(0\)/)).toBeInTheDocument();
  });

  it("does not duplicate a bid that is already in the list", () => {
    renderComparison({ initialApplications: [newApplication] });
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateOpen();
      ws.simulateMessage("job:job-1:bids", {
        type: "new_bid",
        application: newApplication,
      });
    });

    expect(screen.getByText(/Applications \(1\)/)).toBeInTheDocument();
  });

  it("removes a bid when application:withdrawn arrives", () => {
    jest.useFakeTimers();
    renderComparison({ initialApplications: [newApplication] });
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateOpen();
      ws.simulateMessage("job:job-1:bids", {
        type: "application:withdrawn",
        applicationId: newApplication.id,
      });
      jest.advanceTimersByTime(500); // past the fade-out timeout
    });

    expect(screen.getByText(/Applications \(0\)/)).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("does not reconnect the WebSocket across re-renders (regression for #867)", () => {
    // RealtimeBidComparison doesn't pass a `fetchApplications` prop, so it
    // falls back to an inline `() => Promise.resolve(initialApplications)`
    // — a new function identity on every render. If useRealtimeBids ever
    // depends on that identity again, this test will start failing because
    // a second WebSocket gets opened.
    renderComparison();
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.simulateOpen();
      ws.simulateMessage("job:job-1:bids", {
        type: "new_bid",
        application: newApplication,
      });
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
  });

  it("shows a live indicator once the socket reports open", () => {
    renderComparison();
    const ws = MockWebSocket.instances[0];

    expect(screen.queryByText("Live")).not.toBeInTheDocument();

    act(() => {
      ws.simulateOpen();
    });

    expect(screen.getByText("Live")).toBeInTheDocument();
    // The connection must not have been torn down and reopened as a
    // side effect of the resulting re-render (that reconnect churn was
    // the root cause of #867).
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
