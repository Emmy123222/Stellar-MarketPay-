/**
 * components/AdminAnalytics.tsx
 * Admin analytics dashboard with charts and metrics
 */
import { useEffect, useState } from "react";
import { fetchAdminMetrics, fetchAuditLogs } from "@/lib/api";
import type { AuditLogEntry } from "@/utils/types";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from "chart.js";
import { Line, Bar, Doughnut } from "react-chartjs-2";
import { format } from "date-fns";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

interface AdminAnalyticsProps {
  publicKey: string | null;
}

type Period = "7d" | "30d" | "90d";

interface MetricsData {
  period: string;
  platformHealth: {
    total_jobs: number;
    open_jobs: number;
    completed_jobs: number;
    disputed_jobs: number;
    completion_rate: number;
    dispute_rate: number;
  };
  userGrowth: {
    total_users: number;
    freelancers: number;
    clients: number;
    new_users_period: number;
  };
  weeklyGrowth: Array<{ week: string; new_users: number }>;
  financialMetrics: {
    total_xlm_escrow: number;
    total_xlm_released: number;
    avg_job_budget: number;
    active_escrows: number;
  };
  qualityMetrics: {
    avg_rating: number;
    total_ratings: number;
    repeat_hires: number;
  };
  disputeMetrics: Array<{ week: string; disputes_opened: number; disputes_resolved: number }>;
  topEarners: Array<{
    public_key: string;
    display_name: string;
    total_earned_xlm: number;
    completed_jobs: number;
    rating: number;
  }>;
  jobVolume: Array<{ date: string; jobs_created: number; jobs_completed: number }>;
}

function MetricCard({ title, value, subtitle, color = "blue" }: {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: "blue" | "green" | "amber" | "red";
}) {
  const colorMap = {
    blue: "bg-blue-500/10 border-blue-500/20 text-blue-400",
    green: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    amber: "bg-amber-500/10 border-amber-500/20 text-amber-400",
    red: "bg-red-500/10 border-red-500/20 text-red-400",
  };

  return (
    <div className={`p-4 rounded-lg border ${colorMap[color]}`}>
      <h3 className="text-sm font-medium opacity-80">{title}</h3>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {subtitle && <p className="text-xs opacity-60 mt-1">{subtitle}</p>}
    </div>
  );
}

export default function AdminAnalytics({ publicKey }: AdminAnalyticsProps) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("30d");
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditResourceTypeFilter, setAuditResourceTypeFilter] = useState("");

  useEffect(() => {
    if (!publicKey) return;

    const loadMetrics = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchAdminMetrics(period);
        setMetrics(data);
      } catch (err: any) {
        setError(err.response?.data?.error || "Failed to load metrics");
      } finally {
        setLoading(false);
      }
    };

    loadMetrics();
  }, [publicKey, period]);

  useEffect(() => {
    if (!publicKey) return;

    const loadAuditLogs = async () => {
      try {
        setAuditLoading(true);
        const { logs, nextCursor } = await fetchAuditLogs({
          action: auditActionFilter || undefined,
          resource_type: auditResourceTypeFilter || undefined,
        });
        setAuditLogs(logs);
        setAuditNextCursor(nextCursor);
      } catch {
        setAuditLogs([]);
      } finally {
        setAuditLoading(false);
      }
    };

    loadAuditLogs();
  }, [publicKey, auditActionFilter, auditResourceTypeFilter]);

  const exportCSV = () => {
    if (!metrics) return;
    
    const csvData = [
      ["Metric", "Value"],
      ["Total Jobs", metrics.platformHealth.total_jobs],
      ["Open Jobs", metrics.platformHealth.open_jobs],
      ["Completed Jobs", metrics.platformHealth.completed_jobs],
      ["Completion Rate", `${metrics.platformHealth.completion_rate}%`],
      ["Dispute Rate", `${metrics.platformHealth.dispute_rate}%`],
      ["Total Users", metrics.userGrowth.total_users],
      ["Freelancers", metrics.userGrowth.freelancers],
      ["Clients", metrics.userGrowth.clients],
      ["Total XLM in Escrow", metrics.financialMetrics.total_xlm_escrow],
      ["Total XLM Released", metrics.financialMetrics.total_xlm_released],
      ["Average Job Budget", metrics.financialMetrics.avg_job_budget],
      ["Average Rating", metrics.qualityMetrics.avg_rating],
    ];

    const csvContent = csvData.map(row => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `admin-metrics-${period}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!metrics) return null;

  // Chart data
  const userGrowthData = {
    labels: metrics.weeklyGrowth.map(w => format(new Date(w.week), "MMM dd")),
    datasets: [
      {
        label: "New Users",
        data: metrics.weeklyGrowth.map(w => w.new_users),
        borderColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        tension: 0.4,
      },
    ],
  };

  const jobVolumeData = {
    labels: metrics.jobVolume.slice(-14).map(d => format(new Date(d.date), "MMM dd")),
    datasets: [
      {
        label: "Jobs Created",
        data: metrics.jobVolume.slice(-14).map(d => d.jobs_created),
        backgroundColor: "rgba(34, 197, 94, 0.8)",
      },
      {
        label: "Jobs Completed",
        data: metrics.jobVolume.slice(-14).map(d => d.jobs_completed),
        backgroundColor: "rgba(59, 130, 246, 0.8)",
      },
    ],
  };

  const disputeData = {
    labels: metrics.disputeMetrics.map(d => format(new Date(d.week), "MMM dd")),
    datasets: [
      {
        label: "Disputes Opened",
        data: metrics.disputeMetrics.map(d => d.disputes_opened),
        borderColor: "rgb(239, 68, 68)",
        backgroundColor: "rgba(239, 68, 68, 0.1)",
        tension: 0.4,
      },
      {
        label: "Disputes Resolved",
        data: metrics.disputeMetrics.map(d => d.disputes_resolved),
        borderColor: "rgb(34, 197, 94)",
        backgroundColor: "rgba(34, 197, 94, 0.1)",
        tension: 0.4,
      },
    ],
  };

  const jobStatusData = {
    labels: ["Open", "Completed", "Disputed"],
    datasets: [
      {
        data: [
          metrics.platformHealth.open_jobs,
          metrics.platformHealth.completed_jobs,
          metrics.platformHealth.disputed_jobs,
        ],
        backgroundColor: [
          "rgba(59, 130, 246, 0.8)",
          "rgba(34, 197, 94, 0.8)",
          "rgba(239, 68, 68, 0.8)",
        ],
        borderWidth: 0,
      },
    ],
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-amber-100">Analytics Dashboard</h2>
        <div className="flex items-center gap-3">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="bg-market-800 border border-market-600 rounded-lg px-3 py-2 text-sm text-amber-100"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <button
            onClick={exportCSV}
            className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Platform Health Metrics */}
      <section>
        <h3 className="font-semibold text-amber-100 mb-4">Platform Health</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Total Jobs" value={metrics.platformHealth.total_jobs} color="blue" />
          <MetricCard title="Open Jobs" value={metrics.platformHealth.open_jobs} color="amber" />
          <MetricCard title="Completion Rate" value={`${metrics.platformHealth.completion_rate}%`} color="green" />
          <MetricCard title="Dispute Rate" value={`${metrics.platformHealth.dispute_rate}%`} color="red" />
        </div>
      </section>

      {/* User Growth */}
      <section>
        <h3 className="font-semibold text-amber-100 mb-4">User Growth</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricCard title="Total Users" value={metrics.userGrowth.total_users} color="blue" />
          <MetricCard title="Freelancers" value={metrics.userGrowth.freelancers} color="green" />
          <MetricCard title="Clients" value={metrics.userGrowth.clients} color="amber" />
          <MetricCard title="New Users" value={metrics.userGrowth.new_users_period} subtitle={`Last ${period}`} color="blue" />
        </div>
        <div className="bg-market-800 p-4 rounded-lg">
          <h4 className="font-medium text-amber-100 mb-3">Weekly User Growth</h4>
          <Line data={userGrowthData} options={{ responsive: true, plugins: { legend: { display: false } } }} />
        </div>
      </section>

      {/* Financial Metrics */}
      <section>
        <h3 className="font-semibold text-amber-100 mb-4">Financial Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="XLM in Escrow" value={`${Number(metrics.financialMetrics.total_xlm_escrow).toFixed(2)}`} color="amber" />
          <MetricCard title="XLM Released" value={`${Number(metrics.financialMetrics.total_xlm_released).toFixed(2)}`} color="green" />
          <MetricCard title="Avg Job Budget" value={`${Number(metrics.financialMetrics.avg_job_budget).toFixed(2)} XLM`} color="blue" />
          <MetricCard title="Active Escrows" value={metrics.financialMetrics.active_escrows} color="amber" />
        </div>
      </section>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Job Volume Chart */}
        <div className="bg-market-800 p-4 rounded-lg">
          <h4 className="font-medium text-amber-100 mb-3">Daily Job Volume (Last 14 days)</h4>
          <Bar data={jobVolumeData} options={{ responsive: true, plugins: { legend: { position: "top" } } }} />
        </div>

        {/* Job Status Distribution */}
        <div className="bg-market-800 p-4 rounded-lg">
          <h4 className="font-medium text-amber-100 mb-3">Job Status Distribution</h4>
          <Doughnut data={jobStatusData} options={{ responsive: true, plugins: { legend: { position: "bottom" } } }} />
        </div>

        {/* Dispute Trends */}
        <div className="bg-market-800 p-4 rounded-lg">
          <h4 className="font-medium text-amber-100 mb-3">Dispute Trends</h4>
          <Line data={disputeData} options={{ responsive: true, plugins: { legend: { position: "top" } } }} />
        </div>

        {/* Top Earners */}
        <div className="bg-market-800 p-4 rounded-lg">
          <h4 className="font-medium text-amber-100 mb-3">Top Earners</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {metrics.topEarners.map((earner, index) => (
              <div key={earner.public_key} className="flex items-center justify-between p-2 bg-market-700 rounded">
                <div>
                  <p className="text-sm font-medium text-amber-100">
                    #{index + 1} {earner.display_name || "Anonymous"}
                  </p>
                  <p className="text-xs text-amber-800">
                    {earner.completed_jobs} jobs • {earner.rating?.toFixed(1) || "N/A"} ⭐
                  </p>
                </div>
                <p className="text-sm font-bold text-green-400">
                  {Number(earner.total_earned_xlm).toFixed(2)} XLM
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quality Metrics */}
      <section>
        <h3 className="font-semibold text-amber-100 mb-4">Quality Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard title="Average Rating" value={`${Number(metrics.qualityMetrics.avg_rating).toFixed(1)} ⭐`} color="green" />
          <MetricCard title="Total Ratings" value={metrics.qualityMetrics.total_ratings} color="blue" />
          <MetricCard title="Repeat Hires" value={metrics.qualityMetrics.repeat_hires} color="amber" />
        </div>
      </section>

      {/* Audit Log Table */}
      <section>
        <h3 className="font-semibold text-amber-100 mb-4">Audit Log</h3>
        <div className="bg-market-800 p-4 rounded-lg">
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              placeholder="Filter by action..."
              value={auditActionFilter}
              onChange={(e) => setAuditActionFilter(e.target.value)}
              className="bg-market-700 border border-market-600 rounded px-3 py-1 text-sm text-amber-100 placeholder-amber-800"
            />
            <input
              type="text"
              placeholder="Filter by resource type..."
              value={auditResourceTypeFilter}
              onChange={(e) => setAuditResourceTypeFilter(e.target.value)}
              className="bg-market-700 border border-market-600 rounded px-3 py-1 text-sm text-amber-100 placeholder-amber-800"
            />
          </div>
          {auditLoading ? (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-400 mx-auto"></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-market-600">
                    <th className="text-left py-2 text-amber-100">Admin Address</th>
                    <th className="text-left py-2 text-amber-100">Action</th>
                    <th className="text-left py-2 text-amber-100">Resource</th>
                    <th className="text-left py-2 text-amber-100">Timestamp</th>
                    <th className="text-left py-2 text-amber-100">Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="border-b border-market-700/50">
                      <td className="py-2 font-mono text-amber-200">{log.adminAddress?.slice(0, 8)}...</td>
                      <td className="py-2 text-amber-100">{log.action}</td>
                      <td className="py-2 text-amber-100">{log.resource || "—"}</td>
                      <td className="py-2 text-amber-800">{format(new Date(log.timestamp), "PPp")}</td>
                      <td className="py-2 text-amber-800">
                        {log.changesDiff ? JSON.stringify(log.changesDiff).slice(0, 50) + (JSON.stringify(log.changesDiff).length > 50 ? "…" : "") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!auditLogs.length && (
                <p className="text-center py-4 text-amber-800">No audit logs found.</p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}