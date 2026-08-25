import { expect, test, type Page } from "@playwright/test";

const walletAddress = "GCFXWALLETTESTADDRESS1234567890EXAMPLEABCDEF";

const job = {
  id: "job-1",
  title: "Build a Soroban escrow contract for marketplace payouts",
  description:
    "Need a secure escrow contract and integration tests for release and refund paths.",
  budget: "500",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban", "Testing"],
  status: "open",
  clientAddress: "GCLIENTADDRESS1234567890EXAMPLEABCDEF",
  applicantCount: 1,
  createdAt: "2026-01-12T10:00:00.000Z",
  updatedAt: "2026-01-12T10:00:00.000Z",
};

async function mockFreighter(page: Page, connected = true) {
  await page.addInitScript(
    ({ isConnected, publicKey }) => {
      (window as Window & { freighter?: Record<string, unknown> }).freighter = {
        isConnected: async () => ({ isConnected }),
        isAllowed: async () => ({ isAllowed: isConnected }),
        requestAccess: async () => ({ error: null }),
        getPublicKey: async () => ({ publicKey }),
        signTransaction: async () => ({ signedTransaction: "signed-xdr" }),
      };
    },
    { isConnected: connected, publicKey: walletAddress },
  );
}

async function mockApi(page: Page, jobs: unknown[] = [job]) {
  await page.route(
    "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ stellar: { usd: 0.12 } }),
      });
    },
  );

  await page.route("**/api/auth?account=**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ transaction: "challenge-xdr" }),
    });
  });

  await page.route("**/api/auth", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, token: "jwt-token" }),
    });
  });

  await page.route("**/api/jobs?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: jobs }),
    });
  });

  await page.route("**/api/jobs/job-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: job }),
    });
  });

  await page.route("**/api/applications/job/job-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] }),
    });
  });

  await page.route("**/api/applications", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { id: "app-1" } }),
    });
  });
}

test.describe("Visual regression — light theme", () => {
  test.use({ colorScheme: "light" });

  test("home page renders correctly", async ({ page }) => {
    await mockFreighter(page, false);
    await mockApi(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("home-light.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("jobs page renders correctly", async ({ page }) => {
    await mockFreighter(page, false);
    await mockApi(page, [job]);
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("jobs-light.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("post-job page renders correctly", async ({ page }) => {
    await mockFreighter(page, true);
    await mockApi(page);
    await page.goto("/post-job");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("post-job-light.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("dashboard page renders correctly", async ({ page }) => {
    await mockFreighter(page, false);
    await mockApi(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("dashboard-light.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe("Visual regression — dark theme", () => {
  test.use({ colorScheme: "dark" });

  test("home page renders correctly", async ({ page }) => {
    await mockFreighter(page, false);
    await mockApi(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("home-dark.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("jobs page renders correctly", async ({ page }) => {
    await mockFreighter(page, false);
    await mockApi(page, [job]);
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("jobs-dark.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("dashboard page renders correctly", async ({ page }) => {
    await mockFreighter(page, false);
    await mockApi(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("dashboard-dark.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
});