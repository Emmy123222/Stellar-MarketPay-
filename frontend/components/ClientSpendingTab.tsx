import { formatXLM, formatUSDEquivalent, shortenAddress } from "@/utils/format";
import { SPENDING_STATUS_LABELS, SPENDING_STATUS_ORDER } from "@/constants/spending";
import type { ClientSpendingAnalytics } from "@/utils/types";

type Props = {
  analytics: ClientSpendingAnalytics | null;
  loading: boolean;
  xlmPriceUsd: number | null;
};

function parseAmount(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function ClientSpendingTab({ analytics, loading, xlmPriceUsd }: Props) {
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
  const averageBudgetNumber = parseAmount(analytics.averageBudgetXlm);
  const averagePaidNumber = parseAmount(analytics.averagePaidXlm);
  const maxStatusCount = Math.max(
    ...SPENDING_STATUS_ORDER.map((status) => analytics.jobsBreakdown[status]),
    1
  );
  const maxFreelancerJobs = Math.max(...analytics.topFreelancers.map((f) => f.jobsCount), 1);

  return (
    <div className="space-y-6">
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
        <div className="card">
          <p className="text-xs text-amber-700">Avg Paid</p>
          <p className="font-display text-2xl text-amber-100 mt-1">{formatXLM(averagePaidNumber)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

      <div className="card space-y-4">
        <p className="font-display text-lg text-amber-100">Top Freelancers Worked With</p>
        {analytics.topFreelancers.length === 0 ? (
          <p className="text-sm text-amber-800">No released payouts yet.</p>
        ) : (
          <div className="space-y-3">
            {analytics.topFreelancers.map((entry) => (
              <div key={entry.freelancerAddress} className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-amber-100 truncate">{shortenAddress(entry.freelancerAddress, 8)}</p>
                  <p className="text-xs text-amber-700">{entry.jobsCount} completed job{entry.jobsCount === 1 ? "" : "s"}</p>
                </div>
                <div className="w-40">
                  <div className="w-full h-2 rounded bg-ink-900/60">
                    <div
                      className="h-2 rounded bg-market-400/80"
                      style={{ width: `${(entry.jobsCount / maxFreelancerJobs) * 100}%` }}
                    />
                  </div>
                </div>
                <p className="text-sm text-market-300 font-medium">{formatXLM(parseAmount(entry.totalPaidXlm))}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
