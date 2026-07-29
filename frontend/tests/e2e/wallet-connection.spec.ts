import { expect, test, type Page } from "@playwright/test";

const walletAddress = "GCFXWALLETTESTADDRESS1234567890EXAMPLEABCDEF";

async function mockFreighter(page: Page, connected = true, hasFreighter = true) {
  if (!hasFreighter) {
    await page.addInitScript(() => {
      (window as any).freighter = undefined;
    });
    return;
  }
  await page.addInitScript(({ isConnected, publicKey }) => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected }),
      isAllowed: async () => ({ isAllowed: isConnected }),
      requestAccess: async () => ({ error: null }),
      getPublicKey: async () => ({ publicKey }),
      signTransaction: async () => ({ signedTransaction: "signed-xdr" }),
      on: () => {},
      off: () => {},
    };
  }, { isConnected: connected, publicKey: walletAddress });
}

async function setupApiMocks(page: Page) {
  await page.route("**/api/auth?account=**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ transaction: "challenge-xdr" })
    });
  });

  await page.route("**/api/auth", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, token: "jwt-token" })
    });
  });

  await page.route("**/api/profiles/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { publicKey: walletAddress, role: "freelancer" } })
    });
  });
}

test.describe("Wallet Connection Flow", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test("click 'Connect Wallet' -> mock Freighter approves -> user is authenticated", async ({ page }) => {
    await mockFreighter(page, true, true);
    await page.goto("/");

    const connectBtn = page.getByRole("button", { name: /Connect Wallet/i }).first();
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();
    
    // Check if Onboarding wizard connect button appears (sometimes it requires a second click inside the modal)
    const connectFreighterBtn = page.getByRole("button", { name: /Connect Freighter Wallet/i });
    if (await connectFreighterBtn.isVisible()) {
      await connectFreighterBtn.click();
    }
    
    // Expect the wallet address to be displayed (Navbar usually shows it, maybe sliced or full)
    // We look for Disconnect button as the primary indicator of authentication
    const disconnectBtn = page.getByRole("button", { name: /Disconnect/i }).first();
    await expect(disconnectBtn).toBeVisible();
  });

  test("wallet unavailable -> show 'Install Freighter' message", async ({ page, context }) => {
    await mockFreighter(page, false, false);
    await page.goto("/");

    const connectBtn = page.getByRole("button", { name: /Connect Wallet/i }).first();
    await expect(connectBtn).toBeVisible();

    // Click connect and wait for new tab opening Freighter website
    const [newPage] = await Promise.all([
      context.waitForEvent("page"),
      connectBtn.click()
    ]);
    
    expect(newPage.url()).toContain("freighter.app");
  });

  test("user disconnects wallet -> UI reflects unauthenticated state", async ({ page }) => {
    await mockFreighter(page, true, true);
    await page.goto("/");

    // Connect
    const connectBtn = page.getByRole("button", { name: /Connect Wallet/i }).first();
    await connectBtn.click();
    
    const connectFreighterBtn = page.getByRole("button", { name: /Connect Freighter Wallet/i });
    if (await connectFreighterBtn.isVisible()) {
      await connectFreighterBtn.click();
    }

    // Verify connected
    const disconnectBtn = page.getByRole("button", { name: /Disconnect/i }).first();
    await expect(disconnectBtn).toBeVisible();

    // Disconnect
    await disconnectBtn.click();

    // Verify unauthenticated
    await expect(page.getByRole("button", { name: /Connect Wallet/i }).first()).toBeVisible();
  });
});
