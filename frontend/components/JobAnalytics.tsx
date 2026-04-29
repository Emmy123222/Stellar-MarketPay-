import { useState, useEffect } from "react";
import { fetchJobAnalytics, extendJobExpiry } from "@/lib/api";
import { Job, JobAnalytics } from "@/utils/types";
import clsx from "clsx";

interface JobAnalyticsProps {
  job: Job;
  onExtend?: () => void;
}

/**
 * Bar chart for applications per day.
 */
function ApplicationsPerDayChart({ data }: { data: JobAnalytics["applicationsPerDay"] }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-amber-800 text-center py-4">No applications yet</p>;
  }

  const maxCount = Math.max(...data.map(d => d.count), 1);
  const lastSeven = data.slice(-7);

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-1 h-20">
        {lastSeven.map((item, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full max-w-[28px] bg-gradient-to-t from-amber-500/30 to-amber-400 rounded-t-sm transition-all duration-300 hover:from-amber-500/50 hover:to-amber-300" style={{ height: `${Math.max(4, (item.count / maxCount) * 100)}%` }} />
            <span className="text-[10px] text-amber-700 whitespace-nowrap">
              {new Date(item.day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-amber-800 px-1">
        <span>{lastSeven[0]?.day ? new Date(lastSeven[0].day).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "-"}</span>
        <span>{lastSeven[lastSeven.length - 1]?.day ? new Date(lastSeven[lastSeven.length - 1].day).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "-"}</span>
      </div>
    </div>
  );
}

/**
 * Simple bar for skill distribution.
 */
function SkillDistributionChart({ data }: { data: Record<string, number> }) {
  const skills = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (skills.length === 0) {
    return <p className="text-sm text-amber-800 text-center py-4">No skill data</p>;
  }
  const maxCount = Math.max(...skills.map(s => s[1]), 1);
  return (
    <div className="space-y-2">
      {skills.map(([skill, count]) => (
        <div key={skill} className="flex items-center gap-2">
          <div className="w-20 text-xs text-amber-700 truncate flex-shrink-0">{skill}</div>
          <div className="flex-1 h-6 bg-ink-900 rounded overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500/40 to-emerald-400 transition-all duration-500" 
              style={{ width: `${(count / maxCount) * 100}%` }}
            />
          </div>
          <span className="text-xs font-mono text-emerald-400 w-6 text-right flex-shrink-0">{count}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Bid amount comparison.
 */
function BidAmountChart({ data }: { data: JobAnalytics["averageBidAmount"] }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-amber-800 text-center py-4">No bids yet</p>;
  }
  return (
    <div className="space-y-3">
      {data.map((bid, i) => (
        <div key={bid.currency} className="flex items-center gap-3">
          <div className="w-16 text-sm text-amber-700">{bid.currency}</div>
          <div className="flex-1 h-8 bg-ink-900 rounded overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500/30 to-amber-400 flex items-center justify-end pr-2 transition-all duration-500"
              style={{ width: `${Math.min(100, (bid.avgBid / 1000) * 100)}%` }}
            >
              <span className="text-sm font-semibold text-amber-100">{bid.avgBid.toFixed(2)}</span>
            </div>
          </div>
          <span className="text-xs text-amber-800 w-10 flex-shrink-0">({bid.count})</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Status breakdown mini pie/donut.
 */
function StatusBreakdown({ data }: { data: JobAnalytics["applicationStatusCounts"] }) {
  const total = Object.values(data).reduce((a, b) => a + (b || 0), 0);
  if (total === 0) {
    return <p className="text-sm text-amber-800 text-center py-4">No applications</p>;
  }

  const statuses = [
    { key: "pending", label: "Pending", color: "bg-amber-500/50" },
    { key: "accepted", label: "Accepted", color: "bg-emerald-500/50" },
    { key: "rejected", label: "Rejected", color: "bg-red-500/50" },
  ];

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          {statuses.map((s, i) => {
            const value = data[s.key] || 0;
            const pct = total > 0 ? value / total : 0;
            const offset = statuses.slice(0, i).reduce((acc, prev) => acc + ((data[prev.key] || 0) / total), 0);
            return pct > 0 ? (
              <circle
                key={s.key}
                cx="18"
                cy="18"
                r="15.915"
                fill="none"
                stroke={s.color.replace("bg-", "#")?.replace("/50", "") || "#fbbf24"}
                strokeWidth="3"
                strokeDasharray={`${pct * 100} ${100 - pct * 100}`}
                strokeDashoffset={-offset * 100}
                className="transition-all duration-500"
              />
            ) : null;
          })}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-lg font-bold text-amber-100">{total}</span>
        </div>
      </div>
      <div className="flex gap-4 text-xs">
        {statuses.map(s => {
          const value = data[s.key] || 0;
          return value > 0 ? (
            <div key={s.key} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${s.color}`}></span>
              <span className="text-amber-700">{s.label}: {value}</span>
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

export default function JobAnalyticsPanel({ job, onExtend }: JobAnalyticsProps) {
  const [analytics, setAnalytics] = useState<JobAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [extending, setExtending] = useState(false);

  useEffect(() => {
    if (job) {
      setLoading(true);
      fetchJobAnalytics(job.id)
        .then(setAnalytics)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [job?.id]);

  const handleExtend = async () => {
    try {
      setExtending(true);
      await extendJobExpiry(job.id);
      onExtend?.();
    } catch (e) {
      console.error(e);
    } finally {
      setExtending(false);
    }
  };

  const daysUntilExpiry = job?.expiresAt ? Math.ceil((new Date(job.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 3 && daysUntilExpiry > 0;
  const isExpired = daysUntilExpiry !== null && daysUntilExpiry <= 0;

  if (!job) return null;

  return (
    <div className="space-y-6">
      {/* Expiry Banner */}
      {(isExpiringSoon || isExpired) && (
        <div className={clsx(
          "card p-4 flex items-center justify-between gap-4",
          isExpired ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20"
        )}>
          <div className="flex items-center gap-3">
            <span className={clsx(
              "w-3 h-3 rounded-full flex-shrink-0",
              isExpired ? "bg-red-400 animate-pulse" : "bg-amber-400 animate-pulse"
            )} />
            <div>
              <p className="font-medium text-amber-100">
                {isExpired ? "Job has expired" : `Job expires in ${daysUntilExpiry} day${daysUntilExpiry > 1 ? "s" : ""}`}
              </p>
              <p className="text-sm text-amber-700">{isExpired ? "No longer accepting applications" : "No freelancer hired yet"}</p>
            </div>
          </div>
          {!isExpired && job.status === "open" && (
            <button
              onClick={handleExtend}
              disabled={extending || job.extendedCount >= 3}
              className={clsx(
                "btn-secondary text-sm py-2 px-4 flex items-center gap-2",
                (extending || job.extendedCount >= 3) && "opacity-50 cursor-not-allowed"
              )}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {extending ? "Extending..." : `Extend 30 days (${3 - job.extendedCount} left)`}
            </button>
          )}
        </div>
      )}

      {/* Expiry Info Card */}
      <div className="card p-4">
        <h3 className="font-display text-sm font-semibold text-amber-100 mb-3">Job Timeline</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-xs text-amber-700 mb-1">Posted</p>
            <p className="font-mono text-sm text-amber-400">{new Date(job.createdAt).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-xs text-amber-700 mb-1">Expires</p>
            <p className={clsx(
              "font-mono text-sm",
              isExpired ? "text-red-400" : isExpiringSoon ? "text-amber-400" : "text-amber-400"
            )}>
              {new Date(job.expiresAt).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-amber-700 mb-1">Time Remaining</p>
            <p className={clsx(
              "font-mono text-sm",
              isExpired ? "text-red-400" : isExpiringSoon ? "text-amber-300" : "text-emerald-400"
            )}>
              {isExpired ? "Expired" : daysUntilExpiry !== null ? `${daysUntilExpiry} day${daysUntilExpiry !== 1 ? "s" : ""}` : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-amber-700 mb-1">Extended</p>
            <p className="font-mono text-sm text-emerald-400">{job.extendedCount || 0} / 3</p>
          </div>
        </div>
      </div>

      {/* Analytics Grid */}
      <div className="grid gap-6">
        {/* Applications Per Day */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-sm font-semibold text-amber-100">Applications Per Day</h3>
            {analytics?.applicationsPerDay && (
              <span className="text-xs text-amber-700">
                Total: {analytics.applicationsPerDay.reduce((a, b) => a + b.count, 0)}
              </span>
            )}
          </div>
          {loading ? (
            <div className="h-24 flex items-center justify-center">
              <div className="w-16 h-16 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            </div>
          ) : (
            <ApplicationsPerDayChart data={analytics?.applicationsPerDay || []} />
          )}
        </div>

        {/* Average Bid Amount */}
        <div className="card p-4">
          <h3 className="font-display text-sm font-semibold text-amber-100 mb-4">Average Bid Amount</h3>
          {loading ? (
            <div className="h-24 flex items-center justify-center">
              <div className="w-16 h-16 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            </div>
          ) : (
            <BidAmountChart data={analytics?.averageBidAmount || []} />
          )}
        </div>

        {/* Skill Distribution */}
        <div className="card p-4">
          <h3 className="font-display text-sm font-semibold text-amber-100 mb-4">Applicant Skills</h3>
          {loading ? (
            <div className="h-32 flex items-center justify-center">
              <div className="w-16 h-16 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            </div>
          ) : (
            <SkillDistributionChart data={analytics?.skillDistribution || {}} />
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Time to Hire */}
          <div className="card p-4">
            <h3 className="font-display text-sm font-semibold text-amber-100 mb-3">Time to Hire</h3>
            {loading ? (
              <div className="h-16 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="text-center">
                {analytics?.daysToHire !== null ? (
                  <>
                    <p className="font-display text-4xl font-bold text-emerald-400">
                      {analytics.daysToHire?.toFixed(1)}
                    </p>
                    <p className="text-xs text-amber-700 mt-1">days until hired</p>
                  </>
                ) : job.status === "open" ? (
                  <p className="text-sm text-amber-800">Not hired yet</p>
                ) : (
                  <p className="text-sm text-amber-800">N/A</p>
                )}
              </div>
            )}
          </div>

          {/* Application Status */}
          <div className="card p-4">
            <h3 className="font-display text-sm font-semibold text-amber-100 mb-3">Application Status</h3>
            {loading ? (
              <div className="h-16 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <StatusBreakdown data={analytics?.applicationStatusCounts || {}} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
