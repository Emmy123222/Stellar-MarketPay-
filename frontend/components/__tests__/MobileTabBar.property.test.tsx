/**
 * MobileTabBar.property.test.tsx
 *
 * Property-based tests for MobileTabBar using fast-check.
 * Each property runs 100 iterations.
 *
 * Feature: mobile-tab-bar
 */
import * as fc from "fast-check";
import { render, cleanup } from "@testing-library/react";
import MobileTabBar, { TABS } from "@/components/MobileTabBar";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("@/lib/api", () => ({
  fetchNotifications: jest.fn().mockResolvedValue({ unreadCount: 0 }),
  setJwtToken: jest.fn(),
  getJwtToken: jest.fn().mockReturnValue(null),
}));

// Override the global next/router mock (from jest.setup.tsx) with a jest.fn()
// so individual tests can control the returned pathname via mockReturnValue.
const mockUseRouter = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => mockUseRouter(),
}));

// Default router state shared across tests
function makeRouter(pathname: string) {
  return { pathname, push: jest.fn(), query: {}, isReady: true };
}

// ---------------------------------------------------------------------------
// Helper: render with a specific pathname
// ---------------------------------------------------------------------------
function renderWithPathname(pathname: string, extraProps: Record<string, unknown> = {}) {
  mockUseRouter.mockReturnValue(makeRouter(pathname));
  return render(<MobileTabBar publicKey={null} {...extraProps} />);
}

// Clean up DOM after every test to prevent leaks
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Property 1: Each tab renders icon, label, and aria-label
// Feature: mobile-tab-bar, Property 1: each tab renders icon, label, and aria-label
// Validates: Requirements 2.3, 6.2
// ---------------------------------------------------------------------------
describe("Property 1: Each tab renders icon, label, and aria-label", () => {
  it("every sampled tab has a link with the correct aria-label, an SVG icon, and visible text label", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TABS), (tab) => {
        // Render with non-matching pathname so no tab is active
        const { getByRole } = renderWithPathname("/other");

        const link = getByRole("link", { name: tab.ariaLabel });
        expect(link).toBeInTheDocument();

        // Icon: the link should contain an SVG element
        expect(link.querySelector("svg")).toBeInTheDocument();

        // Label: the link's text content should include the tab label
        expect(link).toHaveTextContent(tab.label);

        // Clean up between iterations to avoid duplicate element errors
        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Exactly one active tab per matching pathname
// Feature: mobile-tab-bar, Property 2: exactly one active tab for any matching pathname
// Validates: Requirements 3.1, 3.3, 6.3
// ---------------------------------------------------------------------------
describe("Property 2: Exactly one active tab per matching pathname", () => {
  it("exactly one link has aria-current=page and its href matches the pathname", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("/", "/jobs", "/dashboard", "/notifications", "/profile"),
        (pathname) => {
          const { getAllByRole } = renderWithPathname(pathname);

          const links = getAllByRole("link");
          const activeLinks = links.filter(
            (l) => l.getAttribute("aria-current") === "page",
          );

          expect(activeLinks).toHaveLength(1);
          expect(activeLinks[0]).toHaveAttribute("href", pathname);

          cleanup();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Badge displays numeric count for counts 1–99
// Feature: mobile-tab-bar, Property 3: badge shows numeric count for 1-99
// Validates: Requirements 4.1, 4.2, 4.3
// ---------------------------------------------------------------------------
describe("Property 3: Badge displays numeric count for counts 1–99", () => {
  it("badge text equals String(count) for any count between 1 and 99", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 }), (count) => {
        mockUseRouter.mockReturnValue(makeRouter("/"));

        const { getByText } = render(
          <MobileTabBar publicKey="GPUBKEY" initialUnreadCount={count} />,
        );

        expect(getByText(String(count))).toBeInTheDocument();

        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Badge displays "99+" for counts above 99
// Feature: mobile-tab-bar, Property 4: badge displays "99+" for counts above 99
// Validates: Requirements 4.4
// ---------------------------------------------------------------------------
describe('Property 4: Badge displays "99+" for counts above 99', () => {
  it('badge text is "99+" for any count greater than 99', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 10000 }), (count) => {
        mockUseRouter.mockReturnValue(makeRouter("/"));

        const { getByText } = render(
          <MobileTabBar publicKey="GPUBKEY" initialUnreadCount={count} />,
        );

        expect(getByText("99+")).toBeInTheDocument();

        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Badge cleared on navigation to /notifications
// Feature: mobile-tab-bar, Property 5: badge cleared on navigation to /notifications
// Validates: Requirements 4.5
// ---------------------------------------------------------------------------
describe("Property 5: Badge cleared on navigation to /notifications", () => {
  it("badge present before navigation to /notifications, absent after", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), (count) => {
        // Initial render on a non-notifications pathname
        mockUseRouter.mockReturnValue(makeRouter("/jobs"));

        const { queryByRole, rerender } = render(
          <MobileTabBar publicKey="GPUBKEY" initialUnreadCount={count} />,
        );

        // Badge should be present before navigating to /notifications
        expect(queryByRole("status")).toBeInTheDocument();

        // Simulate navigation to /notifications
        mockUseRouter.mockReturnValue(makeRouter("/notifications"));
        rerender(<MobileTabBar publicKey="GPUBKEY" initialUnreadCount={count} />);

        // Badge should be cleared
        expect(queryByRole("status")).not.toBeInTheDocument();

        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: sr-only badge text present for positive counts
// Feature: mobile-tab-bar, Property 6: sr-only text present when badge count is positive
// Validates: Requirements 6.4
// ---------------------------------------------------------------------------
describe("Property 6: sr-only badge text present when count is positive", () => {
  it("a .sr-only element exists and its text matches the count or 99+", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), (count) => {
        mockUseRouter.mockReturnValue(makeRouter("/"));

        const { container } = render(
          <MobileTabBar publicKey="GPUBKEY" initialUnreadCount={count} />,
        );

        const srOnly = container.querySelector(".sr-only");
        expect(srOnly).toBeInTheDocument();
        expect(srOnly?.textContent).toMatch(/\d+|99\+/);

        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});
