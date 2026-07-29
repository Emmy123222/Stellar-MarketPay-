/**
 * components/EarningsChart.tsx
 * Issue #495 — Earnings analytics for the freelancer dashboard.
 *
 * - Monthly bar chart (last 12 months) using recharts
 * - Breakdown by job category (pie chart)
 * - Average earnings per job stat
 * - Export data as CSV
 */
import { useEffect, useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { fetchFreelancerEarnings, type EarningsData, type EarningPayment } from "@/lib/api";
import { formatXLM } from "@/utils/format";

const PIE_COLORS = [
  "#f59e0b", "#3b82f6", "#10b981", "#f43f5e",
  "#a855f7", "#06b6d4", "#84cc16", "#f97316",
];

interface Props {
  publicKey: string;
}

/**
 * Builds the last 12 calendar months, each bucket holding only the earnings
 * *released in that specific month* (per-period) — Issue #858. Exported so
 * the transformation itself is independently unit-testable rather than only
 * observable through a full component render.
 */
export function buildMonthlyData(payments: EarningPayment[]): { month: string; total: number }[] {
  const now = new Date();
  const months: { month: string; total: number }[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("default", { month: "short", year: "2-digit" });
    months.push({ month: label, total: 0, _key: key } as { month: string; total: number; _key: string });
  }

  for (const p of payments) {
    const date = new Date(p.releasedAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const entry = (months as Array<{ month: string; total: number; _key: string }>).find((m) => m._key === key);
    if (entry) entry.total += parseFloat(p.amountXlm) || 0;
  }

  return months;
}

/**
 * Running-total view of the same 12 months — Issue #858's "cumulative"
 * toggle option. Each month's `total` is the sum of every per-period amount
 * up to and including that month, so the series is monotonically
 * non-decreasing (unlike `buildMonthlyData`, which resets each month).
 */
export function buildCumulativeMonthlyData(
  payments: EarningPayment[],
): { month: string; total: number }[] {
  const perPeriod = buildMonthlyData(payments);
  let running = 0;
  return perPeriod.map((m) => {
    running += m.total;
    return { month: m.month, total: running };
  });
}

function buildCategoryData(payments: EarningPayment[]): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const p of payments) {
    // jobTitle used as category proxy since EarningPayment doesn't carry category
    const cat = p.jobTitle || "Other";
    map.set(cat, (map.get(cat) || 0) + (parseFloat(p.amountXlm) || 0));
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function exportCSV(payments: EarningPayment[]) {
  const header = "Job Title,Amount XLM,Client,Released At";
  const rows = payments.map((p) =>
    [p.jobTitle, p.amountXlm, p.clientAddress, p.releasedAt].join(",")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "earnings.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function EarningsChart({ publicKey }: Props) {
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"per-period" | "cumulative">("per-period");

  useEffect(() => {
    setLoading(true);
    fetchFreelancerEarnings(publicKey)
      .then(setData)
      .catch(() => setError("Failed to load earnings data."))
      .finally(() => setLoading(false));
  }, [publicKey]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="card animate-pulse h-24" />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card text-center py-16">
        <p className="text-amber-700 text-sm">{error || "No earnings data available."}</p>
      </div>
    );
  }

  const monthlyData =
    viewMode === "cumulative" ? buildCumulativeMonthlyData(data.payments) : buildMonthlyData(data.payments);
  const categoryData = buildCategoryData(data.payments);
  const totalXlm = parseFloat(data.totalXlm) || 0;
  const avgPerJob = data.payments.length > 0 ? totalXlm / data.payments.length : 0;

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-xs text-amber-700">Total Earned</p>
          <p className="font-display text-2xl text-market-300 mt-1">{formatXLM(totalXlm)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-amber-700">Avg Earnings / Job</p>
          <p className="font-display text-2xl text-amber-100 mt-1">{formatXLM(avgPerJob)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-amber-700">Completed Jobs</p>
          <p className="font-display text-2xl text-amber-100 mt-1">{data.payments.length}</p>
        </div>
      </div>

      {/* Monthly bar chart */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <p className="font-display text-lg text-amber-100">
            {viewMode === "cumulative" ? "Cumulative Earnings" : "Monthly Earnings"} (Last 12 Months)
          </p>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-amber-900/30 overflow-hidden text-xs" role="group" aria-label="Chart view mode">
              <button
                onClick={() => setViewMode("per-period")}
                aria-pressed={viewMode === "per-period"}
                className={`px-3 py-1.5 transition-colors ${
                  viewMode === "per-period" ? "bg-market-300 text-black" : "text-amber-700 hover:text-amber-100"
                }`}
              >
                Per-period
              </button>
              <button
                onClick={() => setViewMode("cumulative")}
                aria-pressed={viewMode === "cumulative"}
                className={`px-3 py-1.5 transition-colors ${
                  viewMode === "cumulative" ? "bg-market-300 text-black" : "text-amber-700 hover:text-amber-100"
                }`}
              >
                Cumulative
              </button>
            </div>
            <button
              onClick={() => exportCSV(data.payments)}
              className="btn-secondary text-xs px-3 py-1.5"
              aria-label="Export earnings data as CSV"
            >
              Export CSV
            </button>
          </div>
        </div>
        {monthlyData.every((m) => m.total === 0) ? (
          <p className="text-sm text-amber-800 text-center py-8">No payments in the last 12 months.</p>
        ) : (
          <div role="img" aria-label="Line chart showing freelancer revenue over time" className="w-full h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <XAxis dataKey="month" tick={{ fill: "#a8956a", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#a8956a", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}`} />
                <Tooltip
                  contentStyle={{ background: "#1a1610", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 8, color: "#fef3c7", fontSize: 12 }}
                  formatter={(value) => [
                    `${Number(value).toFixed(2)} XLM`,
                    viewMode === "cumulative" ? "Cumulative" : "Earned",
                  ]}
                />
                <Line type="monotone" dataKey="total" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: "#f59e0b" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Category breakdown pie */}
      {categoryData.length > 0 && (
        <div className="card">
          <p className="font-display text-lg text-amber-100 mb-4">Earnings by Job</p>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* Issue #859: a fixed 200x200 ResponsiveContainer doesn't
                actually resize — it's the same pixel size on every screen.
                Sizing the wrapper instead (smaller on mobile) and letting
                the container fill it (100%) makes the chart genuinely
                responsive. */}
            <div className="w-[160px] h-[160px] sm:w-[200px] sm:h-[200px] flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="value"
                    paddingAngle={3}
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#1a1610", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 8, color: "#fef3c7", fontSize: 12 }}
                    formatter={(value) => [`${Number(value).toFixed(2)} XLM`]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2 min-w-0">
              {categoryData.map((item, i) => (
                <div key={item.name} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-xs text-amber-100 truncate">{item.name}</span>
                  </div>
                  <span className="text-xs text-market-300 font-medium flex-shrink-0">{item.value.toFixed(2)} XLM</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
