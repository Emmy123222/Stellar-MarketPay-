import { useMemo, useState } from "react";
import Head from "next/head";
import {
  fetchCategoryAnalytics,
  fetchAnalyticsOverview,
  type CategoryAnalytics,
  type AnalyticsOverview,
} from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import InsightsChart from "@/components/InsightsChart";

type SortKey = "jobCount" | "avgBudgetXLM" | "filledCount" | "avgDaysToFill";
type SortDir = "asc" | "desc";

export default function InsightsPage() {
  const [sortKey, setSortKey] = useState<SortKey>("jobCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, error, isLoading } = useApi<{
    categories: CategoryAnalytics[];
    overview: AnalyticsOverview | null;
  }>(
    "market-insights",
    async () => {
      const [cats, ov] = await Promise.all([fetchCategoryAnalytics(), fetchAnalyticsOverview()]);
      return { categories: cats, overview: ov };
    }
  );

  const categories = useMemo(() => data?.categories ?? [], [data?.categories]);
  const overview = data?.overview ?? null;

  const sorted = useMemo(() => {
    return [...categories].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return (av - bv) * (sortDir === "asc" ? 1 : -1);
    });
  }, [categories, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const totalFilled = categories.reduce((s, c) => s + c.filledCount, 0);
  const totalJobs = categories.reduce((s, c) => s + c.jobCount, 0);
  const fillRatePct = totalJobs ? Math.round((totalFilled / totalJobs) * 100) : 0;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-ink-900">
        <p className="text-red-500">{typeof error === "string" ? error : (error as Error).message || "Failed to load market insights."}</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Market Insights - Stellar MarketPay</title>
        <meta name="description" content="Data-driven marketplace statistics per category." />
      </Head>

      <div className="min-h-screen bg-gray-50 dark:bg-ink-900 py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-amber-100 mb-1">
            Market Insights
          </h1>
          <p className="text-gray-500 dark:text-amber-700 mb-8">
            Live marketplace statistics across every job category.
          </p>

          {/* Overview cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            {isLoading || !overview ? (
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="bg-white dark:bg-ink-800 rounded-lg shadow p-5 animate-pulse">
                  <div className="h-3 w-16 bg-gray-200 dark:bg-ink-700 rounded mb-2" />
                  <div className="h-7 w-24 bg-gray-200 dark:bg-ink-700 rounded" />
                </div>
              ))
            ) : (
              [
                { label: "Total Jobs", value: overview.totalJobs.toLocaleString() },
                { label: "Open Now", value: overview.openJobs.toLocaleString() },
                {
                  label: "Avg Budget",
                  value: `${overview.avgBudgetXLM.toLocaleString()} XLM`,
                },
                {
                  label: "Avg Days to Fill",
                  value: overview.avgDaysToFill != null ? `${overview.avgDaysToFill}d` : "—",
                },
              ].map((c) => (
                <div
                  key={c.label}
                  className="bg-white dark:bg-ink-800 rounded-lg shadow p-5"
                >
                  <p className="text-xs text-gray-500 dark:text-amber-700 mb-1">{c.label}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-amber-100">{c.value}</p>
                </div>
              ))
            )}
            <div className="bg-white dark:bg-ink-800 rounded-lg shadow p-5 col-span-2 md:col-span-2">
              <p className="text-xs text-gray-500 dark:text-amber-700 mb-2">
                Platform Fill Rate ({fillRatePct}%)
              </p>
              <div className="w-full h-2 bg-gray-200 dark:bg-ink-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-market-500 to-market-400 transition-all"
                  style={{ width: `${fillRatePct}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-amber-700">
                {totalFilled.toLocaleString()} filled of {totalJobs.toLocaleString()} total jobs
              </p>
            </div>
            <InsightsChart loading={isLoading} categories={sorted} />
          </div>

          {/* Category analytics table */}
          <section className="bg-white dark:bg-ink-800 rounded-lg shadow overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-ink-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-amber-100">
                Category Statistics
              </h2>
              <p className="text-sm text-gray-500 dark:text-amber-700 mt-1">
                Performance metrics aggregated per job category.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-ink-900/50">
                  <tr>
                    {([
                      ["category", "Category"],
                      ["jobCount", "Jobs"],
                      ["avgBudgetXLM", "Avg Budget (XLM)"],
                      ["filledCount", "Filled"],
                      ["avgDaysToFill", "Avg Days to Fill"],
                    ] as const).map(([key, label]) => (
                      <th
                        key={key}
                        onClick={() => toggleSort(key as SortKey)}
                        className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-amber-700 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-ink-700/50"
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {sortKey === key && (
                            <span className="text-market-400">{sortDir === "asc" ? "↑" : "↓"}</span>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-ink-700">
                  {sorted.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-5 py-12 text-center text-gray-500 dark:text-amber-700"
                      >
                        No category data available yet.
                      </td>
                    </tr>
                  ) : (
                    sorted.map((c) => (
                      <tr
                        key={c.category}
                        className="hover:bg-gray-50 dark:hover:bg-ink-700/30"
                      >
                        <td className="px-5 py-3 font-medium text-gray-900 dark:text-amber-100 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <div className="w-20 h-2 bg-gray-200 dark:bg-ink-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-market-500"
                                style={{
                                  width: `${(c.jobCount / maxJobCount) * 100}%`,
                                }}
                              />
                            </div>
                            {c.category}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-700 dark:text-amber-200 tabular-nums">
                          {c.jobCount.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-gray-700 dark:text-amber-200 tabular-nums">
                          {c.avgBudgetXLM.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-gray-700 dark:text-amber-200 tabular-nums">
                          {c.filledCount.toLocaleString()}
                          {c.jobCount > 0 && (
                            <span className="ml-1 text-xs text-gray-500 dark:text-amber-700">
                              ({Math.round((c.filledCount / c.jobCount) * 100)}%)
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-gray-700 dark:text-amber-200 tabular-nums">
                          {c.avgDaysToFill != null ? `${c.avgDaysToFill}d` : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
