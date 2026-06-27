/**
 * pages/status.tsx
 * Public system status page (Issue #501).
 * No authentication required. Auto-refreshes every 60 s.
 */
import Head from "next/head";
import { useEffect, useRef, useState } from "react";
import {
  fetchHealthStatus,
  fetchHealthHistory,
  subscribeStatusAlerts,
  type HealthStatus,
} from "@/lib/api";

type HistoryMap = Record<string, { status: string; checkedAt: string }[]>;

const SERVICE_LABELS: Record<string, string> = {
  database:  "Database",
  stellar:   "Blockchain (Horizon)",
  ipfs:      "IPFS / Pinata",
};

function statusDot(status: string) {
  if (status === "ok")             return "bg-emerald-500";
  if (status === "not_configured") return "bg-amber-500";
  return "bg-red-500";
}

function statusText(status: string) {
  if (status === "ok")             return "Operational";
  if (status === "not_configured") return "Not configured";
  return "Degraded";
}

function historyColor(status: string) {
  if (status === "ok")             return "bg-emerald-500";
  if (status === "not_configured") return "bg-amber-400";
  return "bg-red-500";
}

export default function StatusPage() {
  const [health, setHealth]         = useState<HealthStatus | null>(null);
  const [history, setHistory]       = useState<HistoryMap>({});
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [email, setEmail]           = useState("");
  const [subState, setSubState]     = useState<"idle" | "sending" | "done" | "error">("idle");
  const intervalRef                 = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    try {
      const [h, hist] = await Promise.all([fetchHealthStatus(), fetchHealthHistory()]);
      setHealth(h);
      setHistory(hist);
      setLastChecked(new Date());
      setFetchError(false);
    } catch {
      setFetchError(true);
    }
  }

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSubState("sending");
    try {
      await subscribeStatusAlerts(email);
      setSubState("done");
    } catch {
      setSubState("error");
    }
  }

  const overallHealthy = health?.status === "healthy";

  return (
    <>
      <Head>
        <title>System Status — Stellar MarketPay</title>
        <meta name="description" content="Live system status for Stellar MarketPay" />
      </Head>

      <div className="min-h-screen bg-ink-900 text-market-100">
        <div className="max-w-4xl mx-auto px-4 py-12 animate-fade-in">

          {/* Header */}
          <div className="mb-10">
            <h1 className="text-3xl font-bold text-market-50 mb-1">System Status</h1>
            {lastChecked && (
              <p className="text-sm text-market-400">
                Last checked: {lastChecked.toLocaleTimeString()} · auto-refreshes every 60 s
              </p>
            )}
          </div>

          {/* Overall banner */}
          {fetchError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 mb-8">
              <p className="text-red-400 font-medium">Unable to reach the API. Check your connection.</p>
            </div>
          ) : health ? (
            <div
              className={[
                "rounded-xl border px-5 py-4 mb-8 flex items-center gap-3",
                overallHealthy
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-red-500/30 bg-red-500/10",
              ].join(" ")}
            >
              <span
                className={[
                  "w-3 h-3 rounded-full shrink-0",
                  overallHealthy ? "bg-emerald-400" : "bg-red-400",
                ].join(" ")}
              />
              <span className={overallHealthy ? "text-emerald-300 font-semibold" : "text-red-300 font-semibold"}>
                {overallHealthy ? "All systems operational" : "Partial outage detected"}
              </span>
            </div>
          ) : (
            <div className="rounded-xl border border-market-700/40 bg-market-900/40 px-5 py-4 mb-8 animate-pulse">
              <div className="h-4 w-48 rounded bg-market-700/40" />
            </div>
          )}

          {/* Service cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
            {["database", "stellar", "ipfs"].map((svc) => {
              const svcStatus =
                svc === "database" ? health?.database?.status
                : svc === "stellar"  ? health?.stellar?.status
                : health?.ipfs?.status;
              const detail =
                svc === "database" && health?.database?.latency_ms != null
                  ? `${health.database.latency_ms} ms`
                  : svc === "stellar" && health?.stellar?.ledger != null
                  ? `Ledger ${health.stellar.ledger}`
                  : undefined;

              return (
                <div
                  key={svc}
                  className="rounded-xl border border-market-700/40 bg-market-900/60 p-5"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={[
                        "w-2.5 h-2.5 rounded-full shrink-0",
                        svcStatus ? statusDot(svcStatus) : "bg-market-600",
                      ].join(" ")}
                    />
                    <span className="font-medium text-market-100 text-sm">
                      {SERVICE_LABELS[svc]}
                    </span>
                  </div>
                  <p className="text-xs text-market-400">
                    {svcStatus ? statusText(svcStatus) : "Checking…"}
                    {detail && ` · ${detail}`}
                  </p>
                </div>
              );
            })}
          </div>

          {/* API connectivity card (derives from successful fetch) */}
          <div className="rounded-xl border border-market-700/40 bg-market-900/60 p-5 mb-10">
            <div className="flex items-center gap-2 mb-2">
              <span
                className={[
                  "w-2.5 h-2.5 rounded-full shrink-0",
                  fetchError ? "bg-red-500" : health ? "bg-emerald-500" : "bg-market-600",
                ].join(" ")}
              />
              <span className="font-medium text-market-100 text-sm">API Server</span>
            </div>
            <p className="text-xs text-market-400">
              {fetchError ? "Unreachable" : health ? "Operational" : "Checking…"}
            </p>
          </div>

          {/* 90-day history dots */}
          {Object.keys(history).length > 0 && (
            <div className="mb-10">
              <h2 className="text-lg font-semibold text-market-100 mb-4">Uptime history</h2>
              <div className="space-y-4">
                {["database", "stellar", "ipfs"].map((svc) => {
                  const entries = history[svc] ?? [];
                  return (
                    <div key={svc}>
                      <p className="text-xs text-market-400 mb-1.5">{SERVICE_LABELS[svc]}</p>
                      <div className="flex gap-0.5 flex-wrap">
                        {entries.map((e, i) => (
                          <span
                            key={i}
                            title={`${new Date(e.checkedAt).toLocaleString()} — ${statusText(e.status)}`}
                            className={[
                              "w-2 h-2 rounded-sm",
                              historyColor(e.status),
                            ].join(" ")}
                          />
                        ))}
                        {entries.length === 0 && (
                          <span className="text-xs text-market-500">No history yet</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Subscribe form */}
          <div className="rounded-xl border border-market-700/40 bg-market-900/60 p-6">
            <h2 className="text-base font-semibold text-market-100 mb-1">
              Get status alerts
            </h2>
            <p className="text-sm text-market-400 mb-4">
              We'll email you when a service goes down or recovers.
            </p>

            {subState === "done" ? (
              <p className="text-emerald-400 text-sm">You're subscribed!</p>
            ) : (
              <form onSubmit={handleSubscribe} className="flex gap-3 flex-wrap">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="flex-1 min-w-0 rounded-lg border border-market-500/20 bg-ink-800 px-3 py-2 text-sm text-amber-100 placeholder:text-amber-900 focus:outline-none focus:border-market-500/40"
                />
                <button
                  type="submit"
                  disabled={subState === "sending"}
                  className="btn-primary text-sm py-2 px-4"
                >
                  {subState === "sending" ? "Subscribing…" : "Subscribe"}
                </button>
                {subState === "error" && (
                  <p className="w-full text-red-400 text-sm">Subscription failed. Try again.</p>
                )}
              </form>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
