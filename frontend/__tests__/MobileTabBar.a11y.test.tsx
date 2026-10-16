/**
 * __tests__/MobileTabBar.a11y.test.tsx
 *
 * Accessibility semantics for the primary mobile navigation (MobileTabBar):
 * aria-current on the active tab, accessible names on every control,
 * 44px touch targets, visible focus styling, and a jest-axe pass.
 *
 * Issue: #1895
 */
import { cleanup, render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import React from "react";
import MobileTabBar, { TABS } from "@/components/MobileTabBar";

expect.extend(toHaveNoViolations);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("@/lib/api", () => ({
  fetchNotifications: jest.fn().mockResolvedValue({ unreadCount: 0 }),
  setJwtToken: jest.fn(),
  getJwtToken: jest.fn().mockReturnValue(null),
}));

// Override the global next/router mock (from jest.setup.tsx) so each test can
// control the rendered pathname.
const mockUseRouter = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => mockUseRouter(),
}));

function makeRouter(pathname: string) {
  return { pathname, push: jest.fn(), query: {}, isReady: true };
}

function renderWithPathname(
  pathname: string,
  extraProps: Record<string, unknown> = {},
) {
  mockUseRouter.mockReturnValue(makeRouter(pathname));
  return render(<MobileTabBar publicKey={null} {...extraProps} />);
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Landmark and accessible names
// ---------------------------------------------------------------------------
describe("MobileTabBar - landmark and names", () => {
  it("exposes the bar as a labelled navigation landmark", () => {
    const { getByRole } = renderWithPathname("/");
    expect(
      getByRole("navigation", { name: "Mobile navigation" }),
    ).toBeInTheDocument();
  });

  it("every tab control has an accessible name matching its tab label", () => {
    const { getByRole } = renderWithPathname("/other");
    for (const tab of TABS) {
      // getByRole resolves the computed accessible name (aria-label/text).
      const link = getByRole("link", { name: tab.ariaLabel });
      expect(link).toHaveAttribute("href", tab.href);
      expect(link).toHaveTextContent(tab.label);
    }
  });

  it("decorative icons are hidden from the accessibility tree", () => {
    const { container } = renderWithPathname("/other");
    const icons = container.querySelectorAll("a svg");
    expect(icons.length).toBe(TABS.length);
    icons.forEach((icon) => {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    });
  });
});

// ---------------------------------------------------------------------------
// aria-current on the active tab
// ---------------------------------------------------------------------------
describe("MobileTabBar - aria-current", () => {
  it.each([
    ["/", "/"],
    ["/jobs", "/jobs"],
    ["/dashboard", "/dashboard"],
    ["/notifications", "/notifications"],
    ["/profile", "/profile"],
  ])("marks exactly one tab current for %s", (pathname, expectedHref) => {
    const { container } = renderWithPathname(pathname);
    const links = container.querySelectorAll("a");
    const current = Array.from(links).filter(
      (l) => l.getAttribute("aria-current") === "page",
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", expectedHref);
  });

  it("does not mark inactive tabs with aria-current", () => {
    const { container } = renderWithPathname("/jobs");
    const inactive = Array.from(container.querySelectorAll("a")).filter(
      (l) => l.getAttribute("href") !== "/jobs",
    );
    expect(inactive.length).toBeGreaterThan(0);
    inactive.forEach((link) => {
      expect(link).not.toHaveAttribute("aria-current");
    });
  });

  it("marks the parent tab current on nested routes", () => {
    const { container } = renderWithPathname("/jobs/senior-developer");
    const current = Array.from(container.querySelectorAll("a")).filter(
      (l) => l.getAttribute("aria-current") === "page",
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/jobs");
  });

  it("marks no tab current on routes outside the tab set", () => {
    const { container } = renderWithPathname("/other");
    const current = Array.from(container.querySelectorAll("a")).filter(
      (l) => l.getAttribute("aria-current") === "page",
    );
    expect(current).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Touch targets
// ---------------------------------------------------------------------------
describe("MobileTabBar - touch targets", () => {
  it("every tab is at least 44x44 CSS px per its sizing utilities", () => {
    const { container } = renderWithPathname("/");
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(TABS.length);
    links.forEach((link) => {
      const className = link.className;
      const minHeight = className.match(/min-h-\[(\d+)px\]/);
      const minWidth = className.match(/min-w-\[(\d+)px\]/);
      expect(minHeight).not.toBeNull();
      expect(minWidth).not.toBeNull();
      expect(Number(minHeight![1])).toBeGreaterThanOrEqual(44);
      expect(Number(minWidth![1])).toBeGreaterThanOrEqual(44);
    });
  });
});

// ---------------------------------------------------------------------------
// Visible focus states
// ---------------------------------------------------------------------------
describe("MobileTabBar - focus visibility", () => {
  it("every tab has an explicit focus-visible indicator style", () => {
    const { container } = renderWithPathname("/");
    const links = container.querySelectorAll("a");
    links.forEach((link) => {
      const className = link.className;
      expect(className).toContain("focus-visible:outline");
      expect(className).toContain("focus-visible:outline-2");
      expect(className).toContain("focus-visible:outline-market-400");
      expect(className).toContain("focus-visible:outline-offset-[-2px]");
    });
  });
});

// ---------------------------------------------------------------------------
// Axe pass
// ---------------------------------------------------------------------------
describe("MobileTabBar - axe", () => {
  it.each(["/", "/jobs", "/dashboard", "/notifications", "/profile"])(
    "has no axe violations on %s",
    async (pathname) => {
      const { container } = renderWithPathname(pathname);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    },
  );

  it("has no axe violations with the notification badge visible", async () => {
    const { container } = renderWithPathname("/jobs", {
      initialUnreadCount: 7,
    });
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
