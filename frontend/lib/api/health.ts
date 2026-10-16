import { api } from "./client";

export interface HealthStatus {
  status: "healthy" | "degraded";
  database: string | { status: string; latency_ms?: number; message?: string };
  redis: string | { status: string; message?: string };
  stellar?: string | { status: string; network?: string; ledger?: number; message?: string };
  ipfs?: { status: string; message?: string };
  uptime_seconds: number;
  version: string;
  indexer?: {
    running: boolean;
    synced: boolean;
    lastProcessedLedger: number | string | null;
    lastTransactionAt: string | null;
    lastError: string | null;
  } | null;
}

export interface IndexerHealth {
  status: "ok" | "degraded";
  indexer: {
    running: boolean;
    synced: boolean;
    lastProcessedLedger: number | string | null;
    lastTransactionAt: string | null;
    lastError: string | null;
  };
  currentLedger: number | null;
}

export async function fetchHealthStatus(): Promise<HealthStatus> {
  const { data } = await api.get<HealthStatus>("/health", {
    validateStatus: (status) => (status >= 200 && status < 300) || status === 503,
  });
  return data;
}

export async function fetchIndexerHealth(): Promise<IndexerHealth> {
  const { data } = await api.get<IndexerHealth>("/api/indexer/health", {
    validateStatus: (status) => (status >= 200 && status < 300) || status === 503,
  });
  return data;
}

export async function fetchHealthHistory(): Promise<
  Record<string, { status: string; checkedAt: string }[]>
> {
  const { data } = await api.get<{
    success: boolean;
    data: Record<string, { status: string; checkedAt: string }[]>;
  }>("/health/history");
  return data.data;
}

export async function subscribeStatusAlerts(email: string): Promise<void> {
  await api.post("/health/subscribe", { email });
}
