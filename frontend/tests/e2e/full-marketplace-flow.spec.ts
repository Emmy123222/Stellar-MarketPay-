import { expect, test, type Page } from "@playwright/test";
import {
  CLIENT_ADDRESS,
  FREELANCER_ADDRESS,
  createInitialState,
  type MarketplaceState,
} from "./helpers/marketplaceState";

const PROPOSAL_TEXT = "I am an experienced Stellar and Soroban engineer with many completed marketplace integrations, escrow flows, and Playwright test suites delivered for production teams. I have deep expertise in building decentralized applications on the Stellar network and writing comprehensive end-to-end tests that ensure high reliability and security for smart contract systems. My background includes building full-stack dApps using Next.js, TypeScript, and Rust for Soroban contracts. I am very interested in this project and confident that I can deliver high-quality results within the specified timeline and budget. I look forward to discussing the technical details with your team and starting our collaboration soon to bring this marketplace vision to life with robust escrow logic.";

async function mockFreighter(page: Page, publicKey: string) {
  await page.addInitScript((key) => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: true }),
      isAllowed: async () => ({ isAllowed: true }),
      requestAccess: async () => ({ error: null }),
      getPublicKey: async () => ({ publicKey: key }),
      signTransaction: async () => ({ signedTransaction: "signed-xdr-mock" }),
    };
  }, publicKey);
}

async function installPersistentApiMocks(page: Page, initialState: MarketplaceState) {
  await page.addInitScript(({ state, clientAddr, freelancerAddr }) => {
    const STORAGE_KEY = "__MARKETPLACE_MOCK_STATE__";
    const getStoredState = () => {
      try {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : state;
      } catch {
        return state;
      }
    };
    const persistState = (s: any) => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    };

    const mockState = getStoredState();
    (window as any).__MOCK_STATE__ = mockState;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      (this as any).__url = typeof url === "string" ? url : (url as any).href;
      (this as any).__method = method;
      return origOpen.apply(this, arguments as any);
    };

    XMLHttpRequest.prototype.send = function(body) {
      const url = (this as any).__url || "";
      const method = (this as any).__method || "GET";
      const xhr = this;

      if (url.includes("/api/")) {
        const pathname = new URL(url, window.location.origin).pathname;
        let responseData: any = { success: true, data: [] };
        let status = 200;

        if (pathname.includes("/api/auth")) {
          if (method === "POST") responseData = { success: true, token: "jwt-token" };
          else responseData = { success: true, transaction: "challenge-xdr" };
        } 
        else if (pathname === "/api/jobs" || pathname === "/api/jobs/") {
          if (method === "GET") {
            responseData = { success: true, data: mockState.jobs };
          } else if (method === "POST") {
            const b = JSON.parse(body as string);
            const job = {
              id: `job-${mockState.jobs.length + 1}`,
              title: b.title,
              description: b.description,
              budget: b.budget,
              currency: b.currency || "XLM",
              category: b.category,
              skills: b.skills || [],
              status: "open",
              clientAddress: b.clientAddress,
              applicantCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            mockState.jobs.push(job);
            persistState(mockState);
            responseData = { success: true, data: job };
            status = 201;
          }
        }
        else if (pathname.match(/\/api\/jobs\/job-\d+$/)) {
          const jobId = pathname.split("/").pop();
          const job = mockState.jobs.find((j: any) => j.id === jobId);
          if (job) responseData = { success: true, data: job };
          else { responseData = { success: false }; status = 404; }
        }
        else if (pathname.includes("/escrow") || (pathname.includes("/api/jobs/job-") && method === "PATCH")) {
          const parts = pathname.split("/");
          const jobId = parts.find(p => p.startsWith("job-"));
          const job = mockState.jobs.find((j: any) => j.id === jobId);
          if (job) {
            if (pathname.includes("/release")) {
              job.status = "completed";
              mockState.balances[freelancerAddr] += parseFloat(job.budget);
            } else if (method === "PATCH") {
              const b = JSON.parse(body as string);
              if (b.escrowContractId) job.escrowContractId = b.escrowContractId;
              if (pathname.includes("/escrow")) mockState.balances[clientAddr] -= parseFloat(job.budget);
            }
            persistState(mockState);
            responseData = { success: true, data: job };
          }
        }
        else if (pathname.includes("/api/applications/job/")) {
          const jobId = pathname.split("/").pop();
          responseData = { success: true, data: mockState.applications.filter((a: any) => a.jobId === jobId) };
        }
        else if (pathname === "/api/applications" && method === "POST") {
          const b = JSON.parse(body as string);
          const app = {
            id: `app-${mockState.applications.length + 1}`,
            jobId: b.jobId,
            freelancerAddress: b.freelancerAddress,
            proposal: b.proposal,
            bidAmount: b.bidAmount,
            currency: b.currency || "XLM",
            status: "pending",
            createdAt: new Date().toISOString(),
          };
          mockState.applications.push(app);
          const job = mockState.jobs.find((j: any) => j.id === b.jobId);
          if (job) job.applicantCount++;
          persistState(mockState);
          responseData = { success: true, data: app };
          status = 201;
        }
        else if (pathname.match(/\/api\/applications\/app-\d+\/accept/)) {
          const parts = pathname.split("/");
          const appId = parts[parts.indexOf("applications") + 1];
          const app = mockState.applications.find((a: any) => a.id === appId);
          if (app) {
            app.status = "accepted";
            const job = mockState.jobs.find((j: any) => j.id === app.jobId);
            if (job) {
              job.status = "in_progress";
              job.freelancerAddress = app.freelancerAddress;
            }
            persistState(mockState);
            responseData = { success: true, data: app };
          }
        }
        else if (pathname.includes("/api/time-entries")) {
          if (method === "GET") {
            const urlObj = new URL(url, window.location.origin);
            const jobId = urlObj.searchParams.get("jobId") || pathname.split("/").pop();
            responseData = { success: true, data: mockState.timeEntries.filter((e: any) => e.jobId === jobId) };
          } else if (method === "POST") {
            const b = JSON.parse(body as string);
            const entry = {
              id: `time-${mockState.timeEntries.length + 1}`,
              jobId: b.jobId,
              durationMinutes: b.durationMinutes,
              description: b.description,
              createdAt: new Date().toISOString(),
            };
            mockState.timeEntries.push(entry);
            persistState(mockState);
            responseData = { success: true, data: entry };
            status = 201;
          }
        }
        else if (pathname === "/api/ratings" && method === "POST") {
          const b = JSON.parse(body as string);
          mockState.ratings.push({
            jobId: b.jobId,
            raterAddress: "unknown",
            ratedAddress: b.ratedAddress,
            stars: b.stars,
          });
          persistState(mockState);
          responseData = { success: true, data: { id: `rating-${mockState.ratings.length}` } };
          status = 201;
        }
        else if (pathname.includes("/api/profiles/")) {
          if (pathname.includes("/client-reputation")) {
            responseData = { success: true, data: { score: 4.5, paymentReleaseRate: 95, disputeRate: 2, completionRate: 90, avgTimeToReleaseHours: 24, responseTimeToApplicationsHours: 12 } };
          } else {
            const pk = pathname.split("/").pop();
            responseData = { success: true, data: { publicKey: pk, role: "both" } };
          }
        }
        else if (pathname.includes("/faucet/status")) {
          responseData = { success: true, data: { enabled: true } };
        }

        setTimeout(() => {
          Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
          Object.defineProperty(xhr, "status", { value: status, configurable: true });
          Object.defineProperty(xhr, "responseText", { value: JSON.stringify(responseData), configurable: true });
          xhr.dispatchEvent(new Event("readystatechange"));
          xhr.dispatchEvent(new Event("load"));
          xhr.dispatchEvent(new Event("loadend"));
        }, 10);
        return;
      }

      return origSend.apply(this, arguments as any);
    };
  }, { state: initialState, clientAddr: CLIENT_ADDRESS, freelancerAddr: FREELANCER_ADDRESS });

  await page.route("https://api.coingecko.com/**", async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ stellar: { usd: 0.12 } }) });
  });

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
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true, data: [] }) });
    }
  });
}

test.describe("full marketplace flow", () => {
  test.slow();

  test("should complete the full hire-to-pay lifecycle", async ({ page }) => {
    const state = createInitialState();
    await installPersistentApiMocks(page, state);

    await mockFreighter(page, CLIENT_ADDRESS);
    await page.goto("/post-job");
    await page.locator("input[name=title]").fill("Build marketplace escrow integration tests");
    await page.locator("textarea[name=description]").fill("Need an end to end Playwright flow covering posting, escrow funding, applications, progress updates, release, and ratings.");
    await page.locator("input[name=budget]").fill("50");
    await page.getByRole("button", { name: /^Post Job$/i }).click();
    await expect(page.getByText("Job Posted!")).toBeVisible({ timeout: 20000 });

    const jobId = await page.evaluate(() => {
       const s = JSON.parse(sessionStorage.getItem("__MARKETPLACE_MOCK_STATE__") || "{}");
       return s.jobs[0]?.id;
    });
    expect(jobId).toBeTruthy();

    await mockFreighter(page, FREELANCER_ADDRESS);
    await page.goto(`/jobs/${jobId}`);
    await page.getByRole("button", { name: "Apply for this Job" }).click();
    await page.getByLabel("Cover Letter").fill(PROPOSAL_TEXT);
    await page.getByRole("button", { name: "Submit Proposal" }).click({ force: true });
    await page.getByRole("button", { name: "Confirm & Submit" }).click({ force: true });
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

    await mockFreighter(page, CLIENT_ADDRESS);
    await page.goto(`/jobs/${jobId}`);
    await page.getByRole("button", { name: "Release Escrow" }).click();
    await expect(page.getByText("Rate your experience working together")).toBeVisible();

    await page.getByRole("button", { name: "5 stars" }).click();
    await page.getByRole("button", { name: "Submit Rating" }).click();
    
    await mockFreighter(page, FREELANCER_ADDRESS);
    await page.goto(`/jobs/${jobId}`);
    await page.getByRole("button", { name: "5 stars" }).click();
    await page.getByRole("button", { name: "Submit Rating" }).click();

    const ratingCount = await page.evaluate(() => {
       const s = JSON.parse(sessionStorage.getItem("__MARKETPLACE_MOCK_STATE__") || "{}");
       return s.ratings.length;
    });
    expect(ratingCount).toBeGreaterThanOrEqual(2);
  });
});
