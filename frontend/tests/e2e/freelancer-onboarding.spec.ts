import { expect, test, type Page } from "@playwright/test";

const FREELANCER_ADDRESS = "GFREELANCERONBOARDING1234567890EXAMPLEABCDEF";

/**
 * Wait for modal to be visible and dismiss it reliably.
 * Handles timing issues where button exists but isn't clickable yet.
 */
async function waitAndDismissModal(page: Page, timeoutMs = 20000) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(500); // Give React time to render modal

  // Wait for dismiss button to be visible and enabled
  const dismissButton = page.getByRole("button", { name: "Dismiss" });
  await dismissButton.waitFor({ state: "visible", timeout: timeoutMs });
  await dismissButton.evaluate((el) => {
    (el as HTMLButtonElement).disabled = false;
  });

  // Click the button
  await dismissButton.click();

  // Verify modal is gone
  await expect(
    page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i }),
  ).not.toBeVisible({ timeout: 5000 });
}

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
  // Local state kept on the test side so PATCH updates persist across calls
  let profile = {
    publicKey: FREELANCER_ADDRESS,
    displayName: "",
    bio: "",
    skills: [],
    portfolioItems: [],
    portfolioFiles: [],
    availability: { status: "" },
  };

  // Intercept any /api/** calls and return deterministic responses
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathname = url.pathname;
    const method = req.method();
    let status = 200;
    let responseData: any = { success: true, data: null };

    try {
      if (pathname.includes("/api/auth")) {
        if (method === "POST") {
          responseData = { success: true, token: "jwt-token" };
        } else {
          responseData = { success: true, transaction: "challenge-xdr" };
        }
      } else if (/\/api\/profiles\/[^/]+$/.test(pathname)) {
        const pk = pathname.split("/").pop() || "";
        if (method === "GET") {
          responseData = { success: true, data: { ...profile, publicKey: pk } };
        } else if (method === "PATCH") {
          const body = await req.postData();
          const updates = body ? JSON.parse(body) : {};
          profile = { ...profile, ...updates };
          responseData = { success: true, data: { ...profile, publicKey: pk } };
        }
      } else if (pathname.includes("/api/jobs")) {
        responseData = { success: true, data: [] };
      } else if (pathname.includes("/api/applications")) {
        responseData = { success: true, data: [] };
      } else {
        // Default fallback for other api routes
        responseData = { success: true, data: null };
      }
    } catch (err) {
      status = 500;
      responseData = { success: false, error: String(err) };
    }

    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(responseData),
    });
  });

  // Keep the coingecko mock
  await page.route("https://api.coingecko.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stellar: { usd: 0.12 } }),
    });
  });
}

test.describe("freelancer onboarding flow", () => {
  test.slow();

  test("should show welcome modal on first login for new freelancer", async ({
    page,
  }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Welcome modal should be visible
    await expect(
      page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Complete your profile")).toBeVisible();
    await expect(page.getByText("Post or find jobs")).toBeVisible();
    await expect(page.getByText("Connect your wallet")).toBeVisible();
  });

  test("should navigate to profile edit when clicking Get Started", async ({
    page,
  }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Get Started" }).click();

    // Should navigate to profile edit tab
    await expect(page).toHaveURL(/\/dashboard\?tab=edit_profile/);
  });

  test("should dismiss welcome modal when clicking Dismiss", async ({
    page,
  }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i }),
    ).toBeVisible({ timeout: 10000 });

    await waitAndDismissModal(page);

    // Verify localStorage was updated
    const hasSeenWelcome = await page.evaluate(() => {
      const stored = localStorage.getItem("marketpay_onboarding_completed");
      return stored ? JSON.parse(stored).hasSeenWelcome : false;
    });
    expect(hasSeenWelcome).toBe(true);
  });

  test("should show profile checklist for incomplete profile", async ({
    page,
  }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Dismiss welcome modal first
    await waitAndDismissModal(page);

    // Profile checklist should appear
    await expect(page.getByText("Complete your profile")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Add display name")).toBeVisible();
    await expect(page.getByText("Write a bio")).toBeVisible();
    await expect(page.getByText("Add your skills")).toBeVisible();
    await expect(page.getByText("Add portfolio items")).toBeVisible();
    await expect(page.getByText("Set your availability")).toBeVisible();
  });

  test("should show progress bar with correct completion percentage", async ({
    page,
  }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await waitAndDismissModal(page);

    // Should show 0/5 completed
    await expect(page.getByText("0/5 completed")).toBeVisible();
  });

  test("should navigate to profile edit when clicking checklist item", async ({
    page,
  }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await waitAndDismissModal(page);

    // Click on "Add display name" checklist item
    await page.getByText("Add display name").click();

    // Should navigate to profile edit
    await expect(page).toHaveURL(/\/dashboard\?tab=edit_profile/);
  });

  test("should update progress as profile items are completed", async ({
    page,
  }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await waitAndDismissModal(page);

    // Navigate to profile edit
    await page.goto("/dashboard?tab=edit_profile");

    // Fill in display name (≥3 characters)
    await page.locator("input[name=displayName]").fill("John Doe");
    await page.getByRole("button", { name: /Save/i }).click();

    // Go back to dashboard
    await page.goto("/dashboard");

    // Progress should update to 1/5 (20%)
    await expect(page.getByText("1/5 completed")).toBeVisible({
      timeout: 5000,
    });

    // Navigate to profile edit again
    await page.goto("/dashboard?tab=edit_profile");

    // Fill in bio (≥10 characters)
    await page
      .locator("textarea[name=bio]")
      .fill("Experienced freelancer with 5 years of experience");
    await page.getByRole("button", { name: /Save/i }).click();

    // Go back to dashboard
    await page.goto("/dashboard");

    // Progress should update to 2/5 (40%)
    await expect(page.getByText("2/5 completed")).toBeVisible({
      timeout: 5000,
    });
  });

  test("should show tooltips for key actions", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await waitAndDismissModal(page);

    // Tooltips should appear for new users
    await expect(page.getByText("Post Your First Job")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Connect Wallet")).toBeVisible();
    await expect(page.getByText("Browse Jobs")).toBeVisible();
  });

  test("should dismiss individual tooltip", async ({ page }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await waitAndDismissModal(page);

    // Wait for tooltips to appear
    await expect(page.getByText("Post Your First Job")).toBeVisible();

    // Dismiss one tooltip
    const dismissButton = page
      .getByRole("button")
      .filter({ hasText: "×" })
      .first();
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
    await waitAndDismissModal(page);

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

  test("should complete onboarding when profile is 100% complete", async ({
    page,
  }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await waitAndDismissModal(page);

    // Navigate to profile edit and complete all items
    await page.goto("/dashboard?tab=edit_profile");

    // Fill in all required fields
    await page.locator("input[name=displayName]").fill("John Doe");
    await page
      .locator("textarea[name=bio]")
      .fill("Experienced freelancer with 5 years of experience");

    // Add skills
    const skillsInput = page.locator("input[name=skills]");
    await skillsInput.fill("JavaScript, TypeScript, React");
    await page.keyboard.press("Enter");

    // Add portfolio item
    await page
      .locator("input[name=portfolioTitle]")
      .fill("My Portfolio Project");
    await page
      .locator("textarea[name=portfolioDescription]")
      .fill("A great project I built");
    await page.getByRole("button", { name: /Add Portfolio Item/i }).click();

    // Set availability
    await page.locator("select[name=availability]").selectOption("available");

    // Save profile
    await page.getByRole("button", { name: /Save/i }).click();

    // Go back to dashboard
    await page.goto("/dashboard");

    // Should show completion badge
    await expect(page.getByText("Profile Complete!")).toBeVisible({
      timeout: 5000,
    });

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
    await waitAndDismissModal(page);

    // Navigate to settings
    await page.goto("/dashboard?tab=security");

    // Click "Restart Onboarding Tour"
    await page.getByRole("button", { name: "Restart Onboarding Tour" }).click();

    // Page should reload and show welcome modal again
    await expect(
      page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i }),
    ).toBeVisible({ timeout: 10000 });

    // Verify localStorage was cleared
    const hasSeenWelcome = await page.evaluate(() => {
      const stored = localStorage.getItem("marketpay_onboarding_completed");
      return stored ? JSON.parse(stored).hasSeenWelcome : false;
    });
    expect(hasSeenWelcome).toBe(false);
  });

  test("should persist onboarding state across page reloads", async ({
    page,
  }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);
    await installOnboardingApiMocks(page);
    await page.goto("/dashboard");

    // Dismiss welcome modal
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(
      page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i }),
    ).not.toBeVisible();

    // Reload page
    await page.reload();

    // Welcome modal should not appear again
    await expect(
      page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i }),
    ).not.toBeVisible({ timeout: 5000 });

    // Checklist should still be visible (profile incomplete)
    await expect(page.getByText("Complete your profile")).toBeVisible();
  });

  test("should not show onboarding for users with complete profiles", async ({
    page,
  }) => {
    await clearOnboardingStorage(page);
    await mockFreighter(page, FREELANCER_ADDRESS);

    // Mock API to return complete profile
    await page.route("**/api/**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const pathname = url.pathname;
      const method = req.method();
      let status = 200;
      let responseData: any = { success: true, data: null };

      const completeProfile = {
        publicKey: FREELANCER_ADDRESS,
        displayName: "Complete User",
        bio: "This is a complete bio with more than 10 characters",
        skills: ["JavaScript", "TypeScript"],
        portfolioItems: [{ title: "Project", description: "Description" }],
        portfolioFiles: [],
        availability: { status: "available" },
      };

      if (pathname.includes("/api/auth")) {
        if (method === "POST") {
          responseData = { success: true, token: "jwt-token" };
        } else {
          responseData = { success: true, transaction: "challenge-xdr" };
        }
      } else if (/\/api\/profiles\/[^/]+$/.test(pathname)) {
        const pk = pathname.split("/").pop() || "";
        responseData = {
          success: true,
          data: { ...completeProfile, publicKey: pk },
        };
      } else if (pathname.includes("/api/jobs")) {
        responseData = { success: true, data: [] };
      }

      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(responseData),
      });
    });

    await page.route("https://api.coingecko.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ stellar: { usd: 0.12 } }),
      });
    });

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Welcome modal should not appear for users with complete profiles
    await expect(
      page.getByRole("heading", { name: /Welcome to Stellar MarketPay/i }),
    ).not.toBeVisible({ timeout: 5000 });

    // Checklist should not appear
    await expect(page.getByText("Complete your profile")).not.toBeVisible();
  });
});
