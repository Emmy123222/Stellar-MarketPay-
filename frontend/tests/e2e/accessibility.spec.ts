import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = [
  { path: "/", name: "Home" },
  { path: "/jobs", name: "Jobs" },
  { path: "/freelancers", name: "Freelancers" },
];

for (const { path, name } of PAGES) {
  test.describe(`Accessibility: ${name}`, () => {
    test(`no critical or serious violations on ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        .analyze();

      const critical = results.violations.filter(
        (v) => v.impact === "critical",
      );
      const serious = results.violations.filter((v) => v.impact === "serious");

      expect(critical.length + serious.length).toBe(0);
    });

    test(`zero color contrast violations on ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const contrastViolations = results.violations.filter(
        (v) => v.id === "color-contrast" || v.id === "color-contrast-enhanced",
      );

      expect(contrastViolations.length).toBe(0);
    });
  });
}
