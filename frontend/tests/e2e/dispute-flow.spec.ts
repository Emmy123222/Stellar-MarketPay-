import { expect, test, type Page } from "@playwright/test";
import { CLIENT_ADDRESS, FREELANCER_ADDRESS } from "./helpers/marketplaceState";

// ─── Constants ────────────────────────────────────────────────────────────────

const ADMIN_ADDRESS = "GADMINMEDIATOR000000000000EXAMPLEABCDEFGHIJKLMNOPQR";
const JOB_ID = "job-dispute-1";
const DISPUTE_STATE_KEY = "__DISPUTE_MOCK_STATE__";
const INITIAL_CLIENT_BALANCE = 10_000;
const INITIAL_FREELANCER_BALANCE = 5_000;
const JOB_BUDGET = 500;

// ─── JWT factory ──────────────────────────────────────────────────────────────

function makeJwt(role: string, sub: string): string {
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    role,
    sub,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${payload}.fakesig`;
}

// ─── State shape ──────────────────────────────────────────────────────────────

interface DisputeState {
  job: {
    id: string;
    title: string;
    status: string;
    client_address: string;
    freelancer_address: string;
    created_at: string;
    budget: string;
    currency: string;
  };
  evidence: Array<{
    id: string;
    uploaderAddress: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    ipfsCid: string;
    gatewayUrl: string;
    createdAt: string;
  }>;
  balances: Record<string, number>;
  resolution: string | null;
}

function createDisputeState(): DisputeState {
  return {
    job: {
      id: JOB_ID,
      title: "Build Soroban escrow for freelance marketplace",
      status: "disputed",
      client_address: CLIENT_ADDRESS,
      freelancer_address: FREELANCER_ADDRESS,
      created_at: "2026-01-01T00:00:00.000Z",
      budget: String(JOB_BUDGET),
      currency: "XLM",
    },
    evidence: [],
    balances: {
      [CLIENT_ADDRESS]: INITIAL_CLIENT_BALANCE,
      [FREELANCER_ADDRESS]: INITIAL_FREELANCER_BALANCE,
    },
    resolution: null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function mockFreighter(page: Page, address: string) {
  await page.addInitScript((key) => {
    // Track the active persona so the XHR auth handler returns the right JWT.
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

async function installDisputeMocks(
  page: Page,
  initialState: DisputeState,
  clientJwt: string,
  adminJwt: string,
) {
  // ── Dual-layer approach ──────────────────────────────────────────────────
  // Layer 1: XHR patch (intercepts Axios before any HTTP traffic).
  // Layer 2: page.route() (safety net + external origins).
  //
  // State is kept in sessionStorage so it survives navigations within the
  // test session without being reset.

  await page.addInitScript(
    ({
      initialState: state,
      stateKey,
      cJwt,
      aJwt,
      adminAddr,
      jobId,
      clientAddr,
      freelancerAddr,
    }: {
      initialState: DisputeState;
      stateKey: string;
      cJwt: string;
      aJwt: string;
      adminAddr: string;
      jobId: string;
      clientAddr: string;
      freelancerAddr: string;
    }) => {
      // Initialise only on first navigation; subsequent ones preserve mutations.
      if (!sessionStorage.getItem(stateKey)) {
        sessionStorage.setItem(stateKey, JSON.stringify(state));
      }

      const getState = (): typeof state => {
        try {
          return JSON.parse(sessionStorage.getItem(stateKey) || "{}") as typeof state;
        } catch {
          return state;
        }
      };
      const putState = (s: typeof state) =>
        sessionStorage.setItem(stateKey, JSON.stringify(s));

      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method: string, url: string | URL) {
        (this as any).__url =
          typeof url === "string" ? url : (url as any).href;
        (this as any).__method = method;
        return origOpen.apply(this, arguments as any);
      };

      XMLHttpRequest.prototype.send = function (body?: any) {
        const url: string = (this as any).__url || "";
        const method: string = (this as any).__method || "GET";
        const xhr = this;

        if (!url.includes("/api/")) {
          return origSend.apply(this, arguments as any);
        }

        const pathname = new URL(url, window.location.origin).pathname;
        let status = 200;
        let responseData: any;

        // ── Auth (SEP-0010) ─────────────────────────────────────────────
        if (pathname.startsWith("/api/auth")) {
          if (method !== "POST") {
            responseData = { transaction: "challenge-xdr" };
          } else {
            // Return admin JWT when the active Freighter key is the admin address.
            const activeKey = (window as any).__currentFreighterKey__;
            responseData = {
              success: true,
              token: activeKey === adminAddr ? aJwt : cJwt,
            };
          }
        }

        // ── Dispute detail ─────────────────────────────────────────────
        else if (pathname === `/api/disputes/${jobId}` && method === "GET") {
          const s = getState();
          responseData = { success: true, data: { job: s.job, evidence: s.evidence } };
        }

        // ── Evidence upload (multipart FormData) ──────────────────────
        // Handle entirely inside the XHR interceptor (same JS context) so
        // sessionStorage is updated synchronously. page.evaluate() from inside
        // a page.route() handler is unreliable for cross-origin FormData POST
        // because the browser is mid-request during the cross-process round-trip.
        else if (
          pathname === `/api/disputes/${jobId}/evidence` &&
          method === "POST"
        ) {
          // 1. Update state immediately (synchronous).
          const s = getState();
          if (!s.evidence) s.evidence = [];
          const ev = {
            id: "ev-1",
            uploaderAddress: clientAddr,
            fileName: "evidence.png",
            fileSize: 1024,
            mimeType: "image/png",
            ipfsCid: "QmTestCidFixed123",
            gatewayUrl: "https://ipfs.io/ipfs/QmTestCidFixed123",
            createdAt: new Date().toISOString(),
          };
          s.evidence.push(ev);
          putState(s);

          // 2. Fake a 201 response so Axios resolves cleanly.
          const responseBody = JSON.stringify({ success: true, data: ev });
          setTimeout(() => {
            try { Object.defineProperty(xhr, "readyState",    { value: 4,            configurable: true }); } catch (_) {}
            try { Object.defineProperty(xhr, "status",        { value: 201,          configurable: true }); } catch (_) {}
            try { Object.defineProperty(xhr, "responseText",  { value: responseBody, configurable: true }); } catch (_) {}
            xhr.dispatchEvent(new Event("readystatechange"));
            xhr.dispatchEvent(new Event("load"));
            xhr.dispatchEvent(new Event("loadend"));
          }, 50);
          return; // Don't call origSend — no real network request needed.
        }

        // ── Resolve dispute ─────────────────────────────────────────────
        else if (pathname === `/api/jobs/${jobId}/resolve` && method === "POST") {
          const s = getState();
          let releaseTo = "freelancer";
          try {
            // After the bug-fix, body is JSON: { note, releaseTo }
            const parsed = JSON.parse(body as string);
            if (typeof parsed.releaseTo === "string") releaseTo = parsed.releaseTo;
          } catch {
            // FormData or missing body — keep default
          }
          s.job.status = "resolved";
          s.resolution = releaseTo;
          const budget = parseFloat(s.job.budget);
          if (releaseTo === "client") {
            s.balances[clientAddr] += budget;
          } else {
            s.balances[freelancerAddr] += budget;
          }
          putState(s);
          responseData = { success: true, data: s.job };
        }

        // ── Admin — open dispute list ───────────────────────────────────
        else if (pathname === "/api/admin/disputes" && method === "GET") {
          const s = getState();
          const row =
            s.job.status === "disputed"
              ? [
                  {
                    job_id: s.job.id,
                    job_title: s.job.title,
                    job_status: s.job.status,
                    client_address: s.job.client_address,
                    freelancer_address: s.job.freelancer_address,
                    budget: s.job.budget,
                    currency: s.job.currency,
                  },
                ]
              : [];
          responseData = { success: true, data: row };
        }

        // ── Admin — 2FA gate (bypass: always report ready) ─────────────
        else if (pathname === "/api/admin/2fa/status") {
          responseData = {
            success: true,
            data: { totp_enabled: true, verified: true },
          };
        }

        // ── Admin metrics (AdminAnalytics renders charts from this) ────
        // Must return the full MetricsData shape; an empty array would make
        // metrics.weeklyGrowth.map() throw and trigger the error boundary.
        else if (pathname === "/api/admin/metrics") {
          responseData = {
            success: true,
            data: {
              period: "30d",
              platformHealth: { total_jobs: 0, open_jobs: 0, completed_jobs: 0, disputed_jobs: 0, completion_rate: 0, dispute_rate: 0 },
              userGrowth: { total_users: 0, freelancers: 0, clients: 0, new_users_period: 0 },
              weeklyGrowth: [],
              financialMetrics: { total_xlm_escrow: 0, total_xlm_released: 0, avg_job_budget: 0, active_escrows: 0 },
              qualityMetrics: { avg_rating: 0, total_ratings: 0, repeat_hires: 0 },
              disputeMetrics: [],
              topEarners: [],
              jobVolume: [],
            },
          };
        }

        // ── Other admin endpoints (logs, reports, wallets) ─────────────
        else if (pathname.startsWith("/api/admin/")) {
          responseData = { success: true, data: [] };
        }

        // ── Catch-all ──────────────────────────────────────────────────
        else {
          responseData = { success: true, data: [] };
        }

        setTimeout(() => {
          Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
          Object.defineProperty(xhr, "status", {
            value: status,
            configurable: true,
          });
          Object.defineProperty(xhr, "responseText", {
            value: JSON.stringify(responseData),
            configurable: true,
          });
          xhr.dispatchEvent(new Event("readystatechange"));
          xhr.dispatchEvent(new Event("load"));
          xhr.dispatchEvent(new Event("loadend"));
        }, 10);
      };
    },
    {
      initialState,
      stateKey: DISPUTE_STATE_KEY,
      cJwt: clientJwt,
      aJwt: adminJwt,
      adminAddr: ADMIN_ADDRESS,
      jobId: JOB_ID,
      clientAddr: CLIENT_ADDRESS,
      freelancerAddr: FREELANCER_ADDRESS,
    },
  );

  // ── Layer 2: network-level routes (external origins + CORS preflight) ──
  await page.route("https://api.coingecko.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({ stellar: { usd: 0.12 } }),
    });
  });

  // Catch-all (registered first → LIFO means it's checked last, after the
  // evidence-upload route below). RegExp instead of glob so it matches
  // cross-origin requests to localhost:4000 (globs only match same-origin).
  await page.route(/\/api\//, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      });
    }
  });

}

// Switch persona helpers — clear the stored wallet key before each goto so the
// old publicKey from the previous persona doesn't interfere with React's
// hydration useEffect in _app.tsx.

async function switchToClient(page: Page) {
  await page.evaluate(() =>
    localStorage.removeItem("smp_wallet_public_key"),
  );
  await mockFreighter(page, CLIENT_ADDRESS);
}

async function switchToAdmin(page: Page) {
  await page.evaluate(() =>
    localStorage.removeItem("smp_wallet_public_key"),
  );
  await mockFreighter(page, ADMIN_ADDRESS);
}

// ─── Shared evidence-upload phase ─────────────────────────────────────────────

async function uploadEvidenceAsClient(page: Page, fileName: string) {
  await expect(
    page.getByRole("heading", { name: "Dispute" }),
  ).toBeVisible({ timeout: 10_000 });

  const fileInput = page.locator("#evidence-upload");

  // ── File boundary: invalid MIME type must be rejected client-side ──────
  await fileInput.setInputFiles({
    name: "payload.exe",
    mimeType: "application/x-msdownload",
    buffer: Buffer.from("MZ"),
  });
  await expect(
    page.getByText("Only images, PDFs, and plain text files are allowed."),
  ).toBeVisible();

  // ── Valid PNG evidence file ────────────────────────────────────────────
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: "image/png",
    buffer: Buffer.from("PNG_PLACEHOLDER"),
  });
  await expect(page.getByText(fileName)).toBeVisible();

  // Upload triggers POST /api/disputes/:jobId/evidence (mocked → IPFS CID fixture)
  await page.getByRole("button", { name: /file\(s\) to IPFS/i }).click({ force: true });

  // Wait for evidence to appear in sessionStorage (XHR interceptor updates it
  // synchronously when the POST fires; the 50ms setTimeout then fires the XHR events).
  await page.waitForFunction(
    ({ key }: { key: string }) => {
      const s = JSON.parse(sessionStorage.getItem(key) || "{}") as any;
      return Array.isArray(s.evidence) && s.evidence.length > 0;
    },
    { key: DISPUTE_STATE_KEY },
    { timeout: 10_000 },
  );

  const evidenceAfterUpload = await page.evaluate(
    (key) => (JSON.parse(sessionStorage.getItem(key) || "{}") as any).evidence ?? [],
    DISPUTE_STATE_KEY,
  );
  expect((evidenceAfterUpload as any[]).length).toBeGreaterThan(0);
  expect((evidenceAfterUpload as any[])[0].ipfsCid).toBe("QmTestCidFixed123");
}

// ─── Shared admin-resolution phase ────────────────────────────────────────────

async function resolveAsAdmin(
  page: Page,
  jobTitle: string,
  releaseTo: "client" | "freelancer",
  note: string,
) {
  // The hydration-error overlay is prevented by pinning locale: "en-US" in
  // playwright.config.ts, so we can interact directly with the admin page.
  await expect(page.getByText("Admin Dashboard")).toBeVisible({ timeout: 20_000 });

  // Wait until the disputes tab button is present (appears only when
  // adminState === "authorized" AND twoFaState === "ready").
  await expect(page.locator("#admin-tab-disputes")).toBeAttached({ timeout: 20_000 });
  await page.click("#admin-tab-disputes", { force: true });
  await expect(
    page.getByRole("article", { name: `Dispute: ${jobTitle}` }),
  ).toBeVisible({ timeout: 10_000 });

  await page.click(`#resolve-dispute-${JOB_ID}`);

  await page.click(`#release-to-${releaseTo}`);
  await page.fill("#resolve-note", note);
  await page.click("#confirm-resolve");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("dispute resolution flow (#518)", () => {
  test.slow();

  // Each test creates completely isolated state and a fresh page context,
  // so both run concurrently without any shared mutable state.

  test("resolves dispute in favour of client", async ({ page }) => {
    const state = createDisputeState();
    const clientJwt = makeJwt("user", CLIENT_ADDRESS);
    const adminJwt = makeJwt("admin", ADMIN_ADDRESS);

    await installDisputeMocks(page, state, clientJwt, adminJwt);

    // ── Phase 1: Client uploads evidence ────────────────────────────────
    await mockFreighter(page, CLIENT_ADDRESS);
    await page.goto(`/disputes/${JOB_ID}`);
    await uploadEvidenceAsClient(page, "delivery-proof.png");

    // ── Phase 2: Admin mediates — resolves in favour of client ──────────
    await switchToAdmin(page);
    await page.goto("/admin");
    await resolveAsAdmin(
      page,
      state.job.title,
      "client",
      "Client provided conclusive evidence of non-delivery.",
    );

    // ── UI assertions ────────────────────────────────────────────────────
    await expect(
      page.getByText(/Dispute resolved — funds released to client/i),
    ).toBeVisible();

    // After loadData() re-fetches, the resolved dispute is gone from the list.
    await expect(
      page.getByText("No open disputes. All clear!"),
    ).toBeVisible({ timeout: 8_000 });

    // ── Database (sessionStorage) state assertions ────────────────────────
    const finalState: DisputeState = await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key) || "{}"),
      DISPUTE_STATE_KEY,
    );

    expect(finalState.job.status).toBe("resolved");
    expect(finalState.resolution).toBe("client");

    // Client balance increases by the full budget amount.
    expect(finalState.balances[CLIENT_ADDRESS]).toBe(
      INITIAL_CLIENT_BALANCE + JOB_BUDGET,
    );
    // Freelancer balance is unchanged.
    expect(finalState.balances[FREELANCER_ADDRESS]).toBe(
      INITIAL_FREELANCER_BALANCE,
    );

    // Exactly one evidence item was recorded on-chain.
    expect(finalState.evidence).toHaveLength(1);
    expect(finalState.evidence[0].ipfsCid).toBe("QmTestCidFixed123");
  });

  test("resolves dispute in favour of freelancer", async ({ page }) => {
    const state = createDisputeState();
    const clientJwt = makeJwt("user", CLIENT_ADDRESS);
    const adminJwt = makeJwt("admin", ADMIN_ADDRESS);

    await installDisputeMocks(page, state, clientJwt, adminJwt);

    // ── Phase 1: Client uploads evidence ────────────────────────────────
    await mockFreighter(page, CLIENT_ADDRESS);
    await page.goto(`/disputes/${JOB_ID}`);
    await uploadEvidenceAsClient(page, "contract-screenshot.png");

    // ── Phase 2: Admin mediates — resolves in favour of freelancer ───────
    await switchToAdmin(page);
    await page.goto("/admin");
    await resolveAsAdmin(
      page,
      state.job.title,
      "freelancer",
      "Freelancer completed all deliverables per scope agreement.",
    );

    // ── UI assertions ────────────────────────────────────────────────────
    await expect(
      page.getByText(/Dispute resolved — funds released to freelancer/i),
    ).toBeVisible();

    await expect(
      page.getByText("No open disputes. All clear!"),
    ).toBeVisible({ timeout: 8_000 });

    // ── Database (sessionStorage) state assertions ────────────────────────
    const finalState: DisputeState = await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key) || "{}"),
      DISPUTE_STATE_KEY,
    );

    expect(finalState.job.status).toBe("resolved");
    expect(finalState.resolution).toBe("freelancer");

    // Freelancer balance increases by the full budget amount.
    expect(finalState.balances[FREELANCER_ADDRESS]).toBe(
      INITIAL_FREELANCER_BALANCE + JOB_BUDGET,
    );
    // Client balance is unchanged.
    expect(finalState.balances[CLIENT_ADDRESS]).toBe(INITIAL_CLIENT_BALANCE);

    // Exactly one evidence item was recorded on-chain.
    expect(finalState.evidence).toHaveLength(1);
    expect(finalState.evidence[0].ipfsCid).toBe("QmTestCidFixed123");
  });
});
