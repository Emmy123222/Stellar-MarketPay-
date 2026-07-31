import { api } from "./client";

export interface HealthStatus {
  status: "healthy" | "degraded";
  database: { status: string; latency_ms?: number; message?: string };
  stellar: { status: string; network?: string; ledger?: number; message?: string };
  ipfs: { status: string; message?: string };
  uptime_seconds: number;
  version: string;
}

export async function fetchHealthStatus(): Promise<HealthStatus> {
  const { data } = await api.get<HealthStatus>("/health");
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
