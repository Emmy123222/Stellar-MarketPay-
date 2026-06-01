import { expect, test, type Page } from "@playwright/test";

const walletAddress = "GCFXWALLETTESTADDRESS1234567890EXAMPLEABCDEF";

const job = {
  id: "job-1",
  title: "Build a Soroban escrow contract for marketplace payouts",
  description: "Need a secure escrow contract and integration tests for release and refund paths.",
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
  await page.addInitScript(({ isConnected, publicKey }) => {
    (window as Window & { freighter?: Record<string, unknown> }).freighter = {
      isConnected: async () => ({ isConnected }),
      isAllowed: async () => ({ isAllowed: isConnected }),
      requestAccess: async () => ({ error: null }),
      getPublicKey: async () => ({ publicKey }),
      signTransaction: async () => ({ signedTransaction: "signed-xdr" }),
    };
  }, { isConnected: connected, publicKey: walletAddress });
}

async function mockApi(page: Page, jobs: unknown[] = [job]) {
  await page.route("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stellar: { usd: 0.12 } }) });
  });

  await page.route("**/api/auth?account=**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ transaction: "challenge-xdr" }) });
  });

  await page.route("**/api/auth", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, token: "jwt-token" }) });
  });

  await page.route("**/api/jobs/job-1", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: job }) });
  });

  await page.route("**/api/jobs?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: jobs }) });
  });

  await page.route("**/api/applications/job/job-1", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.route("**/api/applications", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "app-1" } }) });
  });
}

test("home page loads and shows hero content and stats", async ({ page }) => {
  await mockFreighter(page, false);
  await mockApi(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Freelance without/i })).toBeVisible();
  await expect(page.getByText("0%", { exact: true })).toBeVisible();
  await expect(page.getByText("Payment speed")).toBeVisible();
});

test("jobs page loads with job cards", async ({ page }) => {
  await mockFreighter(page, false);
  await mockApi(page, [job]);
  await page.goto("/jobs");

  await expect(page.getByRole("heading", { name: "Browse Jobs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: job.title })).toBeVisible();
});

test("jobs page shows empty state when no jobs", async ({ page }) => {
  await mockFreighter(page, false);
  await mockApi(page, []);
  await page.goto("/jobs");

  await expect(page.getByText("No jobs found")).toBeVisible();
  await expect(page.getByRole("link", { name: /Post the first job/i })).toBeVisible();
});

test("clicking a job card navigates to the job detail page", async ({ page }) => {
  await mockFreighter(page, false);
  await mockApi(page, [job]);
  await page.goto("/jobs");

  await page.getByRole("heading", { name: job.title }).click();
  await expect(page).toHaveURL(/\/jobs\/job-1$/);
  await expect(page.getByRole("heading", { name: job.title })).toBeVisible();
  await expect(page.getByText("Apply for this Job")).toBeVisible();
});

test("PostJobForm shows validation errors when required fields are too short", async ({ page }) => {
  await mockFreighter(page, true);
  await mockApi(page);
  await page.goto("/post-job");

  await expect(page.getByRole("heading", { name: "Post a Job" })).toBeVisible();
  await page.getByPlaceholder("e.g. Build a Soroban escrow contract for NFT marketplace").fill("short");
  await page.getByPlaceholder("Describe the work in detail — requirements, deliverables, acceptance criteria...").fill("too short");

  await expect(page.getByText("Title must be at least 10 characters")).toBeVisible();
  await expect(page.getByText("Description must be at least 30 characters")).toBeVisible();
});

test("PostJobForm submit button is disabled when form is invalid", async ({ page }) => {
  await mockFreighter(page, true);
  await mockApi(page);
  await page.goto("/post-job");

  const submit = page.getByRole("button", { name: /Post Job & Lock Budget in Escrow/i });
  await expect(submit).toBeDisabled();
});

test("dashboard shows WalletConnect when no wallet is connected", async ({ page }) => {
  await mockFreighter(page, false);
  await mockApi(page);
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect Freighter Wallet/i })).toBeVisible();
});

test("application form submit is disabled when proposal is invalid", async ({ page }) => {
  await mockFreighter(page, true);
  await mockApi(page, [job]);
  await page.goto("/jobs/job-1");

  await page.getByRole("button", { name: "Apply for this Job" }).click();
  const submit = page.getByRole("button", { name: "Submit Proposal" });
  await expect(submit).toBeDisabled();
});
