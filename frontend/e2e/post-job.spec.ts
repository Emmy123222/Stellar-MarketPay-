import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * e2e/post-job.spec.ts
 *
 * Covers the most critical user journey in the app: a client connects their
 * wallet, fills out the "Post a Job" form, submits it, and sees the new job
 * appear in the job listing.
 *
 * The Freighter wallet extension isn't available in CI, so `window.freighter`
 * is stubbed before any page script runs (see `mockFreighter`). All backend
 * calls are intercepted with `page.route` so the test doesn't depend on a
 * real API server — only the Next.js dev server started by
 * `playwright.config.ts` needs to be up.
 */

const walletAddress = "GCPOSTJOBE2ETESTADDRESS1234567890EXAMPLEABCDE";

const newJob = {
  title: "Build a responsive Soroban analytics dashboard",
  description:
    "We need an experienced frontend engineer to build a responsive analytics dashboard for our Soroban smart contract, including charts and real-time balance tracking.",
};

/** Stub the Freighter wallet extension so wallet connection never needs a real browser extension. */
async function mockFreighter(page: Page) {
  await page.addInitScript(
    ({ publicKey }) => {
      (window as any).freighter = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: true }),
        requestAccess: async () => ({ error: null }),
        getPublicKey: async () => ({ publicKey }),
        signTransaction: async () => ({ signedTransaction: "signed-xdr" }),
      };
    },
    { publicKey: walletAddress },
  );
}

/**
 * Mock every API call the app makes for the post-job journey:
 *  - SEP-0010 style auth challenge/verify (used to obtain a JWT on wallet connect)
 *  - CSRF token bootstrap (required before any mutating axios request)
 *  - job creation, escrow linking, and job listing
 *  - assorted background calls (skills autocomplete, categories, drafts, price feed)
 *
 * Job creation and listing share an in-memory array, so a job created via the
 * form actually shows up when the listing is queried afterwards.
 */
async function installApiMocks(page: Page) {
  const createdJobs: Record<string, unknown>[] = [];

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

  await page.route("**/api/**", async (route) => {
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
      await json(route, 200, { success: true, token: "e2e-jwt-token" });
      return;
    }

    // ── CSRF bootstrap (fetched before the first mutating request) ────────
    if (path === "/api/auth/csrf-token") {
      await json(route, 200, { csrfToken: "e2e-csrf-token" });
      return;
    }

    // ── Job drafts (auto-saved in the background while typing) ────────────
    if (path.startsWith("/api/jobs/drafts")) {
      await json(route, 200, { success: true, data: { id: "e2e-draft-1" } });
      return;
    }

    // ── Escrow linking after a job is created ──────────────────────────────
    if (/^\/api\/jobs\/[^/]+\/escrow$/.test(path) && method === "PATCH") {
      await json(route, 200, { success: true, data: {} });
      return;
    }

    // ── Create job ──────────────────────────────────────────────────────
    if (path === "/api/jobs" && method === "POST") {
      const body = request.postDataJSON() as Record<string, any>;
      const job = {
        id: "e2e-job-1",
        title: body.title,
        description: body.description,
        budget: body.budget,
        currency: body.currency || "XLM",
        category: body.category,
        skills: body.skills || [],
        status: "open",
        clientAddress: body.clientAddress,
        applicantCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      createdJobs.push(job);
      await json(route, 201, { success: true, data: job });
      return;
    }

    // ── List jobs (job board) ──────────────────────────────────────────────
    if (path === "/api/jobs" && method === "GET") {
      await json(route, 200, {
        success: true,
        data: createdJobs,
        next_cursor: null,
        has_more: false,
      });
      return;
    }

    // ── Single job fetch (job detail page) ─────────────────────────────────
    const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && method === "GET") {
      const job = createdJobs.find((j) => j.id === jobMatch[1]);
      await json(route, job ? 200 : 404, {
        success: Boolean(job),
        data: job || null,
      });
      return;
    }

    // ── Skills autocomplete is a raw `fetch`, not axios — return a bare array ──
    if (path === "/api/skills") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(route),
        body: JSON.stringify([]),
      });
      return;
    }

    // ── Everything else (categories, recommendations, reputation, etc.) ────
    await json(route, 200, { success: true, data: [] });
  });

  // XLM/USD price feed used by the Budget & Escrow step.
  await page.route("https://api.coingecko.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stellar: { usd: 0.12 } }),
    });
  });
}

test.describe("Post a job", () => {
  test("client connects wallet, posts a job, and sees it in the job listing", async ({
    page,
  }) => {
    await mockFreighter(page);
    await installApiMocks(page);

    // Navigating straight to /post-job triggers the app's silent wallet
    // auto-connect (Freighter is already "allowed"), which signs us in
    // without any explicit "Connect Wallet" click.
    await page.goto("/post-job");

    const titleInput = page.getByPlaceholder(
      "e.g. Build a Soroban DEX interface",
    );
    await expect(titleInput).toBeVisible({ timeout: 15_000 });

    // ── Step 1: Basic Info ──────────────────────────────────────────────
    await titleInput.fill(newJob.title);
    await page
      .getByPlaceholder("Describe the work, deliverables, and any context...")
      .fill(newJob.description);
    await page.getByRole("button", { name: "Next →" }).click();

    // ── Step 2: Budget & Escrow — defaults (50 XLM / 1 matching milestone) are valid ──
    await page.getByRole("button", { name: "Next →" }).click();

    // ── Step 3: Requirements — no required fields ────────────────────────
    await page.getByRole("button", { name: "Next →" }).click();

    // ── Step 4: Review & Publish ──────────────────────────────────────────
    await expect(page.getByText(newJob.title)).toBeVisible();
    await page.getByRole("button", { name: "Publish Job" }).click();

    // ── Success screen ────────────────────────────────────────────────────
    await expect(
      page.getByRole("heading", { name: "Job Posted!" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "View Job →" })).toBeVisible();

    // ── See the job in the listing ────────────────────────────────────────
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: newJob.title })).toBeVisible(
      { timeout: 15_000 },
    );
  });
});
