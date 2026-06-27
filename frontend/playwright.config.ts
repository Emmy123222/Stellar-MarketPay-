import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  snapshotDir: "./e2e/snapshots",
  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.001 },
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_USE_CONTRACT_MOCK: "true",
      NEXT_PUBLIC_API_URL: "http://localhost:4000",
      NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
      NEXT_PUBLIC_HORIZON_URL: "https://horizon-testnet.stellar.org",
      NEXT_PUBLIC_CONTRACT_ID: "CMOCKCONTRACTID",
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
  ],
});
