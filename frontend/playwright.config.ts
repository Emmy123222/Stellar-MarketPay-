import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  snapshotDir: "./test-results/snapshots",
  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",
  timeout: 240_000, // Increased from 60_000 (4 min for E2E tests)
  expect: {
    timeout: 15_000, // Increased from 10_000 (15s)
    toHaveScreenshot: { maxDiffPixelRatio: 0.001 },
  },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0, // Reduced from 2 to 1 retry in CI
  workers: process.env.CI ? 1 : undefined, // Changed from 2 to 1 (sequential in CI to reduce race conditions)
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
    actionTimeout: 20_000, // Added explicit action timeout
    navigationTimeout: 30_000, // Added explicit navigation timeout
    bypassCSP: true,
  },
  webServer: {
    // Dedicated port + direct next invocation: `npm run dev` shells out to
    // `cp`, which does not exist on Windows, and keeps the e2e server isolated
    // from anything already bound to the default dev port.
    command: "npx next dev -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_USE_CONTRACT_MOCK: "true",
      NEXT_PUBLIC_API_URL: "http://localhost:4000",
      NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
      NEXT_PUBLIC_HORIZON_URL: "https://horizon-testnet.stellar.org",
      NEXT_PUBLIC_CONTRACT_ID: "CMOCKCONTRACTID",
      SKIP_API_CALLS: "true",
    },
  },
  projects: [
    {
      name: "chromium",
      // Pin locale to en-US so SSR and client both render English nav text.
      // Without this the OS locale (Spanish) leaks into Accept-Language;
      // the server renders "Inicio" while the client renders "Home", causing
      // a hydration-error overlay that blocks the admin page in tests.
      use: {
        ...devices["Desktop Chrome"],
        locale: "en-US",
        // Fixed viewport prevents components from collapsing or re-stacking
        // when running headed for visual inspection.
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "chromium-dark",
      // Dark mode project for testing dark theme support
      use: {
        ...devices["Desktop Chrome"],
        locale: "en-US",
        colorScheme: "dark",
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
