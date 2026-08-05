/**
 * __tests__/snapshots/pages.snap.test.tsx
 *
 * Snapshot tests for all four major page components.
 * Each component is rendered in its key UI states so regressions
 * in markup structure are caught automatically in CI.
 *
 * Mocking strategy:
 *   - useRouter  → mocked in jest.setup.tsx (global) + overridden per-test when queries differ
 *   - useWallet  → all lib/wallet exports mocked in snapshotMocks.tsx
 *   - SWR / API  → all lib/api exports mocked in snapshotMocks.tsx
 *   - Date       → pinned via jest.useFakeTimers / jest.setSystemTime to avoid snapshot drift
 */

import "../setup/snapshotMocks";

import { render } from "@testing-library/react";

// ─── Fixed-date mock — no time-based drift in CI ──────────────────────────────
const FIXED_DATE = new Date("2026-01-15T12:00:00.000Z");

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(FIXED_DATE);
});

afterAll(() => {
  jest.useRealTimers();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const noop = jest.fn();

/** Wrap in a fixed-width container so snapshot diffs are layout-independent. */
function snap(ui: React.ReactElement, label: string): void {
  const { container } = render(ui);
  expect(container.firstChild).toMatchSnapshot(label);
}

// ─── Sample data ──────────────────────────────────────────────────────────────

import type { Job } from "@/utils/types";

const MOCK_PK = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const completedJob: Job = {
  id: "job-snap-1",
  title: "Build a Soroban escrow contract for marketplace payouts",
  description: "Implement and test escrow release and refund flows on testnet.",
  budget: "500.0000000",
  currency: "XLM",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban"],
  status: "completed",
  clientAddress: MOCK_PK,
  applicantCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-10T00:00:00.000Z",
};

// ─── pages/index.tsx ──────────────────────────────────────────────────────────

import Home from "@/pages/index";

describe("pages/index.tsx snapshots", () => {
  it("renders unauthenticated landing page (no wallet)", () => {
    snap(
      <Home publicKey={null} onConnect={noop} completedJobs={[]} />,
      "Home — unauthenticated, no completed jobs",
    );
  });

  it("renders unauthenticated with completed jobs list", () => {
    snap(
      <Home publicKey={null} onConnect={noop} completedJobs={[completedJob]} />,
      "Home — unauthenticated, with completed job",
    );
  });

  it("renders authenticated (wallet connected)", () => {
    snap(
      <Home publicKey={MOCK_PK} onConnect={noop} completedJobs={[completedJob]} />,
      "Home — authenticated",
    );
  });
});

// ─── pages/dashboard.tsx ─────────────────────────────────────────────────────

/**
 * Dashboard uses multiple API calls (fetchMyJobs, fetchMyApplications, etc.)
 * and heavy dynamic imports.  We mock them all via snapshotMocks + override
 * the API mock for the dashboard-specific calls inline.
 *
 * The component renders synchronously before any useEffect fires, so the
 * snapshot captures the "loading / wallet-disconnected" shell, which is the
 * stable, non-time-dependent starting state.
 */

jest.mock("next/dynamic", () => ({
  __esModule: true,
  // next/dynamic calls: return a stable stub component
  default: (loader: () => Promise<{ default: React.ComponentType<unknown> }>, opts?: { loading?: () => React.ReactElement }) => {
    // Return the loading placeholder as a stable static component
    if (opts?.loading) {
      const Loading = opts.loading as React.ComponentType;
      const DynamicStub = (props: Record<string, unknown>) => <Loading {...props} />;
      DynamicStub.displayName = "DynamicStub";
      return DynamicStub;
    }
    const Stub = () => <div data-testid="dynamic-stub" />;
    Stub.displayName = "DynamicStub";
    return Stub;
  },
}));

jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn().mockResolvedValue("100"),
  getUSDCBalance: jest.fn().mockResolvedValue("0"),
  streamAccountTransactions: jest.fn().mockReturnValue(() => {}),
  isFreighterInstalled: jest.fn().mockResolvedValue(true),
  connectWallet: jest.fn().mockResolvedValue(MOCK_PK),
  accountUrl: jest.fn((key: string) => `https://stellar.expert/testnet/account/${key}`),
  isValidStellarAddress: jest.fn((a: string) => /^G[A-Z0-9]{55}$/.test(a)),
}));

jest.mock("@/hooks/useOnboarding", () => ({
  useOnboarding: () => ({
    loading: false,
    profile: null,
    progress: {
      hasAvatar: false,
      hasBio: false,
      hasSkills: false,
      hasPortfolio: false,
      hasAvailability: false,
      completionPercentage: 0,
      isComplete: false,
    },
    checklistItems: [],
    onboardingState: {
      hasSeenWelcome: false,
      checklistDismissed: false,
      dismissedTooltips: [],
      wizardCurrentStep: 0,
      wizardCompletedSteps: [],
      wizardDismissed: false,
      wizardCompleted: false,
    },
    shouldShowWelcome: false,
    shouldShowChecklist: false,
    shouldShowWizard: false,
    saveOnboardingState: jest.fn(),
    markWelcomeSeen: jest.fn(),
    dismissChecklist: jest.fn(),
    dismissTooltip: jest.fn(),
    dismissAllTooltips: jest.fn(),
    resetOnboarding: jest.fn(),
  }),
}));

import Dashboard from "@/pages/dashboard";

describe("pages/dashboard.tsx snapshots", () => {
  it("renders wallet-disconnected state", () => {
    snap(
      <Dashboard publicKey={null} onConnect={noop} />,
      "Dashboard — wallet disconnected",
    );
  });

  it("renders initial load state (wallet connected, data pending)", () => {
    snap(
      <Dashboard publicKey={MOCK_PK} onConnect={noop} />,
      "Dashboard — wallet connected, initial load",
    );
  });
});

// ─── pages/post-job.tsx ───────────────────────────────────────────────────────

import PostJob from "@/pages/post-job";

describe("pages/post-job.tsx snapshots", () => {
  beforeEach(() => {
    // Clear call history between tests; do NOT resetModules (would wipe all mocks)
    jest.clearAllMocks();
  });

  it("renders wallet-disconnected prompt", () => {
    snap(
      <PostJob publicKey={null} onConnect={noop} />,
      "PostJob — wallet disconnected",
    );
  });

  it("renders job-form when wallet is connected (no pre-fill)", () => {
    snap(
      <PostJob publicKey={MOCK_PK} onConnect={noop} />,
      "PostJob — wallet connected, empty form",
    );
  });

  it("renders job-form pre-filled with category query param", () => {
    // Temporarily override the global useRouter mock to inject a category query.
    // We use jest.spyOn on the already-mocked module rather than calling jest.mock()
    // inside a test (which Jest hoists and would stomp earlier module-level mocks).
    const routerMod = require("next/router");
    const spy = jest.spyOn(routerMod, "useRouter").mockReturnValue({
      pathname: "/post-job",
      push: jest.fn(),
      query: { category: "Smart Contracts" },
      isReady: true,
    });

    snap(
      <PostJob publicKey={MOCK_PK} onConnect={noop} />,
      "PostJob — wallet connected, category pre-filled",
    );

    spy.mockRestore();
  });
});

// ─── pages/notifications.tsx ─────────────────────────────────────────────────

import NotificationsPage from "@/pages/notifications";
import type { NotificationItem } from "@/utils/types";

const sampleNotification: NotificationItem = {
  id: "notif-snap-1",
  userAddress: MOCK_PK,
  type: "new_application",
  title: "New application received",
  body: "A freelancer has applied to your Smart Contracts job.",
  read: false,
  jobId: "job-snap-1",
  linkPath: "/jobs/job-snap-1",
  createdAt: "2026-01-14T09:00:00.000Z",
};

const readNotification: NotificationItem = {
  ...sampleNotification,
  id: "notif-snap-2",
  title: "Application accepted",
  body: "Your application was accepted.",
  read: true,
};

describe("pages/notifications.tsx snapshots", () => {
  it("renders connect-wallet prompt when no publicKey", () => {
    snap(
      <NotificationsPage publicKey={null} onConnect={noop} />,
      "Notifications — unauthenticated",
    );
  });

  it("renders loading state (wallet connected, data fetching)", () => {
    // fetchNotifications is mocked to never resolve during the synchronous
    // render — the component shows the loading skeleton.
    const { fetchNotifications } = require("@/lib/api");
    fetchNotifications.mockReturnValueOnce(new Promise(() => {})); // never resolves

    snap(
      <NotificationsPage publicKey={MOCK_PK} onConnect={noop} />,
      "Notifications — loading",
    );
  });

  it("renders empty state (authenticated, no notifications)", () => {
    snap(
      <NotificationsPage publicKey={MOCK_PK} onConnect={noop} />,
      "Notifications — empty list",
    );
  });

  it("renders populated notification list (mix of read and unread)", async () => {
    const { fetchNotifications } = require("@/lib/api");
    fetchNotifications.mockResolvedValueOnce({
      notifications: [sampleNotification, readNotification],
      unreadCount: 1,
      nextCursor: null,
    });

    const { container, findByText } = render(
      <NotificationsPage publicKey={MOCK_PK} onConnect={noop} />,
    );
    // Wait for the async load to settle
    await findByText("New application received");
    expect(container.firstChild).toMatchSnapshot("Notifications — populated list");
  });

  it("renders load-more button when nextCursor is present", async () => {
    const { fetchNotifications } = require("@/lib/api");
    fetchNotifications.mockResolvedValueOnce({
      notifications: [sampleNotification],
      unreadCount: 1,
      nextCursor: "cursor-abc123",
    });

    const { container, findByText } = render(
      <NotificationsPage publicKey={MOCK_PK} onConnect={noop} />,
    );
    await findByText("New application received");
    expect(container.firstChild).toMatchSnapshot("Notifications — with load-more button");
  });
});
