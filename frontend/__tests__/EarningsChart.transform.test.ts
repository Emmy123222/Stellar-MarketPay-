/**
 * __tests__/EarningsChart.transform.test.ts
 * Issue #858 — Unit tests for EarningsChart's chart data transformation.
 * Guards against the reported regression (every month showing the grand
 * total instead of that month's own earnings) and covers the new
 * cumulative-view transform.
 */
import { buildMonthlyData, buildCumulativeMonthlyData } from "@/components/EarningsChart";
import type { EarningPayment } from "@/lib/api";

function payment(amountXlm: string, monthsAgo: number): EarningPayment {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 15);
  return {
    id: `p-${monthsAgo}-${amountXlm}`,
    jobId: `job-${monthsAgo}`,
    jobTitle: "Job",
    amountXlm,
    releasedAt: d.toISOString(),
    clientAddress: "GCLIENT",
  };
}

describe("EarningsChart data transformation (#858)", () => {
  it("attributes each payment to its own month, not the grand total, across all months", () => {
    // Reproduces the issue's exact repro: 3 jobs completed in 3 different
    // months. Every month must show only its own amount.
    const payments = [payment("100", 2), payment("200", 1), payment("150", 0)];
    const result = buildMonthlyData(payments);

    const nonZero = result.filter((m) => m.total !== 0);
    expect(nonZero).toHaveLength(3);
    expect(nonZero.map((m) => m.total)).toEqual([100, 200, 150]);

    // The specific regression this issue reported: no month should show the
    // combined total of all payments.
    const grandTotal = 100 + 200 + 150;
    for (const m of result) {
      expect(m.total).not.toBe(grandTotal);
    }
  });

  it("sums multiple payments released within the same month", () => {
    const payments = [payment("100", 0), payment("50", 0)];
    const result = buildMonthlyData(payments);
    const thisMonth = result[result.length - 1];
    expect(thisMonth.total).toBe(150);
  });

  it("returns 12 zeroed months when there are no payments", () => {
    const result = buildMonthlyData([]);
    expect(result).toHaveLength(12);
    expect(result.every((m) => m.total === 0)).toBe(true);
  });

  it("ignores payments released more than 12 months ago", () => {
    const payments = [payment("999", 20)];
    const result = buildMonthlyData(payments);
    expect(result.every((m) => m.total === 0)).toBe(true);
  });

  describe("buildCumulativeMonthlyData", () => {
    it("produces a running total that accumulates across months", () => {
      const payments = [payment("100", 2), payment("200", 1), payment("150", 0)];
      const result = buildCumulativeMonthlyData(payments);

      const last3 = result.slice(-3).map((m) => m.total);
      expect(last3).toEqual([100, 300, 450]);
    });

    it("is monotonically non-decreasing", () => {
      const payments = [payment("100", 3), payment("50", 1)];
      const result = buildCumulativeMonthlyData(payments);

      for (let i = 1; i < result.length; i++) {
        expect(result[i].total).toBeGreaterThanOrEqual(result[i - 1].total);
      }
    });

    it("matches the sum of all per-period payments in the final month", () => {
      const payments = [payment("100", 2), payment("200", 1), payment("150", 0)];
      const cumulative = buildCumulativeMonthlyData(payments);
      const perPeriod = buildMonthlyData(payments);

      const expectedTotal = perPeriod.reduce((sum, m) => sum + m.total, 0);
      expect(cumulative[cumulative.length - 1].total).toBe(expectedTotal);
    });
  });
});
