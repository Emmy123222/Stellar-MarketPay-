/**
 * __tests__/JobFiltersPanel.url-sync.test.tsx
 * Tests for Issue #1408: Job filter state synced to URL query string.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import JobFiltersPanel, {
  ActiveFilterChips,
  buildActiveFilterChips,
  type JobFilterQuery,
} from "@/components/JobFiltersPanel";

const mockPush = jest.fn();
let mockRouterQuery: Record<string, any> = {};

jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/jobs",
    query: mockRouterQuery,
    push: mockPush,
    isReady: true,
  }),
}));

jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "jobs.search": "Search",
        "jobs.searchPlaceholder": "Search jobs...",
        "jobs.budgetRange": "Budget Range",
        "jobs.minBudget": "Min",
        "jobs.maxBudget": "Max",
        "jobs.skills": "Skills",
        "jobs.skillsPlaceholder": "e.g. React, Rust",
        "jobs.clientRating": "Client Rating",
        "jobs.duration": "Project Duration",
        "jobs.durationShort": "< 1 month",
        "jobs.durationMedium": "1–3 months",
        "jobs.durationLong": "3+ months",
        "jobs.posted": "Posted",
        "jobs.postedToday": "Past 24 hours",
        "jobs.postedWeek": "Past week",
        "jobs.postedMonth": "Past month",
        "jobs.applications": "Applications",
        "jobs.lowCompetition": "Low competition (< 5 proposals)",
        "jobs.clearAll": "Clear all filters",
        "jobs.activeFilters": "Active filters",
      };
      return map[key] || key;
    },
  }),
}));

describe("JobFiltersPanel - URL Query String Sync (#1408)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouterQuery = {};
  });

  it("pre-fills filter inputs from router query parameters", () => {
    mockRouterQuery = {
      search: "solana",
      min_budget: "100",
      max_budget: "500",
      skills: "react,rust",
      min_client_rating: "4",
      duration: "medium",
      posted_since: "week",
      max_applications: "5",
    };

    render(<JobFiltersPanel collapsible={false} />);

    expect(screen.getByPlaceholderText("Search jobs...")).toHaveValue("solana");
    expect(screen.getByPlaceholderText("Min")).toHaveValue(100);
    expect(screen.getByPlaceholderText("Max")).toHaveValue(500);
    expect(screen.getByPlaceholderText("e.g. React, Rust")).toHaveValue("react,rust");
    expect(screen.getByDisplayValue("4.0+")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1–3 months")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Past week")).toBeInTheDocument();
  });

  it("updates URL query parameters when filters change via default router sync", () => {
    mockRouterQuery = {};
    render(<JobFiltersPanel collapsible={false} />);

    const minBudgetInput = screen.getByPlaceholderText("Min");
    fireEvent.change(minBudgetInput, { target: { value: "150" } });

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/jobs",
        query: expect.objectContaining({ minBudget: "150" }),
      }),
      undefined,
      { shallow: true }
    );
  });

  it("syncs skill selection chip clicks to router query", () => {
    mockRouterQuery = { skills: "React" };
    render(<JobFiltersPanel collapsible={false} />);

    const rustButton = screen.getByRole("button", { name: "Rust" });
    fireEvent.click(rustButton);

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/jobs",
        query: expect.objectContaining({ skills: "React,Rust" }),
      }),
      undefined,
      { shallow: true }
    );
  });

  it("clears all filters including snake_case and camelCase query aliases", () => {
    mockRouterQuery = {
      skills: "react",
      min_budget: "100",
      max_budget: "500",
      posted_since: "today",
    };

    render(<JobFiltersPanel collapsible={false} />);

    const clearButton = screen.getByText("Clear all filters");
    fireEvent.click(clearButton);

    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/jobs",
        query: {},
      }),
      undefined,
      { shallow: true }
    );
  });

  it("renders ActiveFilterChips and calls onRemove when a chip is dismissed", () => {
    const query: JobFilterQuery = {
      skills: "react,rust",
      min_budget: "100",
      max_budget: "500",
      min_client_rating: "4",
      duration: "short",
      posted_since: "today",
      max_applications: "5",
    };

    const handleRemove = jest.fn();
    render(<ActiveFilterChips query={query} onRemove={handleRemove} />);

    expect(screen.getByText(/Skills: react,rust/i)).toBeInTheDocument();
    expect(screen.getByText(/Budget Range: 100 – 500/i)).toBeInTheDocument();
    expect(screen.getByText(/Client Rating: 4\+/i)).toBeInTheDocument();

    const skillsChip = screen.getByText(/Skills: react,rust/i);
    fireEvent.click(skillsChip);

    expect(handleRemove).toHaveBeenCalledWith(["skills"]);
  });

  it("buildActiveFilterChips supports both camelCase and snake_case keys", () => {
    const labels = {
      search: "Search",
      budget: "Budget",
      skills: "Skills",
      rating: "Rating",
      applications: "Apps",
      duration_short: "Short",
      duration_medium: "Medium",
      duration_long: "Long",
      posted_today: "Today",
      posted_week: "Week",
      posted_month: "Month",
    };

    const snakeChips = buildActiveFilterChips(
      { min_budget: "50", max_budget: "200", min_client_rating: "4.5", posted_since: "today" },
      labels
    );
    expect(snakeChips.map((c) => c.key)).toEqual(["budget", "rating", "posted"]);

    const camelChips = buildActiveFilterChips(
      { minBudget: "50", maxBudget: "200", minClientRating: "4.5", postedSince: "today" },
      labels
    );
    expect(camelChips.map((c) => c.key)).toEqual(["budget", "rating", "posted"]);
  });
});
