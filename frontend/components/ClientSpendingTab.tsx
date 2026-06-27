/**
 * components/ClientSpendingTab.tsx
 * Issue #497 — Client spending analytics tab in dashboard.
 *
 * - Cumulative spend by month (bar chart)
 * - Top 3 freelancers by payment received
 * - Budget utilization gauge (spent vs budgeted)
 * - Date range picker to filter data
 */
import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatXLM, formatUSDEquivalent, shortenAddress } from "@/utils/format";
import { SPENDING_STATUS_LABELS, SPENDING_STATUS_ORDER } from "@/constants/spending";
import type { ClientSpendingAnalytics, ClientSpendingMonthly } from "@/utils/types";

type Props = {
  analytics: ClientSpendingAnalytics | null;
  loading: boolean;
  xlmPriceUsd: number | null;
};

function parseAmount(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Build last-12-month skeleton and fill in any monthly data provided by the API. */
function buildMonthlyData(monthly?: ClientSpendingMonthly[]): { month: string; total: number }[] {
  const now = new Date();
  const months: { month: string; total: number; _key: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ month: d.toLocaleString("default", { month: "short", year: "2-digit" }), total: 0, _key: key });
  }
  if (monthly) {
    for (const m of monthly) {
      const entry = months.find((x) => x._key === m.month);
      if (entry) entry.total = m.totalSpentXlm;
    }
  }
  return months;
}

/** Radial-style gauge rendered with SVG — shows % of budget spent. */
function UtilizationGauge({ pct }: { pct: number }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const r = 40;
  const circumference = Math.PI * r; // half-circle
  const dash = (clamped / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="100" height="56" viewBox="0 0 100 56" aria-label={`${clamped.toFixed(0)}% budget utilization`}>
        {/* Track */}
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(245,158,11,0.12)" strokeWidth="10" strokeLinecap="round" />
        {/* Fill */}
        <path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          stroke={clamped > 90 ? "#f43f5e" : clamped > 70 ? "#f59e0b" : "#10b981"}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        <text x="50" y="48" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#fef3c7">
          {clamped.toFixed(0)}%
        </text>
      </svg>
      <p className="text-xs text-amber-700 -mt-1">Budget Utilization</p>
    </div>
  );
}

export default function ClientSpendingTab({ analytics, loading, xlmPriceUsd }: Props) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filteredMonthly = useMemo(() => {
    const raw = buildMonthlyData(analytics?.monthly);
    if (!fromDate && !toDate) return raw;
    // Filter by _key which is YYYY-MM
    return (raw as Array<{ month: string; total: number; _key?: string }>).filter((m) => {
      const key = (m as any)._key as string | undefined;
      if (!key) return true;
      if (fromDate && key < fromDate.slice(0, 7)) return false;
      if (toDate && key > toDate.slice(0, 7)) return false;
      return true;
    });
  }, [analytics?.monthly, fromDate, toDate]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="card animate-pulse h-20" />)}
      </div>
    );
  }

  if (!analytics || !analytics.hasCompletedJobs) {
    return (
      <div className="card text-center py-16">
        <p className="font-display text-xl text-amber-100 mb-2">No completed jobs yet</p>
        <p className="text-amber-800 text-sm">Spending insights will appear after your first completed escrow payout.</p>
      </div>
    );
  }

  const totalSpentNumber = parseAmount(analytics.totalSpentXlm);
  const totalBudgetNumber = analytics.totalBudgetXlm
    ? parseAmount(analytics.totalBudgetXlm)
    : parseAmount(analytics.averageBudgetXlm) * analytics.jobsBreakdown.posted;
  const utilizationPct = totalBudgetNumber > 0 ? (totalSpentNumber / totalBudgetNumber) * 100 : 0;
  const averageBudgetNumber = parseAmount(analytics.averageBudgetXlm);
  const averagePaidNumber = parseAmount(analytics.averagePaidXlm);
  const maxStatusCount = Math.max(
    ...SPENDING_STATUS_ORDER.map((status) => analytics.jobsBreakdown[status]),
    1,
  );
  const top3Freelancers = analytics.topFreelancers.slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <p className="text-xs text-amber-700">Total Spent</p>
          <p className="font-display text-2xl text-market-300 mt-1">{formatXLM(totalSpentNumber)}</p>
          <p className="text-xs text-amber-800 mt-1">{formatUSDEquivalent(totalSpentNumber, xlmPriceUsd) || "USD price unavailable"}</p>
        </div>
        <div className="card">
          <p className="text-xs text-amber-700">Jobs Posted</p>
          <p className="font-display text-2xl text-amber-100 mt-1">{analytics.jobsBreakdown.posted}</p>
        </div>
        <div className="card">
          <p className="text-xs text-amber-700">Avg Budget</p>
          <p className="font-display text-2xl text-amber-100 mt-1">{formatXLM(averageBudgetNumber)}</p>
        </div>
        <div className="card flex items-center justify-center">
          <UtilizationGauge pct={utilizationPct} />
        </div>
      </div>

      {/* Monthly cumulative spend chart */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <p className="font-display text-lg text-amber-100">Monthly Spend</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-amber-700">From</label>
            <input
              type="month"
              value={fromDate ? fromDate.slice(0, 7) : ""}
              onChange={(e) => setFromDate(e.target.value ? `${e.target.value}-01` : "")}
              className="rounded-lg border border-market-500/20 bg-ink-700 px-2 py-1 text-xs text-amber-100 focus:outline-none focus:ring-1 focus:ring-market-400/40"
              aria-label="From month"
            />
            <label className="text-xs text-amber-700">To</label>
            <input
              type="month"
              value={toDate ? toDate.slice(0, 7) : ""}
              onChange={(e) => setToDate(e.target.value ? `${e.target.value}-01` : "")}
              className="rounded-lg border border-market-500/20 bg-ink-700 px-2 py-1 text-xs text-amber-100 focus:outline-none focus:ring-1 focus:ring-market-400/40"
              aria-label="To month"
            />
            {(fromDate || toDate) && (
              <button
                onClick={() => { setFromDate(""); setToDate(""); }}
                className="text-xs text-amber-700 hover:text-amber-400 underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {filteredMonthly.every((m) => m.total === 0) ? (
          <p className="text-sm text-amber-800 text-center py-8">No spend data for selected period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={filteredMonthly} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <XAxis dataKey="month" tick={{ fill: "#a8956a", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#a8956a", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#1a1610", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 8, color: "#fef3c7", fontSize: 12 }}
                formatter={(value: number) => [`${value.toFixed(2)} XLM`, "Spent"]}
                cursor={{ fill: "rgba(245,158,11,0.06)" }}
              />
              <Bar dataKey="total" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Jobs by status */}
        <div className="card space-y-4">
          <p className="font-display text-lg text-amber-100">Jobs by Status</p>
          {SPENDING_STATUS_ORDER.map((status) => {
            const value = analytics.jobsBreakdown[status];
            const width = (value / maxStatusCount) * 100;
            return (
              <div key={status}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-amber-700">{SPENDING_STATUS_LABELS[status]}</span>
                  <span className="text-amber-100">{value}</span>
                </div>
                <div className="w-full h-2 rounded bg-ink-900/60">
                  <div className="h-2 rounded bg-market-500/80" style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Budget vs Actual */}
        <div className="card space-y-4">
          <p className="font-display text-lg text-amber-100">Budget vs Actual Paid</p>
          <div className="space-y-3">
            {[
              { label: "Average Budget", value: averageBudgetNumber, tone: "bg-amber-500/80" },
              { label: "Average Paid", value: averagePaidNumber, tone: "bg-emerald-500/80" },
            ].map((item) => {
              const base = Math.max(averageBudgetNumber, averagePaidNumber, 1);
              const width = (item.value / base) * 100;
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-amber-700">{item.label}</span>
                    <span className="text-amber-100">{formatXLM(item.value)}</span>
                  </div>
                  <div className="w-full h-2 rounded bg-ink-900/60">
                    <div className={`h-2 rounded ${item.tone}`} style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top 3 freelancers */}
      <div className="card space-y-4">
        <p className="font-display text-lg text-amber-100">Top Freelancers</p>
        {top3Freelancers.length === 0 ? (
          <p className="text-sm text-amber-800">No released payouts yet.</p>
        ) : (
          <div className="space-y-3">
            {top3Freelancers.map((entry, rank) => (
              <div key={entry.freelancerAddress} className="flex items-center gap-4">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-market-500/15 text-market-300 flex-shrink-0">
                  {rank + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-amber-100 truncate">{shortenAddress(entry.freelancerAddress, 8)}</p>
                  <p className="text-xs text-amber-700">{entry.jobsCount} completed job{entry.jobsCount === 1 ? "" : "s"}</p>
                </div>
                <p className="text-sm text-market-300 font-medium flex-shrink-0">{formatXLM(parseAmount(entry.totalPaidXlm))}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
