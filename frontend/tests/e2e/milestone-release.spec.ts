import { expect, test, type Page, type Route } from "@playwright/test";
import { CLIENT_ADDRESS, FREELANCER_ADDRESS } from "./helpers/marketplaceState";

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_ID = "job-milestone-1";
const JOB_TITLE = "Design a milestone-gated Soroban escrow demo";
const JOB_DESCRIPTION =
  "We need an experienced Soroban engineer to design and build a milestone-gated escrow demo contract with partial releases, plus integration tests for the release paths.";
const ESCROW_CONTRACT_ID = "CMOCKCONTRACTID";

const MILESTONES = [
  { description: "Research & design", amount: "250" },
  { description: "Implementation", amount: "250" },
  { description: "Final delivery", amount: "250" },
];

// ─── State shared between the route handlers ──────────────────────────────────
// Handlers run in Node (Playwright's router), so a plain object closure is
// enough to share mutations across navigations within the test.

interface MilestoneState {
  description: string;
  amount: string;
  status: "pending" | "released";
  releasedAt?: string;
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
  freelancerAddress?: string;
  escrowContractId?: string;
  applicantCount: number;
  createdAt: string;
  updatedAt: string;
  milestones?: MilestoneState[];
}

interface MockState {
  job: JobState | null;
}

function createMockState(): MockState {
  return { job: null };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function mockFreighter(page: Page, address: string) {
  await page.addInitScript((key) => {
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

async function installMilestoneMocks(page: Page, state: MockState) {
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

  // RegExp instead of glob so cross-origin requests to localhost:4000 are
  // intercepted too (axios baseURL).
  await page.route(/\/api\//, async (route) => {
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

    // ── Notification bell (Navbar) — must be the full NotificationsResponse
    // shape, not an array, or NotificationBell crashes on render ───────────
    if (path === "/api/notifications" && method === "GET") {
      await json(route, 200, {
        success: true,
        data: {
          notifications: [],
          unreadCount: 0,
          nextCursor: null,
          hasMore: false,
        },
      });
      return;
    }

    // ── Create job (post-job wizard) ─────────────────────────────────────
    if (path === "/api/jobs" && method === "POST") {
      const body = request.postDataJSON() as Record<string, any>;
      const now = new Date().toISOString();
      state.job = {
        id: JOB_ID,
        title: body.title || JOB_TITLE,
        description: body.description || JOB_DESCRIPTION,
        budget: String(body.budget ?? "750"),
        currency: body.currency || "XLM",
        category: body.category || "Smart Contracts",
        skills: Array.isArray(body.skills) ? body.skills : [],
        status: "open",
        clientAddress: body.clientAddress || CLIENT_ADDRESS,
        applicantCount: 0,
        createdAt: now,
        updatedAt: now,
        milestones: Array.isArray(body.milestones)
          ? body.milestones.map(
              (m: { description: string; amount: string }): MilestoneState => ({
                description: m.description,
                amount: String(m.amount),
                status: "pending",
              }),
            )
          : MILESTONES.map((m) => ({ ...m, status: "pending" as const })),
      };
      await json(route, 201, { success: true, data: state.job });
      return;
    }

    // ── Link escrow after creation ───────────────────────────────────────
    // Also seeds an accepted freelancer + in_progress status: the apply →
    // accept dance is covered by other specs, so this one focuses purely on
    // the client's milestone release journey (Issue #1894).
    if (/^\/api\/jobs\/[^/]+\/escrow$/.test(path) && method === "PATCH") {
      if (state.job) {
        state.job.escrowContractId = ESCROW_CONTRACT_ID;
        state.job.status = "in_progress";
        state.job.freelancerAddress = FREELANCER_ADDRESS;
        state.job.updatedAt = new Date().toISOString();
      }
      await json(route, 200, { success: true, data: state.job });
      return;
    }

    // ── Job drafts (auto-saved in the background while typing) ────────────
    if (path.startsWith("/api/jobs/drafts")) {
      await json(route, 200, { success: true, data: { id: "e2e-draft-1" } });
      return;
    }

    // ── Client's posted jobs (dashboard "Jobs Posted" tab) ────────────────
    if (path === `/api/jobs/client/${CLIENT_ADDRESS}` && method === "GET") {
      await json(route, 200, {
        success: true,
        data: state.job ? [state.job] : [],
      });
      return;
    }

    // ── Single job fetch (job detail page) ────────────────────────────────
    const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && method === "GET") {
      const job = state.job && jobMatch[1] === state.job.id ? state.job : null;
      await json(route, job ? 200 : 404, {
        success: Boolean(job),
        data: job,
      });
      return;
    }

    // ── Milestone release (backend record of the on-chain partial release) ─
    if (
      /^\/api\/escrow\/[^/]+\/release-milestone$/.test(path) &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as { milestoneIndex?: number };
      const index = typeof body.milestoneIndex === "number" ? body.milestoneIndex : -1;
      const milestone = state.job?.milestones?.[index];
      if (!state.job || !milestone) {
        await json(route, 404, { error: "JOB_NOT_FOUND" });
        return;
      }
      if (milestone.status === "released") {
        await json(route, 409, { error: "ESCROW_ALREADY_RELEASED" });
        return;
      }
      milestone.status = "released";
      milestone.releasedAt = new Date().toISOString();
      state.job.updatedAt = milestone.releasedAt;
      await json(route, 200, {
        success: true,
        data: {
          jobId: state.job.id,
          milestoneIndex: index,
          status: "released",
        },
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

    // ── Everything else (applications, categories, profile, templates…) ───
    await json(route, 200, { success: true, data: [] });
  });

  // External origins used by PriceContext / balance helpers.
  await page.route("https://api.coingecko.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stellar: { usd: 0.12 } }),
    });
  });
  await page.route("https://horizon*.stellar.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        balances: [
          { asset_type: "native", balance: "1000.0000000" },
        ],
      }),
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("milestone release flow (#1894)", () => {
  test.slow();

  test("client posts a milestone job and releases the first milestone", async ({
    page,
  }) => {
    const state = createMockState();

    await mockFreighter(page, CLIENT_ADDRESS);
    await installMilestoneMocks(page, state);

    // Start the post-job wizard with a clean form (no leftover local draft).
    await page.addInitScript(() =>
      localStorage.removeItem("marketpay_post_job_draft"),
    );

    // ── Phase 1: post a job with three 250 XLM milestones ─────────────────
    await page.goto("/post-job");

    const titleInput = page.getByPlaceholder("e.g. Build a Soroban DEX interface");
    await expect(titleInput).toBeVisible({ timeout: 20_000 });
    await titleInput.fill(JOB_TITLE);
    await page
      .getByPlaceholder("Describe the work, deliverables, and any context...")
      .fill(JOB_DESCRIPTION);
    await page.getByRole("button", { name: "Next →" }).click();

    // Step 2: budget must equal the milestone sum.
    await page.locator("#budget").fill("750");
    const descriptionInputs = page.getByPlaceholder("Milestone description");
    const amountInputs = page.getByPlaceholder("Amount");
    await descriptionInputs.nth(0).fill(MILESTONES[0].description);
    await amountInputs.nth(0).fill(MILESTONES[0].amount);
    await page.getByRole("button", { name: "+ Add" }).click();
    await descriptionInputs.nth(1).fill(MILESTONES[1].description);
    await amountInputs.nth(1).fill(MILESTONES[1].amount);
    await page.getByRole("button", { name: "+ Add" }).click();
    await descriptionInputs.nth(2).fill(MILESTONES[2].description);
    await amountInputs.nth(2).fill(MILESTONES[2].amount);
    await page.getByRole("button", { name: "Next →" }).click();

    // Step 3 → Step 4 → publish.
    await page.getByRole("button", { name: "Next →" }).click();
    await expect(page.getByText("3 milestones")).toBeVisible();
    await page.getByRole("button", { name: "Publish Job" }).click();

    // createEscrowOnChain runs the contract mock (~1.2s) before completing.
    await expect(page.getByRole("heading", { name: "Job Posted!" })).toBeVisible({
      timeout: 30_000,
    });

    // ── Phase 2: client opens the job and reviews the milestones ──────────
    await page.goto(`/jobs/${JOB_ID}`);

    const summary = page.getByTestId("milestone-release-summary");
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect(summary).toContainText("0 of 3 milestones released");
    await expect(summary).toContainText("750 XLM remaining in escrow");

    await expect(page.getByTestId("release-milestone-0")).toBeVisible();
    await expect(page.getByText("Research & design")).toBeVisible();
    await expect(page.getByText("Pending", { exact: false }).first()).toBeVisible();

    // ── Phase 3: release milestone 1 ──────────────────────────────────────
    // Contract mock (800ms) → POST /api/escrow/:id/release-milestone → job refetch.
    await page.getByTestId("release-milestone-0").click();

    await expect(page.getByTestId("milestone-0-released")).toBeVisible({
      timeout: 20_000,
    });
    await expect(summary).toContainText("1 of 3 milestones released");
    await expect(summary).toContainText("500 XLM remaining in escrow");

    // The remaining two milestones are still pending with their buttons intact.
    await expect(page.getByTestId("release-milestone-1")).toBeVisible();
    await expect(page.getByTestId("release-milestone-2")).toBeVisible();

    // ── Phase 4: dashboard reflects the partial release ───────────────────
    await page.goto("/dashboard");

    const progress = page.getByTestId(`milestone-progress-${JOB_ID}`);
    await expect(progress).toBeVisible({ timeout: 20_000 });
    await expect(progress).toContainText("250 XLM / 750 XLM released");
    await expect(page.getByRole("button", { name: /Jobs Posted \(1\)/ })).toBeVisible();

    // ── Phase 5: the contract mock recorded the partial release ───────────
    const stored = await page.evaluate(
      (jobId) =>
        window.localStorage.getItem(`marketpay_contract_mock_escrow:${jobId}`),
      JOB_ID,
    );
    expect(stored).toBeTruthy();
    const escrow = JSON.parse(stored as string);
    expect(escrow.releasedMilestones).toEqual([0]);
    expect(escrow.releasedAmount).toBe(String(250 * 10_000_000));
    expect(escrow.amount).toBe(String(750 * 10_000_000));

    // Backend record (mock API) agrees with the on-chain mock.
    expect(state.job?.milestones?.[0].status).toBe("released");
    expect(state.job?.milestones?.[1].status).toBe("pending");
    expect(state.job?.milestones?.[2].status).toBe("pending");
  });
});
