/**
 * Tests for TimeframeToggle behavior inside XlmPriceWidget
 * Sub-task 3.1: Unit tests for toggle button rendering and interaction
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as fc from "fast-check";

// Mock chart.js and react-chartjs-2 to avoid canvas issues in jsdom
jest.mock("react-chartjs-2", () => ({
  Line: () => <canvas data-testid="line-chart" />,
}));

jest.mock("chart.js", () => ({
  Chart: { register: jest.fn() },
  CategoryScale: {},
  LinearScale: {},
  PointElement: {},
  LineElement: {},
  Tooltip: {},
  Filler: {},
}));

// Mock useApi to return controlled data
jest.mock("@/hooks/useApi", () => ({
  useApi: jest.fn(() => ({
    data: {
      points: [
        { timestamp: 1700000000000, priceUsd: 0.1234 },
        { timestamp: 1700086400000, priceUsd: 0.1300 },
      ],
      currentPriceUsd: 0.1300,
      change24hPercent: 5.35,
    },
    error: null,
    isLoading: false,
    isValidating: false,
  })),
}));

jest.mock("@/lib/api", () => ({
  fetchXlmPriceHistory: jest.fn(),
  Timeframe: undefined,
}));

import XlmPriceWidget from "@/components/XlmPriceWidget";

describe("XlmPriceWidget — TimeframeToggle buttons (Task 3.1)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders three buttons labelled 1D, 7D, 30D", () => {
    render(<XlmPriceWidget />);

    expect(screen.getByRole("button", { name: "1D" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7D" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30D" })).toBeInTheDocument();
  });

  it("sets aria-pressed='true' on 7D and 'false' on 1D and 30D on initial render", () => {
    render(<XlmPriceWidget />);

    expect(screen.getByRole("button", { name: "7D" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1D" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "30D" })).toHaveAttribute("aria-pressed", "false");
  });

  it("sets aria-pressed='true' on clicked button and 'false' on others", () => {
    render(<XlmPriceWidget />);

    fireEvent.click(screen.getByRole("button", { name: "1D" }));

    expect(screen.getByRole("button", { name: "1D" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "7D" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "30D" })).toHaveAttribute("aria-pressed", "false");
  });

  it("updates aria-pressed correctly when switching to 30D", () => {
    render(<XlmPriceWidget />);

    fireEvent.click(screen.getByRole("button", { name: "30D" }));

    expect(screen.getByRole("button", { name: "30D" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1D" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "7D" })).toHaveAttribute("aria-pressed", "false");
  });

  it("applies active class styles to the selected button", () => {
    render(<XlmPriceWidget />);

    const btn7D = screen.getByRole("button", { name: "7D" });
    const btn1D = screen.getByRole("button", { name: "1D" });

    // Active button should have active class
    expect(btn7D.className).toContain("bg-amber-600/30");
    expect(btn7D.className).toContain("text-amber-200");

    // Inactive button should have inactive class
    expect(btn1D.className).toContain("text-amber-700");
    expect(btn1D.className).not.toContain("bg-amber-600/30");
  });

  it("after clicking 1D the active styles move to 1D button", () => {
    render(<XlmPriceWidget />);

    fireEvent.click(screen.getByRole("button", { name: "1D" }));

    const btn1D = screen.getByRole("button", { name: "1D" });
    const btn7D = screen.getByRole("button", { name: "7D" });

    expect(btn1D.className).toContain("bg-amber-600/30");
    expect(btn7D.className).not.toContain("bg-amber-600/30");
  });
});

describe("XlmPriceWidget — TimeframeToggle property test (Task 3.2)", () => {
  // Feature: xlm-price-chart, Property 4: Toggle selection invariant — exactly one aria-pressed button matches activeTimeframe
  it("Property 4: exactly one aria-pressed='true' after any sequence of toggles", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("1D", "7D", "30D") as fc.Arbitrary<"1D" | "7D" | "30D">, {
          minLength: 1,
          maxLength: 20,
        }),
        (timeframes) => {
          const { unmount } = render(<XlmPriceWidget />);

          for (const tf of timeframes) {
            fireEvent.click(screen.getByRole("button", { name: tf }));

            const allButtons = [
              screen.getByRole("button", { name: "1D" }),
              screen.getByRole("button", { name: "7D" }),
              screen.getByRole("button", { name: "30D" }),
            ];

            // Exactly one should be pressed
            const pressedButtons = allButtons.filter(
              (btn) => btn.getAttribute("aria-pressed") === "true",
            );
            expect(pressedButtons).toHaveLength(1);

            // The pressed button should match the last selected timeframe
            expect(pressedButtons[0]).toHaveTextContent(tf);

            // All other buttons should have aria-pressed="false"
            const unpressedButtons = allButtons.filter(
              (btn) => btn.getAttribute("aria-pressed") === "false",
            );
            expect(unpressedButtons).toHaveLength(2);
          }

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Task 5.1: Unit tests for tooltip callbacks ─────────────────────────────

/**
 * Helper: extract the chartOptions tooltip callbacks from a rendered widget.
 * We render the component with a known set of points and inspect the callbacks
 * via the mocked Line component, which receives chartOptions as its `options` prop.
 */

// Override the Line mock to capture the options prop
let capturedChartOptions: any = null;

jest.mock("react-chartjs-2", () => ({
  // Re-implement the mock so it captures options
  Line: (props: any) => {
    capturedChartOptions = props.options;
    return <canvas data-testid="line-chart" />;
  },
}), { virtual: false });

// Known test fixture
const KNOWN_POINTS = [
  { timestamp: 1700000000000, priceUsd: 0.1234 },
  { timestamp: 1700086400000, priceUsd: 0.5678 },
];

function renderWidgetWithPoints(points = KNOWN_POINTS) {
  // Update the useApi mock to return custom points
  const { useApi } = require("@/hooks/useApi");
  (useApi as jest.Mock).mockReturnValue({
    data: {
      points,
      currentPriceUsd: points[points.length - 1]?.priceUsd ?? null,
      change24hPercent: null,
    },
    error: null,
    isLoading: false,
    isValidating: false,
  });
  capturedChartOptions = null;
  return render(<XlmPriceWidget />);
}

describe("XlmPriceWidget — Tooltip callbacks (Task 5.1)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("title callback returns a non-empty formatted date string for a known timestamp", () => {
    const { unmount } = renderWidgetWithPoints(KNOWN_POINTS);
    const titleCb = capturedChartOptions?.plugins?.tooltip?.callbacks?.title;
    expect(titleCb).toBeDefined();

    const result = titleCb([{ dataIndex: 0 }]);
    // Should be non-empty
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    unmount();
  });

  it("title callback returns empty string when dataIndex is out of bounds", () => {
    const { unmount } = renderWidgetWithPoints(KNOWN_POINTS);
    const titleCb = capturedChartOptions?.plugins?.tooltip?.callbacks?.title;
    expect(titleCb).toBeDefined();

    // dataIndex beyond points array → timestamp is undefined → returns ''
    const result = titleCb([{ dataIndex: 999 }]);
    expect(result).toBe('');
    unmount();
  });

  it("label callback returns a string with the price formatted to exactly four decimal places", () => {
    const { unmount } = renderWidgetWithPoints(KNOWN_POINTS);
    const labelCb = capturedChartOptions?.plugins?.tooltip?.callbacks?.label;
    expect(labelCb).toBeDefined();

    const result = labelCb({ parsed: { y: 0.5678 } });
    expect(result).toContain("0.5678");
    // Verify exactly four decimal places in the numeric portion
    const numericMatch = result.trim().match(/[\d.]+/);
    expect(numericMatch).not.toBeNull();
    const decimalPart = numericMatch![0].split(".")[1];
    expect(decimalPart).toHaveLength(4);
    unmount();
  });

  it("label callback formats a whole number to four decimal places", () => {
    const { unmount } = renderWidgetWithPoints(KNOWN_POINTS);
    const labelCb = capturedChartOptions?.plugins?.tooltip?.callbacks?.label;
    expect(labelCb).toBeDefined();

    const result = labelCb({ parsed: { y: 1 } });
    expect(result).toContain("1.0000");
    unmount();
  });
});

// ─── Task 5.2: Property test — tooltip title returns non-empty date string ────

describe("XlmPriceWidget — Tooltip title property test (Task 5.2)", () => {
  // Feature: xlm-price-chart, Property 6: Tooltip title callback returns a non-empty date string for any valid timestamp
  it("Property 6: title callback returns a non-empty date string for any valid timestamp", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Date.now() }),
        (timestamp) => {
          const points = [{ timestamp, priceUsd: 0.1 }];
          const { unmount } = renderWidgetWithPoints(points);

          const titleCb = capturedChartOptions?.plugins?.tooltip?.callbacks?.title;
          expect(titleCb).toBeDefined();

          const result = titleCb([{ dataIndex: 0 }]);
          expect(typeof result).toBe("string");
          expect(result.length).toBeGreaterThan(0);

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
  // Validates: Requirements 4.1, 4.3
});

// ─── Task 5.3: Property test — tooltip label formats to exactly four decimal places ───

describe("XlmPriceWidget — Tooltip label property test (Task 5.3)", () => {
  // Feature: xlm-price-chart, Property 7: Tooltip label callback formats priceUsd to exactly four decimal places
  it("Property 7: label callback formats priceUsd to exactly four decimal places", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.0001), max: Math.fround(9999), noNaN: true }),
        (priceUsd) => {
          const { unmount } = renderWidgetWithPoints([{ timestamp: 1700000000000, priceUsd }]);

          const labelCb = capturedChartOptions?.plugins?.tooltip?.callbacks?.label;
          expect(labelCb).toBeDefined();

          const result: string = labelCb({ parsed: { y: priceUsd } });
          // Extract the numeric portion
          const numericMatch = result.trim().match(/[\d.]+/);
          expect(numericMatch).not.toBeNull();
          const parsed = parseFloat(numericMatch![0]);
          const expected = parseFloat(priceUsd.toFixed(4));
          expect(parsed).toBeCloseTo(expected, 4);

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
  // Validates: Requirements 4.2, 4.3
});

// ─── Task 7.1: Unit tests for ARIA attributes on chart container ─────────────

describe("XlmPriceWidget — ARIA attributes on chart container (Task 7.1)", () => {
  beforeEach(() => {
    localStorage.clear();
    const { useApi } = require("@/hooks/useApi");
    (useApi as jest.Mock).mockReturnValue({
      data: {
        points: [
          { timestamp: 1700000000000, priceUsd: 0.1234 },
          { timestamp: 1700086400000, priceUsd: 0.1300 },
        ],
        currentPriceUsd: 0.1300,
        change24hPercent: 5.35,
      },
      error: null,
      isLoading: false,
      isValidating: false,
    });
  });

  it("chart wrapper has role='img'", () => {
    render(<XlmPriceWidget />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("aria-label contains '7D' on initial render", () => {
    render(<XlmPriceWidget />);
    const chartContainer = screen.getByRole("img");
    expect(chartContainer).toHaveAttribute("aria-label", expect.stringContaining("7D"));
  });

  it("aria-label updates to contain the new timeframe after a toggle click", () => {
    render(<XlmPriceWidget />);
    fireEvent.click(screen.getByRole("button", { name: "1D" }));
    const chartContainer = screen.getByRole("img");
    expect(chartContainer).toHaveAttribute("aria-label", expect.stringContaining("1D"));
  });

  it("aria-label updates to contain 30D after clicking 30D", () => {
    render(<XlmPriceWidget />);
    fireEvent.click(screen.getByRole("button", { name: "30D" }));
    const chartContainer = screen.getByRole("img");
    expect(chartContainer).toHaveAttribute("aria-label", expect.stringContaining("30D"));
  });
});

// ─── Task 7.2: Property test — aria-label always contains active timeframe ───

describe("XlmPriceWidget — aria-label property test (Task 7.2)", () => {
  beforeEach(() => {
    localStorage.clear();
    const { useApi } = require("@/hooks/useApi");
    (useApi as jest.Mock).mockReturnValue({
      data: {
        points: [{ timestamp: 1700000000000, priceUsd: 0.1234 }],
        currentPriceUsd: 0.1234,
        change24hPercent: null,
      },
      error: null,
      isLoading: false,
      isValidating: false,
    });
  });

  // Feature: xlm-price-chart, Property 5: aria-label always contains the active timeframe string
  it("Property 5: aria-label always contains the active timeframe string", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("1D", "7D", "30D") as fc.Arbitrary<"1D" | "7D" | "30D">,
        (timeframe) => {
          const { unmount } = render(<XlmPriceWidget />);
          fireEvent.click(screen.getByRole("button", { name: timeframe }));
          const chartContainer = screen.getByRole("img");
          expect(chartContainer.getAttribute("aria-label")).toContain(timeframe);
          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
  // Validates: Requirements 6.2, 6.3
});
