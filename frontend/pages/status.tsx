/**
 * Public system status page.
 * Status endpoints refresh every 60 seconds and on focus/reconnect.
 */
import Head from "next/head";
import { useEffect, useState } from "react";
import { useApi } from "@/hooks/useApi";
import {
  fetchHealthStatus,
  fetchIndexerHealth,
  subscribeStatusAlerts,
  type HealthStatus,
  type IndexerHealth,
} from "@/lib/api";
import DegradedStatusBanner from "@/components/DegradedStatusBanner";

const REFRESH_INTERVAL_MS = 60_000;
const INDEXER_LAG_WARNING_THRESHOLD = 5;
const RECONNECT_INTERVAL_MS = 10_000;

type TileStatus =
  | "operational"
  | "degraded"
  | "warning"
  | "unavailable"
  | "checking"
  | "unknown";

interface Checked<T> {
  value: T;
  checkedAt: string;
}

const STATUS_LABELS: Record<TileStatus, string> = {
  operational: "Operational",
  degraded: "Degraded",
  warning: "Warning",
  unavailable: "Unavailable",
  checking: "Checking…",
  unknown: "Unknown",
};

const STATUS_COLORS: Record<TileStatus, string> = {
  operational: "bg-emerald-500",
  degraded: "bg-red-500",
  warning: "bg-amber-500",
  unavailable: "bg-red-500",
  checking: "bg-market-600",
  unknown: "bg-market-600",
};

function normalizeStatus(status: unknown): TileStatus {
  const value =
    typeof status === "string"
      ? status.toLowerCase()
      : status && typeof status === "object" && "status" in status
        ? String(status.status).toLowerCase()
        : "";

  if (value === "up" || value === "ok" || value === "healthy") {
    return "operational";
  }
  if (value === "not_configured" || value === "starting" || value === "syncing") {
    return "warning";
  }
  if (value === "down" || value === "error" || value === "degraded") {
    return "degraded";
  }
  return "unknown";
}

function getLedgerNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function StatusTile({
  title,
  status,
  detail,
  checkedAt,
  stale = false,
}: {
  title: string;
  status: TileStatus;
  detail?: string;
  checkedAt?: string;
  stale?: boolean;
}) {
  const checkedTime = checkedAt
    ? new Date(checkedAt).toLocaleTimeString()
    : null;

  return (
    <section
      aria-label={`${title} status`}
      className="rounded-xl border border-market-700/40 bg-market-900/60 p-5"
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_COLORS[status]}`}
        />
        <h2 className="font-medium text-market-100 text-sm">{title}</h2>
      </div>
      <p className="text-sm text-market-200">{STATUS_LABELS[status]}</p>
      {detail && <p className="mt-1 text-xs text-market-400">{detail}</p>}
      <p className="mt-3 text-xs text-market-500">
        {checkedTime
          ? `${stale ? "Last successful check" : "Last checked"}: ${checkedTime}`
          : "Last checked: not yet"}
      </p>
    </section>
  );
}

async function loadHealth(): Promise<Checked<HealthStatus>> {
  return { value: await fetchHealthStatus(), checkedAt: new Date().toISOString() };
}

async function loadIndexerHealth(): Promise<Checked<IndexerHealth>> {
  return { value: await fetchIndexerHealth(), checkedAt: new Date().toISOString() };
}

export default function StatusPage() {
  const health = useApi<Checked<HealthStatus>>("/health", loadHealth, {
    refreshInterval: REFRESH_INTERVAL_MS,
  });
  const indexer = useApi<Checked<IndexerHealth>>(
    "/api/indexer/health",
    loadIndexerHealth,
    { refreshInterval: REFRESH_INTERVAL_MS },
  );
  const [wsStatus, setWsStatus] = useState<TileStatus>("checking");
  const [wsCheckedAt, setWsCheckedAt] = useState<string>();
  const [email, setEmail] = useState("");
  const [subState, setSubState] =
    useState<"idle" | "sending" | "done" | "error">("idle");

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleReconnect() {
      if (!active) return;
      setWsStatus("unavailable");
      setWsCheckedAt(new Date().toISOString());
      reconnectTimer = setTimeout(connect, RECONNECT_INTERVAL_MS);
    }

    function connect() {
      if (!active) return;

      try {
        const baseUrl =
          process.env.NEXT_PUBLIC_API_URL || window.location.origin;
        const url = new URL("/ws/realtime", baseUrl);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(url.toString());
      } catch {
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (active) {
          setWsStatus("operational");
          setWsCheckedAt(new Date().toISOString());
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = scheduleReconnect;
    }

    connect();
    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  async function handleSubscribe(event: React.FormEvent) {
    event.preventDefault();
    if (!email) return;
    setSubState("sending");
    try {
      await subscribeStatusAlerts(email);
      setSubState("done");
    } catch {
      setSubState("error");
    }
  }

  const healthData = health.data;
  const indexerData = indexer.data;
  const lastProcessedLedger = getLedgerNumber(
    indexerData?.value.indexer.lastProcessedLedger,
  );
  const currentLedger = getLedgerNumber(indexerData?.value.currentLedger);
  const ledgerLag =
    currentLedger !== null && lastProcessedLedger !== null
      ? currentLedger - lastProcessedLedger
      : null;
  const validLedgerLag = ledgerLag !== null && ledgerLag >= 0 ? ledgerLag : null;
  const healthDegraded =
    health.error !== undefined ||
    (healthData !== undefined && healthData.value.status !== "healthy");
  const indexerUnavailable =
    indexer.error !== undefined ||
    (indexerData !== undefined && currentLedger === null);
  const indexerServiceDegraded =
    indexerData !== undefined &&
    (!indexerData.value.indexer.running ||
      !indexerData.value.indexer.synced ||
      Boolean(indexerData.value.indexer.lastError));
  const ledgerDataInconsistent =
    indexerData !== undefined &&
    currentLedger !== null &&
    lastProcessedLedger !== null &&
    validLedgerLag === null;
  const lagWarning =
    validLedgerLag !== null &&
    validLedgerLag > INDEXER_LAG_WARNING_THRESHOLD;
  const degraded =
    healthDegraded ||
    indexerUnavailable ||
    indexerServiceDegraded ||
    ledgerDataInconsistent ||
    lagWarning ||
    wsStatus === "unavailable";

  let degradedMessage = "One or more services are not operating normally.";
  if (health.error) {
    degradedMessage = "The backend health endpoint is unreachable.";
  } else if (healthData && healthData.value.status !== "healthy") {
    degradedMessage = "The backend reports one or more degraded dependencies.";
  } else if (indexerUnavailable) {
    degradedMessage = "Indexer health or current-ledger data is unavailable.";
  } else if (ledgerDataInconsistent) {
    degradedMessage = "Indexer ledger data is inconsistent.";
  } else if (indexerServiceDegraded) {
    degradedMessage = "The indexer is stopped or has not finished syncing.";
  } else if (lagWarning) {
    degradedMessage = `The indexer is more than ${INDEXER_LAG_WARNING_THRESHOLD} ledgers behind.`;
  } else if (wsStatus === "unavailable") {
    degradedMessage = "WebSocket connectivity is unavailable.";
  }

  const apiStatus: TileStatus = health.error
    ? "unavailable"
    : healthData
      ? "operational"
      : "checking";

  const indexerStatus: TileStatus = indexer.error
    ? "unavailable"
    : !indexerData
      ? "checking"
      : currentLedger === null
        ? "unavailable"
        : lastProcessedLedger === null
          ? "warning"
          : validLedgerLag === null
            ? "degraded"
            : lagWarning
              ? "warning"
              : indexerData.value.indexer.synced
                ? "operational"
                : "warning";

  const indexerDetail =
    indexer.error || !indexerData
      ? undefined
      : currentLedger === null
        ? "Current ledger unavailable"
        : lastProcessedLedger === null
          ? "Waiting for the first indexed ledger"
          : validLedgerLag === null
            ? "Indexer ledger data is inconsistent"
            : `${validLedgerLag} ledger${validLedgerLag === 1 ? "" : "s"} behind` +
              (lagWarning
                ? ` (warning above ${INDEXER_LAG_WARNING_THRESHOLD})`
                : "");

  return (
    <>
      <Head>
        <title>System Status — Stellar MarketPay</title>
        <meta
          name="description"
          content="Live system status for Stellar MarketPay"
        />
      </Head>

      <div className="min-h-screen bg-ink-900 text-market-100">
        <main className="max-w-4xl mx-auto px-4 py-12 animate-fade-in">
          <header className="mb-8">
            <h1 className="text-3xl font-bold text-market-50 mb-1">
              System Status
            </h1>
            <p className="text-sm text-market-400">
              Live component health · auto-refreshes every 60 seconds
            </p>
          </header>

          {degraded && (
            <DegradedStatusBanner
              title="Some services are degraded"
              message={degradedMessage}
            />
          )}

          <div className="grid grid-cols-1 gap-4 mb-10 sm:grid-cols-2 lg:grid-cols-3">
            <StatusTile
              title="API"
              status={apiStatus}
              detail={
                healthData && healthData.value.status !== "healthy"
                  ? "Backend responded; dependency checks are degraded"
                  : health.error
                    ? "Unable to reach the backend"
                    : undefined
              }
              checkedAt={healthData?.checkedAt}
              stale={health.error !== undefined && healthData !== undefined}
            />
            <StatusTile
              title="Database"
              status={
                health.error && !healthData
                  ? "unavailable"
                  : healthData
                    ? normalizeStatus(healthData.value.database)
                    : "checking"
              }
              detail={
                health.error && healthData
                  ? "Showing the last reported status"
                  : undefined
              }
              checkedAt={healthData?.checkedAt}
              stale={health.error !== undefined && healthData !== undefined}
            />
            <StatusTile
              title="Redis"
              status={
                health.error && !healthData
                  ? "unavailable"
                  : healthData
                    ? normalizeStatus(healthData.value.redis)
                    : "checking"
              }
              detail={
                health.error && healthData
                  ? "Showing the last reported status"
                  : undefined
              }
              checkedAt={healthData?.checkedAt}
              stale={health.error !== undefined && healthData !== undefined}
            />
            <StatusTile
              title="Indexer lag"
              status={indexerStatus}
              detail={indexerDetail}
              checkedAt={indexerData?.checkedAt}
              stale={indexer.error !== undefined && indexerData !== undefined}
            />
            <StatusTile
              title="WebSocket"
              status={wsStatus}
              detail={
                wsStatus === "unavailable"
                  ? "Reconnecting automatically"
                  : undefined
              }
              checkedAt={wsCheckedAt}
            />
          </div>

          <section className="rounded-xl border border-market-700/40 bg-market-900/60 p-6">
            <h2 className="text-base font-semibold text-market-100 mb-1">
              Get status alerts
            </h2>
            <p className="text-sm text-market-400 mb-4">
              We&apos;ll email you when a service goes down or recovers.
            </p>
            {subState === "done" ? (
              <p className="text-emerald-400 text-sm">You&apos;re subscribed!</p>
            ) : (
              <form onSubmit={handleSubscribe} className="flex gap-3 flex-wrap">
                <label className="sr-only" htmlFor="status-alert-email">
                  Email address
                </label>
                <input
                  id="status-alert-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
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
                  <p role="alert" className="w-full text-red-400 text-sm">
                    Subscription failed. Try again.
                  </p>
                )}
              </form>
            )}
          </section>
        </main>
      </div>
    </>
  );
}
