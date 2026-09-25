import { expect, test, type Page } from "@playwright/test";

/**
 * E2E coverage for the Freighter wallet connection flow — the entry point for
 * every authenticated action in the app.
 *
 * The Freighter browser extension isn't available in CI, so `window.freighter`
 * is stubbed before any page script runs (page.addInitScript). The stub starts
 * in the "not yet allowed" state so the app's auto-connect-on-mount is a no-op,
 * which means the explicit "Connect Wallet" click is what actually signs the
 * user in.
 *
 * Backend traffic uses the same dual-layer mock as the other suites:
 *   Layer 1 — XHR patch intercepting axios before any HTTP traffic (avoids the
 *             cross-origin wall between the Next.js origin and the API base URL).
 *   Layer 2 — page.route() safety nets for external origins (Horizon, CoinGecko).
 */

const PUBLIC_KEY = "GCFXWALLETTESTADDRESS1234567890EXAMPLEABCDEF";
// Navbar renders shortenAddress(publicKey): first 6 + "..." + last 6 chars.
const SHORTENED_KEY = "GCFXWA...ABCDEF";

/**
 * Stub the Freighter extension injected script. Mirrors the real lifecycle:
 * `isAllowed()` is false until `requestAccess()` is approved, exactly like a
 * first-time connection in a real browser.
 */
async function mockFreighter(page: Page) {
  await page.addInitScript(({ publicKey }) => {
    const state = { allowed: false };
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: true }),
      isAllowed: async () => ({ isAllowed: state.allowed }),
      requestAccess: async () => {
        state.allowed = true;
        return { error: null };
      },
      getPublicKey: async () => (state.allowed ? { publicKey } : { publicKey: "" }),
      signTransaction: async () => ({ signedTransaction: "mock-signed-challenge-xdr" }),
    };
  }, { publicKey: PUBLIC_KEY });
}

/**
 * Keep first-run UI (onboarding wizard, checklist) out of the way — this suite
 * covers the wallet flow, not the tour.
 */
async function seedStableUiState(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "marketpay_onboarding_completed",
      JSON.stringify({ hasSeenWelcome: true }),
    );
    localStorage.setItem(
      "marketpay_onboarding_wizard",
      JSON.stringify({ completed: true, dismissed: true }),
    );
  });
}

/**
 * Force the Next.js server to render in English.  Without this the
 * Accept-Language header from headless Chromium on Linux CI can cause the
 * server to render a non-English locale, producing a hydration-error overlay
 * that blocks the entire page.
 */
async function ensureEnglishLocale(page: Page) {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: "en", domain: "127.0.0.1", path: "/" },
  ]);
}

/**
 * Intercept every backend/network call the flow touches.
 *
 * Layer 1: XHR patch — the axios client targets NEXT_PUBLIC_API_URL
 * (http://localhost:4000), a different origin from the app, so real requests
 * would need CORS/preflight handling. Patching XHR answers axios in-page with
 * the exact response shapes lib/api expects. The async setTimeout keeps the
 * responses genuinely asynchronous like the network would be.
 */
async function installApiMocks(page: Page) {
  await page.addInitScript(() => {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      (this as any).__url = typeof url === "string" ? url : (url as any).href;
      (this as any).__method = method;
      return origOpen.apply(this, arguments as any);
    };

    XMLHttpRequest.prototype.send = function () {
      const url = (this as any).__url || "";
      const method = (this as any).__method || "GET";
      const xhr = this;

      if (url.includes("/api/")) {
        const pathname = new URL(url, window.location.origin).pathname;
        let responseData: unknown = { success: true, data: [] };
        let status = 200;

        // Order matters: csrf-token lives under /api/auth/*.
        if (pathname === "/api/auth/csrf-token") {
          responseData = { csrfToken: "test-csrf-token" };
        } else if (pathname === "/api/auth") {
          // SEP-0010 pair: challenge on GET, JWT verification on POST.
          if (method === "POST") responseData = { success: true, token: "jwt-token" };
          else responseData = { transaction: "challenge-xdr" };
        } else if (pathname.startsWith("/api/profiles/")) {
          const pk = pathname.split("/").pop();
          responseData = { success: true, data: { publicKey: pk, role: "both" } };
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
  });

  // Layer 2 safety nets for external origins. CORS headers are included so
  // the page can actually read the mocked responses.

  // Keep the navbar's balance lookups offline-deterministic (it falls back to
  // 0.00 XLM / USDC when Horizon doesn't know the account).
  await page.route("https://horizon-testnet.stellar.org/**", (route) =>
    route.fulfill({
      status: 404,
      headers: { "Access-Control-Allow-Origin": "*" },
      contentType: "application/json",
      body: "{}",
    }),
  );
  await page.route("https://api.coingecko.com/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      contentType: "application/json",
      body: JSON.stringify({ stellar: { usd: 0.12 } }),
    }),
  );
}

test.describe("Wallet connection (Freighter)", () => {
  test('clicking "Connect Wallet" approves the mocked Freighter and signs the user in', async ({ page }) => {
    await mockFreighter(page);
    await seedStableUiState(page);
    await installApiMocks(page);
    await ensureEnglishLocale(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const connectButton = page.getByRole("button", { name: "Connect Wallet" });
    await expect(connectButton).toBeVisible();

    // Approve happens inside the stubbed extension — the click must drive the
    // full chain: requestAccess → getPublicKey → SEP-0010 challenge/sign/verify.
    await connectButton.click();

    // Authenticated navbar: address pill replaces the Connect button and a
    // Disconnect action appears. The key renders twice (desktop + mobile
    // spans), so match the pill button instead of the raw text.
    await expect(
      page.getByRole("button", { name: SHORTENED_KEY }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
    await expect(connectButton).not.toBeVisible();

    // Session persisted so a reload restores authenticated state.
    const storedKey = await page.evaluate(() =>
      localStorage.getItem("smp_wallet_public_key"),
    );
    expect(storedKey).toBe(PUBLIC_KEY);
  });

  test("with Freighter unavailable the UI shows the Install Freighter guidance", async ({ page }) => {
    // Deliberately NO mockFreighter — window.freighter stays undefined, which
    // is exactly how a browser without the extension behaves.
    await seedStableUiState(page);
    await installApiMocks(page);
    await ensureEnglishLocale(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Home hero opens the WalletConnect card.
    await page.getByRole("button", { name: "Get Started Free" }).click();
    await expect(page.getByRole("heading", { name: "Connect Wallet" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Install Freighter/i })).toBeVisible();

    // Attempting to connect without the extension sends the user to
    // freighter.app to install it.
    const popupPromise = page.waitForEvent("popup", { timeout: 15_000 });
    await page.getByRole("button", { name: "Connect Freighter Wallet" }).click();
    const popup = await popupPromise;
    expect(popup.url()).toContain("freighter.app");
  });

  test("disconnecting the wallet returns the UI to the unauthenticated state", async ({ page }) => {
    await mockFreighter(page);
    await seedStableUiState(page);
    await installApiMocks(page);
    await ensureEnglishLocale(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();

    await page.getByRole("button", { name: "Disconnect" }).click();

    await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
    await expect(page.getByText(SHORTENED_KEY)).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
  });
});
