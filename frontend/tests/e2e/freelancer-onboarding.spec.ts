import { expect, test, type Page } from "@playwright/test";

const FREELANCER_ADDRESS = "GFREELANCERONBOARDING1234567890EXAMPLEABCDEF";

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

async function clearOnboardingStorage(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem("marketpay_onboarding_completed");
    localStorage.removeItem("marketpay_tooltips_dismissed");
  });
}

async function installOnboardingApiMocks(page: Page) {
  await page.addInitScript((publicKey) => {
    let profile = {
      publicKey,
      displayName: "",
      bio: "",
      skills: [],
      portfolioItems: [],
      portfolioFiles: [],
      availability: { status: "" },
    };

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
        let responseData: any = { success: true, data: null };
        let status = 200;

        if (pathname.includes("/api/auth")) {
          if (method === "POST") responseData = { success: true, token: "jwt-token" };
          else responseData = { success: true, transaction: "challenge-xdr" };
        }
        else if (pathname.includes("/api/profiles/")) {
          const pk = pathname.split("/").pop();
          if (method === "GET") {
            responseData = { success: true, data: { ...profile, publicKey: pk } };
          } else if (method === "PATCH") {
            const updates = JSON.parse(body as string);
            profile = { ...profile, ...updates };
            responseData = { success: true, data: { ...profile, publicKey: pk } };
          }
        }
        else if (pathname.includes("/api/jobs")) {
          responseData = { success: true, data: [] };
        }
        else if (pathname.includes("/api/applications")) {
          responseData = { success: true, data: [] };
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
  }, FREELANCER_ADDRESS);

  await page.route("https://api.coingecko.com/**", async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ stellar: { usd: 0.12 } }) });
  });
}

test.describe("freelancer onboarding flow", () => {
  test.slow();

  test("should show welcome modal on first login for new freelancer", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Welcome modal should be visible
    await expect(page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Complete your profile")).toBeVisible();
    await expect(page.getByText("Post or find jobs")).toBeVisible();
    await expect(page.getByText("Connect your wallet")).toBeVisible();
  });

  test("should navigate to profile edit when clicking Get Started", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i })).toBeVisible();
    
    await page.getByRole("button", { name: "Get Started" }).click();
    
    // Should navigate to profile edit tab
    await expect(page).toHaveURL(/\/dashboard\?tab=edit_profile/);
  });

  test("should dismiss welcome modal when clicking Dismiss", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i })).toBeVisible();
    
    await page.getByRole("button", { name: "Dismiss" }).click();
    
    // Welcome modal should disappear
    await expect(page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i })).not.toBeVisible();
    
    // Verify localStorage was updated
    const hasSeenWelcome = await page.evaluate(() => {
      const stored = localStorage.getItem("marketpay_onboarding_completed");
      return stored ? JSON.parse(stored).hasSeenWelcome : false;
    });
    expect(hasSeenWelcome).toBe(true);
  });

  test("should show profile checklist for incomplete profile", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal first
    await page.getByRole("button", { name: "Dismiss" }).click();
    
    // Profile checklist should appear
    await expect(page.getByText("Complete your profile")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Add display name")).toBeVisible();
    await expect(page.getByText("Write a bio")).toBeVisible();
    await expect(page.getByText("Add your skills")).toBeVisible();
    await expect(page.getByText("Add portfolio items")).toBeVisible();
    await expect(page.getByText("Set your availability")).toBeVisible();
  });

  test("should show progress bar with correct completion percentage", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await page.getByRole("button", { name: "Dismiss" }).click();
    
    // Should show 0/5 completed
    await expect(page.getByText("0/5 completed")).toBeVisible();
  });

  test("should navigate to profile edit when clicking checklist item", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await page.getByRole("button", { name: "Dismiss" }).click();
    
    // Click on "Add display name" checklist item
    await page.getByText("Add display name").click();
    
    // Should navigate to profile edit
    await expect(page).toHaveURL(/\/dashboard\?tab=edit_profile/);
  });

  test("should update progress as profile items are completed", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await page.getByRole("button", { name: "Dismiss" }).click();
    
    // Navigate to profile edit
    await page.goto("/dashboard?tab=edit_profile");
    
    // Fill in display name (≥3 characters)
    await page.locator("input[name=displayName]").fill("John Doe");
    await page.getByRole("button", { name: /Save/i }).click();
    
    // Go back to dashboard
    await page.goto("/dashboard");
    
    // Progress should update to 1/5 (20%)
    await expect(page.getByText("1/5 completed")).toBeVisible({ timeout: 5000 });
    
    // Navigate to profile edit again
    await page.goto("/dashboard?tab=edit_profile");
    
    // Fill in bio (≥10 characters)
    await page.locator("textarea[name=bio]").fill("Experienced freelancer with 5 years of experience");
    await page.getByRole("button", { name: /Save/i }).click();
    
    // Go back to dashboard
    await page.goto("/dashboard");
    
    // Progress should update to 2/5 (40%)
    await expect(page.getByText("2/5 completed")).toBeVisible({ timeout: 5000 });
  });

  test("should show tooltips for key actions", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await page.getByRole("button", { name: "Dismiss" }).click();
    
    // Tooltips should appear for new users
    await expect(page.getByText("Post Your First Job")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Connect Wallet")).toBeVisible();
    await expect(page.getByText("Browse Jobs")).toBeVisible();
  });

  test("should dismiss individual tooltip", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await page.getByRole("button", { name: "Dismiss" }).click();
    
    // Wait for tooltips to appear
    await expect(page.getByText("Post Your First Job")).toBeVisible();
    
    // Dismiss one tooltip
    const dismissButton = page.getByRole("button").filter({ hasText: "×" }).first();
    await dismissButton.click();
    
    // Verify localStorage was updated
    const dismissedTooltips = await page.evaluate(() => {
      const stored = localStorage.getItem("marketpay_tooltips_dismissed");
      return stored ? JSON.parse(stored) : [];
    });
    expect(dismissedTooltips.length).toBeGreaterThan(0);
  });

  test("should dismiss all tooltips at once", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await page.getByRole("button", { name: "Dismiss" }).click();
    
    // Wait for tooltips to appear
    await expect(page.getByText("Post Your First Job")).toBeVisible();
    
    // Click "Dismiss All Tips"
    await page.getByRole("button", { name: "Dismiss All Tips" }).click();
    
    // All tooltips should disappear
    await expect(page.getByText("Post Your First Job")).not.toBeVisible();
    await expect(page.getByText("Connect Wallet")).not.toBeVisible();
    await expect(page.getByText("Browse Jobs")).not.toBeVisible();
    
    // Verify localStorage was updated
    const dismissedTooltips = await page.evaluate(() => {
      const stored = localStorage.getItem("marketpay_tooltips_dismissed");
      return stored ? JSON.parse(stored) : [];
    });
    expect(dismissedTooltips.length).toBe(3);
  });

  test("should complete onboarding when profile is 100% complete", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await page.getByRole("button", { name: "Dismiss" }).click();
    
    // Navigate to profile edit and complete all items
    await page.goto("/dashboard?tab=edit_profile");
    
    // Fill in all required fields
    await page.locator("input[name=displayName]").fill("John Doe");
    await page.locator("textarea[name=bio]").fill("Experienced freelancer with 5 years of experience");
    
    // Add skills
    const skillsInput = page.locator("input[name=skills]");
    await skillsInput.fill("JavaScript, TypeScript, React");
    await page.keyboard.press("Enter");
    
    // Add portfolio item
    await page.locator("input[name=portfolioTitle]").fill("My Portfolio Project");
    await page.locator("textarea[name=portfolioDescription]").fill("A great project I built");
    await page.getByRole("button", { name: /Add Portfolio Item/i }).click();
    
    // Set availability
    await page.locator("select[name=availability]").selectOption("available");
    
    // Save profile
    await page.getByRole("button", { name: /Save/i }).click();
    
    // Go back to dashboard
    await page.goto("/dashboard");
    
    // Should show completion badge
    await expect(page.getByText("Profile Complete!")).toBeVisible({ timeout: 5000 });
    
    // Checklist should be hidden when complete
    await expect(page.getByText("Complete your profile")).not.toBeVisible();
  });

  test("should restart onboarding from settings", async ({ page }) => {
    // First, complete onboarding
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await page.getByRole("button", { name: "Dismiss" }).click();
    
    // Navigate to settings
    await page.goto("/dashboard?tab=security");
    
    // Click "Restart Onboarding Tour"
    await page.getByRole("button", { name: "Restart Onboarding Tour" }).click();
    
    // Page should reload and show welcome modal again
    await expect(page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i })).toBeVisible({ timeout: 10000 });
    
    // Verify localStorage was cleared
    const hasSeenWelcome = await page.evaluate(() => {
      const stored = localStorage.getItem("marketpay_onboarding_completed");
      return stored ? JSON.parse(stored).hasSeenWelcome : false;
    });
    expect(hasSeenWelcome).toBe(false);
  });

  test("should persist onboarding state across page reloads", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i })).not.toBeVisible();
    
    // Reload page
    await page.reload();
    
    // Welcome modal should not appear again
    await expect(page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i })).not.toBeVisible({ timeout: 5000 });
    
    // Checklist should still be visible (profile incomplete)
    await expect(page.getByText("Complete your profile")).toBeVisible();
  });

  test("should not show onboarding for users with complete profiles", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    
    // Mock API to return complete profile
    await page.addInitScript((publicKey) => {
      let profile = {
        publicKey,
        displayName: "Complete User",
        bio: "This is a complete bio with more than 10 characters",
        skills: ["JavaScript", "TypeScript"],
        portfolioItems: [{ title: "Project", description: "Description" }],
        portfolioFiles: [],
        availability: { status: "available" },
      };

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
          let responseData: any = { success: true, data: null };

          if (pathname.includes("/api/auth")) {
            if (method === "POST") responseData = { success: true, token: "jwt-token" };
            else responseData = { success: true, transaction: "challenge-xdr" };
          }
          else if (pathname.includes("/api/profiles/")) {
            const pk = pathname.split("/").pop();
            responseData = { success: true, data: { ...profile, publicKey: pk } };
          }
          else if (pathname.includes("/api/jobs")) {
            responseData = { success: true, data: [] };
          }

          setTimeout(() => {
            Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
            Object.defineProperty(xhr, "status", { value: 200, configurable: true });
            Object.defineProperty(xhr, "responseText", { value: JSON.stringify(responseData), configurable: true });
            xhr.dispatchEvent(new Event("readystatechange"));
            xhr.dispatchEvent(new Event("load"));
            xhr.dispatchEvent(new Event("loadend"));
          }, 10);
          return;
        }

        return origSend.apply(this, arguments as any);
      };
    }, FREELANCER_ADDRESS);

    await page.route("https://api.coingecko.com/**", async (route) => {
      await route.fulfill({ status: 200, body: JSON.stringify({ stellar: { usd: 0.12 } }) });
    });

    await page.goto("/dashboard");
    
    // Welcome modal should not appear for users with complete profiles
    await expect(page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i })).not.toBeVisible({ timeout: 5000 });
    
    // Checklist should not appear
    await expect(page.getByText("Complete your profile")).not.toBeVisible();
  });
});
