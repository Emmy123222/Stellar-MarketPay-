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

export default function StatsPage() {
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
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p className="mt-4 text-gray-600">Loading platform statistics...</p>
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
      </Head>

      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Platform Statistics</h1>
          <p className="text-gray-600 mb-8">Real-time metrics and insights about the Stellar MarketPay platform</p>

          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Total Jobs Posted</h3>
                <p className="text-3xl font-bold text-gray-900">{stats.total_jobs_posted.toLocaleString()}</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Total Escrow Value</h3>
                <p className="text-3xl font-bold text-gray-900">{parseFloat(stats.total_escrow_xlm).toFixed(2)} XLM</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Active Users (30 Days)</h3>
                <p className="text-3xl font-bold text-gray-900">{stats.active_users_30d.toLocaleString()}</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Completion Rate</h3>
                <p className="text-3xl font-bold text-gray-900">{parseFloat(stats.completion_rate).toFixed(1)}%</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Avg Job Budget</h3>
                <p className="text-3xl font-bold text-gray-900">{parseFloat(stats.avg_job_budget).toFixed(2)} XLM</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Last Updated</h3>
                <p className="text-sm text-gray-900">{new Date(stats.last_updated).toLocaleString()}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Top Categories by Job Count</h2>
              <div className="space-y-4">
                {categories.slice(0, 5).map((cat) => (
                  <div key={cat.category} className="flex items-center justify-between">
                    <span className="text-gray-700">{cat.category}</span>
                    <div className="flex items-center gap-4">
                      <div className="w-32 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{
                            width: `${(cat.job_count / (categories[0]?.job_count || 1)) * 100}%`,
                          }}
                        ></div>
                      </div>
                      <span className="text-gray-900 font-semibold min-w-12">{cat.job_count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Category Avg Budgets</h2>
              <div className="space-y-4">
                {categories.slice(0, 5).map((cat) => (
                  <div key={`budget-${cat.category}`} className="flex items-center justify-between">
                    <span className="text-gray-700">{cat.category}</span>
                    <span className="text-gray-900 font-semibold">{parseFloat(cat.avg_budget).toFixed(1)} XLM</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Activity</h2>
            {jobTrends.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-4 text-gray-700 font-semibold">Date</th>
                      <th className="text-right py-2 px-4 text-gray-700 font-semibold">Jobs Posted</th>
                      <th className="text-right py-2 px-4 text-gray-700 font-semibold">Avg Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobTrends.slice(0, 10).map((trend) => (
                      <tr key={trend.date} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-4 text-gray-900">{new Date(trend.date).toLocaleDateString()}</td>
                        <td className="text-right py-2 px-4 text-gray-900">{trend.jobs_posted}</td>
                        <td className="text-right py-2 px-4 text-gray-900">{parseFloat(trend.avg_budget || "0").toFixed(2)} XLM</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
