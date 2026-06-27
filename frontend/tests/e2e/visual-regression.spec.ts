import { expect, test, type Page } from "@playwright/test";

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

async function stabilize(page: Page) {
  await page.waitForLoadState("networkidle");
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
