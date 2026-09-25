import React from "react";
import { render, screen } from "@testing-library/react";
import InsightsChart, { InsightsChartSkeleton } from "@/components/InsightsChart";

describe("InsightsChart (#1407)", () => {
  const mockCategories = [
    { category: "Smart Contracts", jobCount: 25, avgBudgetXLM: 500, filledCount: 15, avgDaysToFill: 3 },
    { category: "Frontend Development", jobCount: 40, avgBudgetXLM: 400, filledCount: 30, avgDaysToFill: 2 },
    { category: "Backend Development", jobCount: 15, avgBudgetXLM: 600, filledCount: 10, avgDaysToFill: 4 },
  ];

  it("renders a skeleton loader placeholder when loading is true", () => {
    render(<InsightsChart loading={true} categories={mockCategories} />);

    expect(screen.getByTestId("insights-chart-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("insights-chart")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Loading chart data")).toBeInTheDocument();
  });

  it("renders the loaded chart when loading is false", () => {
    render(<InsightsChart loading={false} categories={mockCategories} />);

    expect(screen.getByTestId("insights-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("insights-chart-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText("Jobs by Category")).toBeInTheDocument();
    expect(screen.getByText("Smart")).toBeInTheDocument();
    expect(screen.getByText("Frontend")).toBeInTheDocument();
  });

  it("InsightsChartSkeleton renders approximate shape of the chart", () => {
    render(<InsightsChartSkeleton />);

    const skeleton = screen.getByTestId("insights-chart-skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveClass("animate-pulse");
  });
});
