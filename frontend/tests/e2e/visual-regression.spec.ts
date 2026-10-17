import { expect, test, type Page } from "@playwright/test";
import { SorobanDataBuilder, xdr } from "@stellar/stellar-sdk";

const MOCK_JOB = {
  id: "job-1",
  title: "Build a Soroban escrow contract for marketplace payouts",
  description:
    "Need a secure escrow contract and integration tests for release and refund paths.",
  budget: "500",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban", "Testing"],
  status: "open",
  clientAddress: "GCLIENTADDRESS1234567890EXAMPLEABCDEF",
  applicantCount: 3,
  createdAt: "2026-01-12T10:00:00.000Z",
  updatedAt: "2026-01-12T10:00:00.000Z",
};

async function applyTheme(page: Page, theme: "dark" | "light") {
  // Runs before page load so _document.tsx anti-FOUC script reads the correct value
  await page.addInitScript(
    ({ t, key }) => localStorage.setItem(key, t),
    { t: theme, key: "smp_theme" }
  );
}

async function stubFreighter(page: Page) {
  // Prevent errors from missing Freighter extension; keeps app in disconnected state
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).freighter = {
      isConnected: async () => ({ isConnected: false }),
      isAllowed: async () => ({ isAllowed: false }),
      getPublicKey: async () => ({ error: "Not connected" }),
    };
  });
}

async function mockApis(page: Page) {
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  // More-specific routes must be registered before the catch-all
  await page.route("**/api/jobs/recommended**", (r) => r.fulfill(json([])));
  await page.route("**/api/jobs/job-1**", (r) => r.fulfill(json(MOCK_JOB)));
  await page.route("**/api/jobs**", (r) => r.fulfill(json([MOCK_JOB])));
  await page.route("**/api/auth**", (r) =>
    r.fulfill(json({ transaction: "mock-tx", success: true, token: "mock-token" }))
  );
  await page.route("**/api/profiles/**", (r) =>
    r.fulfill(json({ publicKey: "GCLIENTADDRESS1234567890EXAMPLEABCDEF", role: "both" }))
  );
  await page.route("**/api/applications/**", (r) => r.fulfill(json([])));
  await page.route("**/api/**", (r) => r.fulfill(json([])));
  await page.route("https://api.coingecko.com/**", (r) =>
    r.fulfill({ status: 200, body: JSON.stringify({ stellar: { usd: 0.12 } }) })
  );
  await page.route("https://horizon-testnet.stellar.org/**", (r) =>
    r.fulfill(json({ balances: [] }))
  );
}

async function stabilize(page: Page, { waitForIdle = true } = {}) {
  // Pages that poll (balances, notifications) never reach network idle; callers
  // pass waitForIdle: false and wait on a concrete element instead.
  if (waitForIdle) await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // Freeze all CSS animations and transitions so screenshots are pixel-stable
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition: none !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      /* Next.js dev-mode overlay/indicator is not part of the product UI. */
      nextjs-portal { display: none !important; }
    `,
  });
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`visual regression — ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await applyTheme(page, theme);
      await stubFreighter(page);
      await mockApis(page);
    });

    test("landing page", async ({ page }) => {
      await page.goto("/");
      await stabilize(page);
      await expect(page).toHaveScreenshot(`landing-${theme}.png`);
    });

    test("job listing", async ({ page }) => {
      await page.goto("/jobs");
      await stabilize(page);
      await expect(page).toHaveScreenshot(`job-listing-${theme}.png`);
    });

    test("job detail", async ({ page }) => {
      await page.goto("/jobs/job-1");
      await stabilize(page);
      await expect(page).toHaveScreenshot(`job-detail-${theme}.png`);
    });

    test("dashboard — unauthenticated", async ({ page }) => {
      // Screenshots the wallet-connect prompt; authenticated state has too much
      // dynamic content (live balances, job lists) to baseline reliably
      await page.goto("/dashboard");
      await stabilize(page);
      await expect(page).toHaveScreenshot(`dashboard-${theme}.png`);
    });
  });
}

// ── Money-critical surfaces (#1897) ───────────────────────────────────────────
// A low-contrast regression on these screens can cause real mistakes (wrong
// amount funded, fee misread, withdrawal to the wrong place), so each one is
// snapshotted in both themes. They render through pages/dev/visual-harness.tsx
// in a fixed, wallet-free state; every network dependency is stubbed here.

const FIXED_NOW = new Date("2026-01-15T12:00:00.000Z");

const HORIZON_TRANSACTIONS = {
  _embedded: {
    records: [
      {
        id: "tx-1",
        transaction_hash:
          "1f3a5c7e9b0d2f4a6c8e0b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f01",
        ledger: 51234567,
        created_at: "2026-01-15T10:30:00Z",
        successful: true,
      },
      {
        id: "tx-2",
        transaction_hash:
          "2a4c6e8b0d1f3a5c7e9b1d3f5a7c9e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a12",
        ledger: 51234001,
        created_at: "2026-01-14T09:15:00Z",
        successful: true,
      },
      {
        id: "tx-3",
        transaction_hash:
          "3b5d7f9a1c2e4b6d8f0a2c4e6b8d0f1a3c5e7b9d1f3a5c7e9b0d2f4a6c8e0b23",
        ledger: 51233000,
        created_at: "2026-01-12T16:45:00Z",
        successful: false,
      },
    ],
  },
  _links: {},
};

async function mockMoneyCriticalApis(page: Page) {
  // Registered first so the specific Soroban / Horizon stubs below win.
  await page.route(
    (url) => url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
    (route) => route.fulfill({ status: 404, body: "{}" }),
  );

  // Soroban RPC: simulateTransaction for the fee estimate.
  await page.route("https://soroban-testnet.stellar.org/**", async (route) => {
    const request = route.request().postDataJSON() as { id?: number } | null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: request?.id ?? 1,
        result: {
          latestLedger: 51234567,
          minResourceFee: "90000",
          transactionData: new SorobanDataBuilder().build().toXDR("base64"),
          results: [{ auth: [], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
          cost: { cpuInsns: "1000", memBytes: "1000" },
        },
      }),
    });
  });

  // Horizon: balance + transaction history.
  await page.route("https://horizon-testnet.stellar.org/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const body = pathname.endsWith("/transactions")
      ? HORIZON_TRANSACTIONS
      : {
          id: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          balances: [{ asset_type: "native", balance: "1250.5000000" }],
        };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route("https://api.coingecko.com/**", (r) =>
    r.fulfill({ status: 200, body: JSON.stringify({ stellar: { usd: 0.12 } }) }),
  );
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`visual regression — money-critical surfaces, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(FIXED_NOW);
      await applyTheme(page, theme);
      await stubFreighter(page);
      await mockApis(page);
      await mockMoneyCriticalApis(page);
    });

    test("post-job escrow funding step", async ({ page }) => {
      await page.goto("/dev/visual-harness?surface=escrow-funding");
      await page.getByLabel("Budget").waitFor();
      await stabilize(page, { waitForIdle: false });
      await expect(page).toHaveScreenshot(`escrow-funding-${theme}.png`);
    });

    test("fee estimation modal", async ({ page }) => {
      await page.goto("/dev/visual-harness?surface=fee-estimation");
      // The modal debounces the estimate by 500ms before simulating.
      await page.getByText("Estimated fee").waitFor();
      await stabilize(page, { waitForIdle: false });
      await expect(page).toHaveScreenshot(`fee-estimation-${theme}.png`);
    });

    test("withdraw to bank modal", async ({ page }) => {
      await page.goto("/dev/visual-harness?surface=withdraw-to-bank");
      await page.getByRole("dialog").waitFor();
      await stabilize(page, { waitForIdle: false });
      await expect(page).toHaveScreenshot(`withdraw-to-bank-${theme}.png`);
    });

    test("transactions dashboard", async ({ page }) => {
      await page.goto("/dev/visual-harness?surface=transactions");
      await page.getByText(/Ledger #51234567/).waitFor();
      await stabilize(page, { waitForIdle: false });
      await expect(page).toHaveScreenshot(`transactions-${theme}.png`);
    });
  });
}
