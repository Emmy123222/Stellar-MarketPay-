/**
 * tests/e2e/accessibility.spec.ts
 * Automated axe-core accessibility audit across all pages.
 * Fails on critical and serious violations, with specific focus on color contrast.
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

    test(`zero color contrast violations on ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const contrastViolations = results.violations.filter(
        (v) => v.id === "color-contrast" || v.id === "color-contrast-enhanced"
      );

      if (contrastViolations.length > 0) {
        const details = contrastViolations
          .map((v) => {
            const nodes = v.nodes
              .map(
                (n) =>
                  `  - ${n.html.substring(0, 100)}\n    ${n.any.map((check) => check.message).join(", ")}`
              )
              .join("\n");
            return `[${v.impact}] ${v.id}: ${v.description}\n${nodes}\n  Help: ${v.helpUrl}`;
          })
          .join("\n\n");

        expect.soft(
          contrastViolations.length,
          `Found ${contrastViolations.length} color contrast violation(s):\n${details}`,
        ).toBe(0);
      }

      expect(contrastViolations.length).toBe(0);
    });
  });
}

// Test high contrast theme specifically
test.describe("Accessibility: High Contrast Theme", () => {
  test("no violations in high contrast mode on home page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    
    // Enable high contrast theme
    await page.evaluate(() => {
      localStorage.setItem("smp_theme", "high-contrast");
      document.documentElement.classList.add("high-contrast");
    });
    
    await page.reload({ waitUntil: "networkidle" });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const critical = results.violations.filter((v) => v.impact === "critical");
    const serious = results.violations.filter((v) => v.impact === "serious");

    expect(critical.length + serious.length).toBe(0);
  });
});

// Test dark mode specifically
test.describe("Accessibility: Dark Mode", () => {
  test("no violations in dark mode on key pages", async ({ page }) => {
    const keyPages = ["/", "/jobs", "/dashboard"];
    
    for (const path of keyPages) {
      await page.goto(path, { waitUntil: "networkidle" });
      
      // Enable dark mode
      await page.evaluate(() => {
        localStorage.setItem("smp_theme", "dark");
        document.documentElement.classList.add("dark");
      });
      
      await page.reload({ waitUntil: "networkidle" });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      const contrastViolations = results.violations.filter(
        (v) => v.id === "color-contrast"
      );

      expect(contrastViolations.length, `Dark mode contrast violations on ${path}`).toBe(0);
    }
  });
});
