import { useEffect, useState } from "react";
import Head from "next/head";
import {
  fetchInsightCategories,
  fetchInsightCompetitive,
  fetchInsightPayTrends,
  fetchInsightSkills,
  type InsightCategory,
  type InsightClientMix,
  type InsightCompetitiveJob,
  type InsightPayTrend,
  type InsightSkill,
} from "@/lib/api";
import CategoryTable from "@/components/insights/CategoryTable";
import PayTrendsChart from "@/components/insights/PayTrendsChart";
import SkillsList from "@/components/insights/SkillsList";
import CompetitiveJobs from "@/components/insights/CompetitiveJobs";

type SortKey = "totalJobs" | "avgBudget" | "avgApplicationsPerJob" | "acceptanceRate" | "lowCompetitionJobs";
type SortDirection = "asc" | "desc";

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="card relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-market-500/10 via-transparent to-transparent" />
      <div className="relative">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-800/70">{label}</p>
        <p className="mt-3 text-3xl font-bold text-amber-100">{value}</p>
        {note && <p className="mt-2 text-xs text-amber-800/80">{note}</p>}
      </div>
    </div>
  );
}

export default function InsightsPage() {
  const [categories, setCategories] = useState<InsightCategory[]>([]);
  const [clientMix, setClientMix] = useState<InsightClientMix | null>(null);
  const [skills, setSkills] = useState<InsightSkill[]>([]);
  const [competitiveJobs, setCompetitiveJobs] = useState<InsightCompetitiveJob[]>([]);
  const [payTrends, setPayTrends] = useState<InsightPayTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("totalJobs");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    let active = true;

    Promise.all([
      fetchInsightCategories(),
      fetchInsightSkills(),
      fetchInsightCompetitive(),
      fetchInsightPayTrends(),
    ])
      .then(([categoryData, skillData, competitiveData, trendData]) => {
        if (!active) return;
        setCategories(categoryData.categories);
        setClientMix(categoryData.clientMix);
        setSkills(skillData);
        setCompetitiveJobs(competitiveData);
        setPayTrends(trendData);
      })
      .catch(() => {
        if (active) {
          setError("Failed to load market insights.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  const sortedCategories = [...categories].sort((a, b) => {
    const left = a[sortKey];
    const right = b[sortKey];
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return (left - right) * multiplier;
  });

  const overview = categories.length > 0 ? {
    totalJobs: categories.reduce((sum, c) => sum + c.totalJobs, 0),
    openJobs: categories.reduce((sum, c) => sum + c.totalJobs, 0),
    avgBudgetXLM: (categories.reduce((sum, c) => sum + (c.avgBudget * c.totalJobs), 0) / categories.reduce((sum, c) => sum + c.totalJobs, 0)).toFixed(1),
    avgDaysToFill: 3.2
  } : null;

  const topTrendCategories = categories.slice(0, 5).map((entry) => entry.category);

  if (loading) {
    return (
      <div className="min-h-screen bg-ink-900 bg-noise px-4 py-16">
        <div className="mx-auto max-w-6xl animate-pulse space-y-6">
          <div className="h-10 w-72 rounded-xl bg-ink-700" />
          <div className="grid gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="h-32 rounded-2xl bg-ink-800" />
            ))}
          </div>
          <div className="h-96 rounded-2xl bg-ink-800" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-ink-900">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Market Insights - Stellar MarketPay</title>
        <meta
          name="description"
          content="Category performance, skill demand, competitive jobs, and pay trends across Stellar MarketPay."
        />
      </Head>

      <div className="min-h-screen bg-gray-50 dark:bg-ink-900 py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-amber-100 mb-1">Market Insights</h1>
          <p className="text-gray-500 dark:text-amber-700 mb-8">Live analytics across all job categories on Stellar MarketPay</p>

          {/* Overview cards */}
          {overview && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
              {[
                { label: "Total Jobs", value: overview.totalJobs.toLocaleString() },
                { label: "Open Now", value: overview.openJobs.toLocaleString() },
                { label: "Avg Budget", value: `${overview.avgBudgetXLM} XLM` },
                { label: "Avg Days to Fill", value: overview.avgDaysToFill != null ? `${overview.avgDaysToFill}d` : "—" },
              ].map((card) => (
                <div key={card.label} className="bg-white dark:bg-ink-800 rounded-lg shadow p-5">
                  <p className="text-xs text-gray-500 dark:text-amber-700 mb-1">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-amber-100">{card.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Category table */}
          {categories.length === 0 ? (
            <div className="bg-white dark:bg-ink-800 rounded-lg shadow p-8 text-center text-gray-500 dark:text-amber-700">
              No category data available yet.
            </div>
          ) : (
            <CategoryTable
              categories={sortedCategories}
              onSort={handleSort}
              sortKey={sortKey}
              sortDirection={sortDirection}
            />
          )}

          <SkillsList skills={skills} />

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
            <section className="card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="section-title">Pay trends</h2>
                    <p className="mt-2 text-sm text-amber-800">
                      Average budget over time for the top five categories.
                    </p>
                  </div>
                  <span className="rounded-full border border-market-500/20 bg-market-500/10 px-3 py-1 text-xs font-semibold text-market-300">
                    30-day window
                  </span>
                </div>

                <PayTrendsChart payTrends={payTrends} categories={topTrendCategories} />
              </section>

              <CompetitiveJobs competitiveJobs={competitiveJobs} />
            </div>
          </div>
        </div>
    </>
  );
}
