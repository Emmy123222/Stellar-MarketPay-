/**
 * Public statistics page for Issue #232
 * Displays platform-wide metrics and trends
 */
import { useEffect, useState } from "react";
import Head from "next/head";
import axios from "axios";

interface Stats {
  total_jobs_posted: number;
  total_escrow_xlm: number;
  active_users_30d: number;
  completion_rate: number;
  avg_job_budget: number;
  last_updated: string;
}

interface Trend {
  date: string;
  jobs_posted?: number;
  avg_budget?: number;
  escrow_count?: number;
  total_amount?: number;
}

interface Category {
  category: string;
  job_count: number;
  avg_budget: number;
}

interface Contributor {
  public_key: string | null;
  name: string;
  avatar_url: string | null;
  profile_url: string | null;
  score: number;
  jobs_completed: number;
  xlm_transacted: number;
  github_prs: number;
  badge: "Gold" | "Silver" | "Bronze";
  rank: number;
}

export default function StatsPage() {
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [contributorsLoading, setContributorsLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobTrends, setJobTrends] = useState<Trend[]>([]);
  const [escrowTrends, setEscrowTrends] = useState<Trend[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [statsRes, jobTrendRes, escrowTrendRes, categoriesRes] = await Promise.all([
          axios.get("/api/stats"),
          axios.get("/api/stats/trends/jobs?days=90"),
          axios.get("/api/stats/trends/escrow?days=90"),
          axios.get("/api/stats/categories?limit=10"),
        ]);

        setStats(statsRes.data.data);
        setJobTrends(jobTrendRes.data.data);
        setEscrowTrends(escrowTrendRes.data.data);
        setCategories(categoriesRes.data.data);
      } catch (error) {
        console.error("Failed to load stats:", error);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
    // Refresh stats every 5 minutes (stats do not need to be real-time).
    const interval = setInterval(loadStats, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch contributors separately
  useEffect(() => {
    const loadContributors = async () => {
      try {
        const res = await axios.get("/api/contributors");
        setContributors(res.data.data || []);
      } catch (error) {
        console.error("Failed to load contributors:", error);
      } finally {
        setContributorsLoading(false);
      }
    };
    loadContributors();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-ink-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p className="mt-4 text-gray-600 dark:text-amber-700">Loading platform statistics...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Platform Statistics - Stellar MarketPay</title>
        <meta name="description" content="View platform-wide statistics and metrics" />
        <meta property="og:title" content="Platform Statistics - Stellar MarketPay" />
        <meta property="og:description" content="Live platform-wide metrics: jobs posted, escrow value, completion rate, and top categories." />
        <meta property="og:type" content="website" />
      </Head>

      <div className="min-h-screen bg-gray-50 dark:bg-ink-900 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-amber-100 mb-2">Platform Statistics</h1>
          <p className="text-gray-600 dark:text-amber-700 mb-8">Real-time metrics and insights about the Stellar MarketPay platform</p>

          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
              <div className="bg-white dark:bg-ink-800 rounded-lg shadow dark:shadow-none dark:border dark:border-market-500/10 p-6">
                <h3 className="text-sm font-medium text-gray-500 dark:text-amber-700 mb-2">Total Jobs Posted</h3>
                <p className="text-3xl font-bold text-gray-900 dark:text-amber-100">{stats.total_jobs_posted.toLocaleString()}</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Total Escrow Value</h3>
                <p className="text-3xl font-bold text-gray-900">{stats.total_escrow_xlm.toFixed(2)} XLM</p>
              </div>

              <div className="bg-white dark:bg-ink-800 rounded-lg shadow dark:shadow-none dark:border dark:border-market-500/10 p-6">
                <h3 className="text-sm font-medium text-gray-500 dark:text-amber-700 mb-2">Active Users (30 Days)</h3>
                <p className="text-3xl font-bold text-gray-900 dark:text-amber-100">{stats.active_users_30d.toLocaleString()}</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Completion Rate</h3>
                <p className="text-3xl font-bold text-gray-900">{stats.completion_rate.toFixed(1)}%</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Avg Job Budget</h3>
                <p className="text-3xl font-bold text-gray-900">{stats.avg_job_budget.toFixed(2)} XLM</p>
              </div>

              <div className="bg-white dark:bg-ink-800 rounded-lg shadow dark:shadow-none dark:border dark:border-market-500/10 p-6">
                <h3 className="text-sm font-medium text-gray-500 dark:text-amber-700 mb-2">Last Updated</h3>
                <p className="text-sm text-gray-900">{new Date(stats.last_updated).toLocaleString()}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
            <div className="bg-white dark:bg-ink-800 rounded-lg shadow dark:shadow-none dark:border dark:border-market-500/10 p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-amber-100 mb-4">Top Categories by Job Count</h2>
              <div className="space-y-4">
                {categories.slice(0, 5).map((cat) => (
                  <div key={cat.category} className="flex items-center justify-between">
                    <span className="text-gray-700 dark:text-amber-700">{cat.category}</span>
                    <div className="flex items-center gap-4">
                      <div className="w-32 bg-gray-200 dark:bg-ink-700 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{
                            width: `${(cat.job_count / (categories[0]?.job_count || 1)) * 100}%`,
                          }}
                        ></div>
                      </div>
                      <span className="text-gray-900 dark:text-amber-100 font-semibold min-w-12">{cat.job_count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-ink-800 rounded-lg shadow dark:shadow-none dark:border dark:border-market-500/10 p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-amber-100 mb-4">Category Avg Budgets</h2>
              <div className="space-y-4">
                {categories.slice(0, 5).map((cat) => (
                  <div key={`budget-${cat.category}`} className="flex items-center justify-between">
                    <span className="text-gray-700">{cat.category}</span>
                    <span className="text-gray-900 font-semibold">{cat.avg_budget.toFixed(1)} XLM</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-ink-800 rounded-lg shadow dark:shadow-none dark:border dark:border-market-500/10 p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-amber-100 mb-4">Recent Activity</h2>
            {jobTrends.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b dark:border-market-500/10">
                      <th className="text-left py-2 px-4 text-gray-700 dark:text-amber-700 font-semibold">Date</th>
                      <th className="text-right py-2 px-4 text-gray-700 dark:text-amber-700 font-semibold">Jobs Posted</th>
                      <th className="text-right py-2 px-4 text-gray-700 dark:text-amber-700 font-semibold">Avg Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobTrends.slice(0, 10).map((trend) => (
                      <tr key={trend.date} className="border-b dark:border-market-500/10 hover:bg-gray-50 dark:hover:bg-ink-700">
                        <td className="py-2 px-4 text-gray-900">{new Date(trend.date).toLocaleDateString()}</td>
                        <td className="text-right py-2 px-4 text-gray-900">{trend.jobs_posted}</td>
                        <td className="text-right py-2 px-4 text-gray-900">{(trend.avg_budget || 0).toFixed(2)} XLM</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Contributor Leaderboard (Issue #844) ── */}
          <div className="bg-white dark:bg-ink-800 rounded-lg shadow dark:shadow-none dark:border dark:border-market-500/10 p-6 mt-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-amber-100">
                🏆 Contributor Leaderboard
              </h2>
              <span className="text-xs text-gray-500 dark:text-amber-700 bg-gray-100 dark:bg-ink-700 px-3 py-1 rounded-full">
                Updated hourly
              </span>
            </div>
            <p className="text-gray-600 dark:text-amber-700 mb-6 text-sm">
              Top contributors ranked by contribution score — a blend of jobs completed, XLM transacted, and GitHub PRs.
            </p>

            {contributorsLoading ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-amber-500"></div>
                <p className="mt-3 text-sm text-gray-500 dark:text-amber-700">Loading leaderboard…</p>
              </div>
            ) : contributors.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-amber-700">
                No contributors yet. Be the first!
              </div>
            ) : (
              <div className="space-y-3">
                {contributors.map((c) => (
                  <div
                    key={c.public_key || c.name}
                    className="flex items-center gap-4 p-3 rounded-lg transition-colors hover:bg-gray-50 dark:hover:bg-ink-700 group"
                  >
                    {/* Rank + Badge */}
                    <div className="flex-shrink-0 w-10 text-center">
                      {c.badge === "Gold" && (
                        <span className="text-xl" title="Gold">🥇</span>
                      )}
                      {c.badge === "Silver" && (
                        <span className="text-xl" title="Silver">🥈</span>
                      )}
                      {c.badge === "Bronze" && (
                        <span className="text-xl" title="Bronze">🥉</span>
                      )}
                      <div className="text-xs text-gray-400 dark:text-amber-700 font-mono mt-0.5">
                        #{c.rank}
                      </div>
                    </div>

                    {/* Avatar */}
                    <div className="flex-shrink-0">
                      {c.avatar_url ? (
                        <img
                          src={c.avatar_url}
                          alt={c.name}
                          className="w-10 h-10 rounded-full ring-2 ring-gray-200 dark:ring-market-500/20 object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold text-sm ring-2 ring-gray-200 dark:ring-market-500/20">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Name + Score */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-amber-100 truncate">
                          {c.name}
                        </span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            c.badge === "Gold"
                              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                              : c.badge === "Silver"
                              ? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                          }`}
                        >
                          {c.badge}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-amber-700">
                        <span>Score: <strong className="text-gray-900 dark:text-amber-100">{c.score.toLocaleString()}</strong></span>
                        {c.jobs_completed > 0 && <span>• {c.jobs_completed} jobs</span>}
                        {c.xlm_transacted > 0 && <span>• {c.xlm_transacted.toFixed(0)} XLM</span>}
                        {c.github_prs > 0 && <span>• {c.github_prs} PRs</span>}
                      </div>
                    </div>

                    {/* Score bar */}
                    <div className="hidden sm:block w-24">
                      <div className="h-1.5 bg-gray-200 dark:bg-ink-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            c.badge === "Gold"
                              ? "bg-gradient-to-r from-yellow-400 to-yellow-500"
                              : c.badge === "Silver"
                              ? "bg-gradient-to-r from-gray-300 to-gray-400"
                              : "bg-gradient-to-r from-amber-500 to-amber-600"
                          }`}
                          style={{
                            width: `${Math.min(
                              (c.score / (contributors[0]?.score || 1)) * 100,
                              100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Score formula footnote */}
            <details className="mt-6 text-xs text-gray-400 dark:text-amber-700">
              <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-amber-500">
                How is the score calculated?
              </summary>
              <p className="mt-2 leading-relaxed">
                <strong>Contribution Score</strong> = (jobs_completed × 10) + (XLM transacted / 100) + (GitHub PRs × 5).
                Data refreshes from the database and GitHub API every hour.
                🥇 Gold = rank 1–3, 🥈 Silver = rank 4–10, 🥉 Bronze = rank 11–50.
              </p>
            </details>
          </div>
        </div>
      </div>
    </>
  );
}
