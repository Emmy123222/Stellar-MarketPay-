/**
 * __tests__/admin-analytics-debounce.test.tsx
 *
 * Issue #1510 — Search debounce & request cancellation for the admin
 * analytics audit-log filters.
 *
 * Verifies that:
 *   1. Ten rapid keystrokes produce exactly ONE API request after the
 *      500 ms debounce window completes.
 *   2. An in-flight request is aborted via AbortController as soon as a
 *      new keystroke cycle begins.
 *   3. The AbortSignal is forwarded into the axios request config.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import React from "react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFetchAuditLogs = jest.fn();
const mockFetchAdminMetrics = jest.fn();

jest.mock("@/lib/api", () => ({
  fetchAuditLogs: (...args: unknown[]) => mockFetchAuditLogs(...args),
  fetchAdminMetrics: (...args: unknown[]) => mockFetchAdminMetrics(...args),
}));

// Mock the shared axios client so the REAL fetchAuditLogs implementation can
// be inspected for AbortSignal pass-through without any network I/O.
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

// Mock chart.js / react-chartjs-2 to avoid canvas usage in jsdom.
jest.mock("chart.js", () => ({
  Chart: { register: jest.fn() },
  CategoryScale: jest.fn(),
  LinearScale: jest.fn(),
  PointElement: jest.fn(),
  LineElement: jest.fn(),
  BarElement: jest.fn(),
  Title: jest.fn(),
  Tooltip: jest.fn(),
  Legend: jest.fn(),
  ArcElement: jest.fn(),
}));

jest.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="chart-line" />,
  Bar: () => <div data-testid="chart-bar" />,
  Doughnut: () => <div data-testid="chart-doughnut" />,
}));

import AdminAnalytics from "@/components/AdminAnalytics";
import { fetchAuditLogs } from "@/lib/api/admin";
import { api } from "@/lib/api/client";

const MOCK_PK = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Complete metrics payload so the component renders past the loading gate. */
const METRICS_FIXTURE = {
  period: "30d",
  platformHealth: {
    total_jobs: 10,
    open_jobs: 4,
    completed_jobs: 5,
    disputed_jobs: 1,
    completion_rate: 80,
    dispute_rate: 10,
  },
  userGrowth: {
    total_users: 20,
    freelancers: 12,
    clients: 8,
    new_users_period: 3,
  },
  weeklyGrowth: [{ week: "2026-01-05T00:00:00.000Z", new_users: 2 }],
  financialMetrics: {
    total_xlm_escrow: 1000,
    total_xlm_released: 500,
    avg_job_budget: 200,
    active_escrows: 3,
  },
  qualityMetrics: { avg_rating: 4.5, total_ratings: 12, repeat_hires: 2 },
  disputeMetrics: [
    {
      week: "2026-01-05T00:00:00.000Z",
      disputes_opened: 1,
      disputes_resolved: 1,
    },
  ],
  topEarners: [],
  jobVolume: [
    { date: "2026-01-10T00:00:00.000Z", jobs_created: 3, jobs_completed: 2 },
  ],
};

describe("AdminAnalytics search debounce & AbortController (#1510)", () => {
  beforeEach(() => {
    // Full reset so per-test mockImplementation hooks never leak between tests.
    jest.resetAllMocks();
    mockFetchAdminMetrics.mockResolvedValue(METRICS_FIXTURE);
    mockFetchAuditLogs.mockResolvedValue({ logs: [], nextCursor: null });
  });

  it("fires exactly ONE API request after 10 rapid keystrokes once the 500ms debounce completes", async () => {
    render(<AdminAnalytics publicKey={MOCK_PK} />);

    // Wait for the initial mount fetch so we can measure only keystroke-driven
    // requests, then reset the counters.
    await waitFor(() => expect(mockFetchAuditLogs).toHaveBeenCalledTimes(1));
    const input = await screen.findByPlaceholderText("Filter by action...");
    mockFetchAuditLogs.mockClear();

    // Ten rapid keystrokes in sequence, no waiting in between.
    let typed = "";
    for (const ch of "disputes!!") {
      typed += ch;
      fireEvent.change(input, { target: { value: typed } });
    }

    // Still inside the debounce window — no request may have been fired yet.
    expect(mockFetchAuditLogs).not.toHaveBeenCalled();

    // After the 500 ms debounce period completes, exactly one request fires.
    await waitFor(() => expect(mockFetchAuditLogs).toHaveBeenCalledTimes(1), {
      timeout: 1500,
    });

    // It carries the final debounced value and an abort signal.
    expect(mockFetchAuditLogs).toHaveBeenCalledWith(
      { action: "disputes!!", resource_type: undefined },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // No follow-up request fires afterwards: the debounce collapsed all ten
    // keystrokes into this single request.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(mockFetchAuditLogs).toHaveBeenCalledTimes(1);
    // The metrics fetch is untouched by the debounce logic.
    expect(mockFetchAdminMetrics).toHaveBeenCalledTimes(1);
  });

  it("aborts the in-flight request as soon as a new keystroke cycle begins", async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst:
      ((v: { logs: unknown[]; nextCursor: string | null }) => void) | null =
      null;

    mockFetchAuditLogs.mockImplementation(
      (
        _params: unknown,
        config?: { signal?: AbortSignal },
      ): Promise<{ logs: unknown[]; nextCursor: string | null }> => {
        signals.push(config?.signal as AbortSignal);
        if (signals.length === 1) {
          // Hold the initial request in flight until the test resolves it.
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({ logs: [], nextCursor: null });
      },
    );

    render(<AdminAnalytics publicKey={MOCK_PK} />);
    const input = await screen.findByPlaceholderText("Filter by action...");

    // The initial request is in flight and not yet aborted.
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    // A keystroke cancels the in-flight request immediately, without
    // waiting for the debounce window to elapse.
    fireEvent.change(input, { target: { value: "a" } });
    expect(signals[0].aborted).toBe(true);

    // Once the debounce window completes, a fresh request starts with a
    // live (un-aborted) signal.
    await waitFor(() => expect(signals).toHaveLength(2), { timeout: 1500 });
    expect(signals[1].aborted).toBe(false);

    // Resolving the stale first request afterwards must not clobber state —
    // its result is discarded because its signal was aborted.
    await act(async () => {
      resolveFirst?.({ logs: [], nextCursor: null });
      await Promise.resolve();
    });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("passes no API request while the user is still typing (debounce window not elapsed)", async () => {
    render(<AdminAnalytics publicKey={MOCK_PK} />);
    const input = await screen.findByPlaceholderText(
      "Filter by resource type...",
    );
    mockFetchAuditLogs.mockClear();

    // Keystrokes spread across sub-500ms intervals keep resetting the window.
    for (let i = 1; i <= 5; i++) {
      fireEvent.change(input, { target: { value: "x".repeat(i) } });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200));
      });
      expect(mockFetchAuditLogs).not.toHaveBeenCalled();
    }

    // Only after typing stops for the full window does the request fire.
    await waitFor(() => expect(mockFetchAuditLogs).toHaveBeenCalledTimes(1), {
      timeout: 1500,
    });
    expect(mockFetchAuditLogs).toHaveBeenCalledWith(
      { action: undefined, resource_type: "xxxxx" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("forwards the AbortSignal into the axios request config (fetch/axios lifecycle)", async () => {
    const controller = new AbortController();
    (api.get as jest.Mock).mockResolvedValue({
      data: { success: true, data: [], nextCursor: null },
    });

    await fetchAuditLogs({ action: "dispute" }, { signal: controller.signal });

    expect(api.get).toHaveBeenCalledWith("/api/audit", {
      params: { action: "dispute" },
      signal: controller.signal,
    });
  });
});
