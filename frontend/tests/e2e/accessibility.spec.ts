/**
 * tests/e2e/accessibility.spec.ts
 * Automated axe-core accessibility audit across all pages.
 * Fails on critical and serious violations.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = [
  { path: "/", name: "Home" },
  { path: "/jobs", name: "Jobs" },
  { path: "/freelancers", name: "Freelancers" },
  { path: "/notifications", name: "Notifications" },
  { path: "/dashboard", name: "Dashboard" },
  { path: "/dashboard/transactions", name: "Transactions" },
  { path: "/post-job", name: "Post Job" },
  { path: "/insights", name: "Insights" },
  { path: "/stats", name: "Stats" },
  { path: "/status", name: "Status" },
  { path: "/admin", name: "Admin" },
  { path: "/developer", name: "Developer" },
  { path: "/dao", name: "DAO" },
  { path: "/404", name: "404" },
  { path: "/offline", name: "Offline" },
  { path: "/jobs/some-id", name: "Job Detail (mock)" },
  { path: "/freelancers/some-key", name: "Freelancer Profile (mock)" },
  { path: "/disputes/some-id", name: "Dispute Detail (mock)" },
  { path: "/certificates/some-id", name: "Certificate (mock)" },
  { path: "/scope/some-session", name: "Scope Session (mock)" },
];

for (const { path, name } of PAGES) {
  test.describe(`Accessibility: ${name}`, () => {
    test(`no critical or serious violations on ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        .analyze();

      const critical = results.violations.filter((v) => v.impact === "critical");
      const serious = results.violations.filter((v) => v.impact === "serious");

      if (critical.length > 0 || serious.length > 0) {
        const details = [...critical, ...serious]
          .map(
            (v) =>
              `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} element(s))\n  Help: ${v.helpUrl}`,
          )
          .join("\n\n");
        expect.soft(
          critical.length + serious.length,
          `Found ${critical.length} critical and ${serious.length} serious violations:\n${details}`,
        ).toBe(0);
      }

      expect(results.violations.filter((v) => v.impact === "critical").length).toBe(0);
    });
  });
}
