/**
 * components/AdminApiKeyUsage.tsx
 *
 * Admin dashboard widget showing per-API-key usage stats powered by the
 * Redis sliding-window rate limiter introduced for issue #452. The card
 * pulls today's request count, the rolling 60-minute count, and a per-
 * endpoint breakdown for the most recent activity. It updates every
 * 30 s so an admin watching a noisy key can spot a spike without a hard
 * refresh.
 */
import { useEffect, useState } from "react";
import { fetchAdminApiKeyUsage } from "@/lib/api";
import type { ApiKeyUsageRow } from "@/lib/api";

interface AdminApiKeyUsageProps {
  publicKey: string | null;
}

export default function AdminApiKeyUsage({ publicKey }: AdminApiKeyUsageProps) {
  const [rows, setRows] = useState<ApiKeyUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lookback, setLookback] = useState(7);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!publicKey) return;

    let cancelled = false;

    const load = async () => {
      try {
        setError(null);
        const stats = await fetchAdminApiKeyUsage(lookback);
        if (!cancelled) {
          setRows(stats.keys);
          setLastUpdated(new Date());
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(
            err?.response?.data?.error || "Failed to load API key usage",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicKey, lookback]);

  const totalToday = rows.reduce((sum, r) => sum + Number(r.requests_today || 0), 0);
  const totalLastHour = rows.reduce((sum, r) => sum + Number(r.requests_last_hour || 0), 0);
  const activeKeys = rows.filter((r) => Number(r.requests_last_hour) > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-amber-100">
            API Key Usage
          </h2>
          <p className="text-sm text-amber-800 mt-1">
            Per-endpoint sliding-window counters (Redis + DB backup)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
            className="bg-market-800 border border-market-600 rounded-lg px-3 py-2 text-sm text-amber-100"
          >
            <option value={1}>Today</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          {lastUpdated && (
            <span className="text-xs text-amber-800">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Summary
          label="Requests today"
          value={totalToday.toLocaleString()}
          accent="amber"
        />
        <Summary
          label="Requests last hour"
          value={totalLastHour.toLocaleString()}
          accent="blue"
        />
        <Summary
          label="Active keys"
          value={String(activeKeys)}
          subtitle={`of ${rows.length} total`}
          accent="green"
        />
        <Summary
          label="Limits"
          value="60/min"
          subtitle="public_jobs default"
          accent="red"
        />
      </div>

      {error && (
        <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-amber-800">
          No active API keys yet. Usage will appear here once developers
          authenticate against the public API.
        </div>
      ) : (
        <div className="bg-market-800 rounded-lg border border-market-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-market-700/50 text-amber-200">
              <tr>
                <th className="text-left py-3 px-4 font-medium">Label</th>
                <th className="text-left py-3 px-4 font-medium">Prefix</th>
                <th className="text-right py-3 px-4 font-medium">Today</th>
                <th className="text-right py-3 px-4 font-medium">Last hour</th>
                <th className="text-left py-3 px-4 font-medium">
                  Top endpoints
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-market-700/60 hover:bg-market-700/30"
                >
                  <td className="py-3 px-4 text-amber-100">{row.label}</td>
                  <td className="py-3 px-4 font-mono text-amber-800">
                    {row.key_prefix}…
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-amber-100">
                    {Number(row.requests_today).toLocaleString()}
                  </td>
                  <td
                    className={`py-3 px-4 text-right tabular-nums ${
                      Number(row.requests_last_hour) > 600
                        ? "text-red-400"
                        : "text-amber-100"
                    }`}
                  >
                    {Number(row.requests_last_hour).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {row.endpoint_breakdown.length === 0 ? (
                      <span className="text-amber-800">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {row.endpoint_breakdown
                          .slice(0, 4)
                          .map((ep) => (
                            <span
                              key={`${row.id}-${ep.endpoint}-${ep.lastMinute}`}
                              className="px-2 py-0.5 rounded-full bg-market-700 text-amber-200 font-mono"
                              title={`${ep.requests} requests on ${ep.endpoint}`}
                            >
                              {normalizeEndpoint(ep.endpoint)} · {ep.requests}
                            </span>
                          ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  subtitle,
  accent = "blue",
}: {
  label: string;
  value: string;
  subtitle?: string;
  accent?: "blue" | "green" | "amber" | "red";
}) {
  const accentMap = {
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
  };
  return (
    <div className={`p-4 rounded-lg border ${accentMap[accent]}`}>
      <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-2xl font-display font-bold mt-1">{value}</p>
      {subtitle && <p className="text-xs opacity-70 mt-1">{subtitle}</p>}
    </div>
  );
}

function normalizeEndpoint(raw: string) {
  // Trim trailing slash + collapse long paths for compactness
  return raw.replace(/^\/api\//, "").replace(/\/$/, "") || raw;
}
