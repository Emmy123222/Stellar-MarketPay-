/**
 * __tests__/jobs-pagination-reset.test.tsx
 * Issue #857 — Verifies that changing a filter resets pagination instead of
 * combining a stale cursor (from before the filter change) with the new
 * filter on the next "load more" fetch.
 */
import { render, waitFor, act } from "@testing-library/react";
import { axe } from "jest-axe";
import React from "react";

// ── Controllable router mock ──────────────────────────────────────────────────
// Overrides the global static mock (jest.setup.tsx) with one whose `query`
// can change between renders, and whose `push` actually updates it — close
// enough to real Next.js router behavior for this test's purposes.
let mockQuery: Record<string, string | undefined> = {};
const mockPush = jest.fn((arg: { query: Record<string, string | undefined> }) => {
  mockQuery = arg.query;
});
jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/jobs",
    push: mockPush,
    query: mockQuery,
    isReady: true,
  }),
}));

// ── Other dependencies ─────────────────────────────────────────────────────────

jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", t: (key: string) => key },
    ready: true,
  }),
}));

jest.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({
    isSaved: () => false,
    toggleBookmark: jest.fn(),
    savedCount: 0,
    getSavedJobs: jest.fn(),
    bookmarks: [],
  }),
}));

jest.mock("@/lib/wallet", () => ({
  getConnectedPublicKey: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/components/JobFiltersPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="job-filters-panel" />,
  ActiveFilterChips: () => null,
}));

jest.mock("@/components/JobCard", () => ({
  __esModule: true,
  default: ({ job }: { job: { id: string } }) => <div data-testid={`job-card-${job.id}`} />,
  JobCardSkeleton: () => <div data-testid="job-card-skeleton" />,
}));

// A single mock "virtual item" whose index always satisfies the "near the
// end of the list, trigger load-more" condition for however many jobs are
// rendered, so the page's real infinite-scroll effect (not a test shortcut)
// is what fires `handleLoadMore`.
jest.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0, size: 200 }],
    getTotalSize: () => 200,
    scrollToIndex: jest.fn(),
  }),
}));

interface FetchJobsParams {
  category?: string;
  cursor?: string;
}
interface FetchJobsResult {
  jobs: unknown[];
  nextCursor: string | null;
}

const fetchJobsCalls: FetchJobsParams[] = [];
// Deferred response for the one call this test wants to hold "in flight"
// (the auto-triggered load-more for cursor-design-page1) so a filter change
// can happen while it's still pending.
let deferredDesignPage2Resolve: ((v: FetchJobsResult) => void) | null = null;

const fetchJobsMock = jest.fn(async (params: FetchJobsParams): Promise<FetchJobsResult> => {
  fetchJobsCalls.push(params);

  if (params.cursor === "cursor-design-page1") {
    return new Promise<FetchJobsResult>((resolve) => {
      deferredDesignPage2Resolve = resolve;
    });
  }

  if (params.cursor === undefined) {
    // Fresh page-1 load for whatever category is currently active.
    return {
      jobs: [{ id: `job-${params.category}-1`, category: params.category }],
      nextCursor: `cursor-${params.category}-page1`,
    };
  }

  // Any other cursor (e.g. a legitimate load-more for the *current* filter
  // after the race window) — resolve with no further pages so the test
  // doesn't need to drain an unbounded chain of auto-triggered loads.
  return { jobs: [], nextCursor: null };
});

jest.mock("@/lib/api", () => ({
  fetchJobs: (...args: [FetchJobsParams]) => fetchJobsMock(...args),
  fetchRecommendedJobs: jest.fn().mockResolvedValue([]),
  fetchJobSuggestions: jest.fn().mockResolvedValue([]),
  fetchSavedSearches: jest.fn().mockResolvedValue([]),
  createSavedSearch: jest.fn(),
}));

import JobsPage from "@/pages/jobs/index";

describe("jobs pagination reset on filter change (#857)", () => {
  beforeEach(() => {
    mockQuery = { category: "design" };
    mockPush.mockClear();
    fetchJobsMock.mockClear();
    fetchJobsCalls.length = 0;
    deferredDesignPage2Resolve = null;
  });

  it("does not combine a stale cursor with a new filter after the filter changes mid-flight", async () => {
    const { rerender } = render(<JobsPage />);

    // Initial page-1 load, then the auto-triggered load-more for
    // cursor-design-page1 — which this mock deliberately leaves pending.
    await waitFor(() =>
      expect(fetchJobsCalls.some((c) => c.cursor === "cursor-design-page1")).toBe(true),
    );
    await waitFor(() => expect(deferredDesignPage2Resolve).not.toBeNull());

    // Simulate `setFilter("category", "engineering")`: a new category, and
    // (matching the real handler) the page param reset in the URL query —
    // while the design-category load-more above is still unresolved.
    mockQuery = { category: "engineering" };
    act(() => {
      rerender(<JobsPage />);
    });

    // The reload effect (dependent on `category`) reruns and issues its own
    // fresh, cursor-less fetch for the new filter.
    await waitFor(() =>
      expect(
        fetchJobsCalls.some((c) => c.category === "engineering" && c.cursor === undefined),
      ).toBe(true),
    );

    // Now let the *stale* (category=design) load-more resolve. Without the
    // fix, `nextCursor` would still hold "cursor-design-page1" at the moment
    // `category` changed, and the auto-load effect could fire another
    // `fetchJobs` combining that stale cursor with the now-current
    // `engineering` category once this resolves. With the fix, `nextCursor`
    // was reset to null synchronously when `category` changed, so no such
    // call is ever made.
    await act(async () => {
      deferredDesignPage2Resolve?.({ jobs: [], nextCursor: "cursor-design-page2" });
      await Promise.resolve();
      await Promise.resolve();
    });

    const badCall = fetchJobsCalls.find(
      (c) => c.category === "engineering" && c.cursor && c.cursor.startsWith("cursor-design"),
    );
    expect(badCall).toBeUndefined();

    // The stale cursor from the design load-more's resolution must never be
    // used for a subsequent fetch at all, regardless of category.
    const usedStaleCursor = fetchJobsCalls.some((c) => c.cursor === "cursor-design-page2");
    expect(usedStaleCursor).toBe(false);
  });

  it("has no obvious axe violations", async () => {
    const { container } = render(<JobsPage />);
    await waitFor(() => expect(fetchJobsCalls.length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
