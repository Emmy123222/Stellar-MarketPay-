import { expect, test, type Page } from "@playwright/test";
import {
  CLIENT_ADDRESS,
  FREELANCER_ADDRESS,
  createInitialState,
  type MarketplaceState,
} from "./helpers/marketplaceState";

const PROPOSAL_TEXT =
  "I am an experienced Stellar and Soroban engineer with many completed marketplace integrations, escrow flows, and Playwright test suites delivered for production teams.";

async function mockFreighter(page: Page, publicKey: string) {
  await page.addInitScript((key) => {
    (window as Window & { freighter?: Record<string, unknown> }).freighter = {
      isConnected: async () => ({ isConnected: true }),
      isAllowed: async () => ({ isAllowed: true }),
      requestAccess: async () => ({ error: null }),
      getPublicKey: async () => ({ publicKey: key }),
      signTransaction: async () => ({ signedTransaction: "signed-xdr-mock" }),
    };
  }, publicKey);
}

async function installMarketplaceApiMocks(page: Page, state: MarketplaceState) {
  await page.route("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stellar: { usd: 0.12 } }),
    });
  });

  await page.route("**/api/auth?account=**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ transaction: "challenge-xdr" }),
    });
  });

  await page.route("**/api/auth", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, token: "jwt-token" }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route("**/api/jobs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === "GET" && url.pathname.endsWith("/api/jobs")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: state.jobs }),
      });
      return;
    }

    if (method === "POST" && url.pathname.endsWith("/api/jobs")) {
      const body = request.postDataJSON() as {
        title: string;
        description: string;
        budgetXlm: number;
        skills: string[];
        clientAddress: string;
      };
      const job = {
        id: `job-${state.jobs.length + 1}`,
        title: body.title,
        description: body.description,
        budget: `${body.budgetXlm}.0000000`,
        currency: "XLM" as const,
        category: "Smart Contracts",
        skills: body.skills ?? [],
        status: "open" as const,
        clientAddress: body.clientAddress,
        applicantCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.jobs.push(job);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, job, data: job }),
      });
      return;
    }

    const jobMatch = url.pathname.match(/\/api\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);
      const job = state.jobs.find((item) => item.id === jobId);

      if (method === "GET") {
        await route.fulfill({
          status: job ? 200 : 404,
          contentType: "application/json",
          body: JSON.stringify(job ? { success: true, data: job } : { success: false }),
        });
        return;
      }

      if (method === "PATCH" && job) {
        const patch = request.postDataJSON() as { contractTxHash?: string };
        job.escrowContractId = patch.contractTxHash ?? "mock-contract-id";
        state.balances[CLIENT_ADDRESS] -= Number.parseFloat(job.budget);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, data: job }),
        });
        return;
      }

      if (method === "DELETE") {
        state.jobs = state.jobs.filter((item) => item.id !== jobId);
        await route.fulfill({ status: 204, body: "" });
        return;
      }
    }

    await route.continue();
  });

  await page.route("**/api/applications**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    const jobRoute = url.pathname.match(/\/api\/applications\/job\/([^/]+)$/);
    if (method === "GET" && jobRoute) {
      const jobId = decodeURIComponent(jobRoute[1]);
      const apps = state.applications.filter((app) => app.jobId === jobId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: apps }),
      });
      return;
    }

    if (method === "POST" && url.pathname.endsWith("/api/applications")) {
      const body = request.postDataJSON() as {
        jobId: string;
        freelancerAddress: string;
        proposal: string;
        bidAmount: string;
      };
      const application = {
        id: `app-${state.applications.length + 1}`,
        jobId: body.jobId,
        freelancerAddress: body.freelancerAddress,
        proposal: body.proposal,
        bidAmount: body.bidAmount,
        currency: "XLM" as const,
        status: "pending" as const,
        createdAt: new Date().toISOString(),
      };
      state.applications.push(application);
      const job = state.jobs.find((item) => item.id === body.jobId);
      if (job) job.applicantCount += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: application }),
      });
      return;
    }

    const acceptRoute = url.pathname.match(/\/api\/applications\/([^/]+)\/accept$/);
    if (method === "POST" && acceptRoute) {
      const applicationId = decodeURIComponent(acceptRoute[1]);
      const application = state.applications.find((app) => app.id === applicationId);
      if (!application) {
        await route.fulfill({ status: 404, body: JSON.stringify({ success: false }) });
        return;
      }
      application.status = "accepted";
      state.applications
        .filter((app) => app.jobId === application.jobId && app.id !== applicationId)
        .forEach((app) => {
          app.status = "rejected";
        });
      const job = state.jobs.find((item) => item.id === application.jobId);
      if (job) {
        job.status = "in_progress";
        job.freelancerAddress = application.freelancerAddress;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: application }),
      });
      return;
    }

    await route.continue();
  });

  await page.route("**/api/time-entries**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    const jobEntries = url.pathname.match(/\/api\/time-entries\/job\/([^/]+)$/);
    if (method === "GET" && jobEntries) {
      const jobId = decodeURIComponent(jobEntries[1]);
      const entries = state.timeEntries.filter((entry) => entry.jobId === jobId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: entries }),
      });
      return;
    }

    if (method === "POST" && url.pathname.endsWith("/api/time-entries")) {
      const body = request.postDataJSON() as {
        jobId: string;
        durationMinutes: number;
        description?: string;
      };
      const entry = {
        id: `time-${state.timeEntries.length + 1}`,
        jobId: body.jobId,
        durationMinutes: body.durationMinutes,
        description: body.description,
        createdAt: new Date().toISOString(),
      };
      state.timeEntries.push(entry);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: entry }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] }),
    });
  });

  await page.route("**/api/escrow/**", async (route) => {
    if (route.request().method() === "POST") {
      const jobId = route.request().url().split("/").pop();
      const job = state.jobs.find((item) => item.id === jobId);
      if (job) job.status = "completed";
      const payment = job ? Number.parseFloat(job.budget) : 0;
      state.balances[FREELANCER_ADDRESS] += payment;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/ratings", async (route) => {
    const body = route.request().postDataJSON() as {
      jobId: string;
      ratedAddress: string;
      stars: number;
    };
    state.ratings.push({
      jobId: body.jobId,
      ratedAddress: body.ratedAddress,
      stars: body.stars,
      raterAddress: route.request().headers()["x-wallet"] ?? "unknown",
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { id: `rating-${state.ratings.length}` } }),
    });
  });

  await page.route("**/api/proposal-templates**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
}

test("full marketplace flow with two wallets and contract mock", async ({ page }) => {
  const state = createInitialState();
  await installMarketplaceApiMocks(page, state);

  await mockFreighter(page, CLIENT_ADDRESS);
  await page.goto("/post-job");

  await page.getByLabel("Job Title").fill("Build marketplace escrow integration tests");
  await page.getByLabel("Description").fill(
    "Need an end to end Playwright flow covering posting, escrow funding, applications, progress updates, release, and ratings.",
  );
  await page.getByLabel("Budget (XLM)").fill("250");
  await page.getByRole("button", { name: /Post Job & Lock 250 XLM Escrow/i }).click();
  await expect(page.getByText("Job Posted!")).toBeVisible({ timeout: 20_000 });

  const jobId = state.jobs[0]?.id;
  expect(jobId).toBeTruthy();
  expect(state.balances[CLIENT_ADDRESS]).toBe(9_750);

  await mockFreighter(page, FREELANCER_ADDRESS);
  await page.goto(`/jobs/${jobId}`);
  await page.getByRole("button", { name: "Apply for this Job" }).click();
  await page.getByLabel("Cover Letter").fill(PROPOSAL_TEXT);
  await page.getByRole("button", { name: "Submit Proposal" }).click();
  await page.getByRole("button", { name: "Confirm & Submit" }).click();
  await expect(page.getByText("Application submitted")).toBeVisible();

  await mockFreighter(page, CLIENT_ADDRESS);
  await page.goto(`/jobs/${jobId}`);
  await page.getByRole("button", { name: "Accept Proposal" }).click();
  await expect(page.getByText("In Progress")).toBeVisible();

  await mockFreighter(page, FREELANCER_ADDRESS);
  await page.goto(`/jobs/${jobId}`);
  await page.getByRole("button", { name: "+ Add manual entry" }).click();
  await page.getByPlaceholder("e.g. 90").fill("120");
  await page.getByPlaceholder("What did you work on?").fill("Implemented escrow release flow and ratings UI.");
  await page.getByRole("button", { name: "Save Entry" }).click();
  await expect(page.getByText("Total tracked")).toBeVisible();
  expect(state.timeEntries.length).toBe(1);

  await mockFreighter(page, CLIENT_ADDRESS);
  await page.goto(`/jobs/${jobId}`);
  await page.getByRole("button", { name: "Release Escrow" }).click();
  await expect(page.getByText("Escrow released successfully")).toBeVisible({ timeout: 20_000 });
  expect(state.balances[FREELANCER_ADDRESS]).toBe(5_250);

  await page.getByRole("button", { name: "5 stars" }).click();
  await page.getByRole("button", { name: "Submit Rating" }).click();
  await expect(page.getByText("Rating submitted")).toBeVisible();

  await mockFreighter(page, FREELANCER_ADDRESS);
  await page.goto(`/jobs/${jobId}`);
  await page.getByRole("button", { name: "5 stars" }).click();
  await page.getByRole("button", { name: "Submit Rating" }).click();
  await expect(page.getByText("Rating submitted")).toBeVisible();

  expect(state.ratings.length).toBeGreaterThanOrEqual(2);
});
