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
    (window as any).freighter = {
      isConnected: async () => ({ isConnected }),
      isAllowed: async () => ({ isAllowed: isConnected }),
      requestAccess: async () => ({ error: null }),
      getPublicKey: async () => ({ publicKey }),
      signTransaction: async () => ({ signedTransaction: "signed-xdr" }),
    };
  }, { isConnected: connected, publicKey: walletAddress });
}

async function installApiMocks(page: Page, jobs: any[] = [job]) {
  await page.addInitScript(({ mockJobs, mockJob, publicKey }) => {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      (this as any).__url = typeof url === 'string' ? url : (url as any).href;
      (this as any).__method = method;
      return origOpen.apply(this, arguments as any);
    };

    XMLHttpRequest.prototype.send = function(body) {
      const url = (this as any).__url || '';
      const method = (this as any).__method || 'GET';

      if (method === 'GET' && url.includes('/api/')) {
        let data: any = null;
        if (url.includes('/api/jobs/recommended')) data = []; // No recommendations for core tests
        else if (url.includes('/api/jobs/job-1')) data = mockJob;
        else if (url.includes('/api/jobs')) data = mockJobs;
        else if (url.includes('/api/applications/job/job-1')) data = [];
        else if (url.includes('/client-reputation')) data = { score: 4.5, paymentReleaseRate: 95, disputeRate: 2, completionRate: 90, avgTimeToReleaseHours: 24, responseTimeToApplicationsHours: 12 };
        else if (url.includes('/api/profiles/')) data = { publicKey, role: 'both' };
        else if (url.includes('/api/auth')) data = { transaction: 'challenge-xdr', success: true };
        else data = [];

        const xhr = this;
        setTimeout(() => {
          Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
          Object.defineProperty(xhr, 'responseText', { value: JSON.stringify({ success: true, data }), configurable: true });
          xhr.dispatchEvent(new Event('readystatechange'));
          xhr.dispatchEvent(new Event('load'));
          xhr.dispatchEvent(new Event('loadend'));
        }, 10);
        return;
      }

      if (method === 'POST' && url.includes('/api/auth')) {
        const xhr = this;
        setTimeout(() => {
          Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
          Object.defineProperty(xhr, 'responseText', { value: JSON.stringify({ success: true, token: 'jwt-token' }), configurable: true });
          xhr.dispatchEvent(new Event('readystatechange'));
          xhr.dispatchEvent(new Event('load'));
          xhr.dispatchEvent(new Event('loadend'));
        }, 10);
        return;
      }

      return origSend.apply(this, arguments as any);
    };
  }, { mockJobs: jobs, mockJob: job, publicKey: walletAddress });

  await page.route("https://api.coingecko.com/**", async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ stellar: { usd: 0.12 } }) });
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

  await page.route("**/api/**", async (route) => {
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
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true, data: [] }) });
    }
  });
  });
}

test("home page loads and shows hero content and stats", async ({ page }) => {
  await mockFreighter(page, false);
  await installApiMocks(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Freelance without/i })).toBeVisible();
});

test("jobs page loads with job cards", async ({ page }) => {
  await mockFreighter(page, false);
  await installApiMocks(page, [job]);
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Browse Jobs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: job.title }).first()).toBeVisible();
});

test("clicking a job card navigates to the job detail page", async ({ page }) => {
  await mockFreighter(page, true);
  await installApiMocks(page, [job]);
  await page.goto("/jobs");

  await page.getByRole("heading", { name: job.title }).first().click();
  await expect(page).toHaveURL(/\/jobs\/job-1$/);
  await expect(page.getByRole("heading", { name: job.title })).toBeVisible();
  await expect(page.getByText("Apply for this Job")).toBeVisible();
});

test("application form submit is disabled when proposal is invalid", async ({ page }) => {
  await mockFreighter(page, true);
  await installApiMocks(page, [job]);
  await page.goto("/jobs/job-1");
  await page.getByRole("button", { name: "Apply for this Job" }).click();
  const submit = page.getByRole("button", { name: "Submit Proposal" });
  await expect(submit).toBeDisabled();
});
