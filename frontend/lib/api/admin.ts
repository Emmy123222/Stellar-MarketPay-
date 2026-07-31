import { api } from "./client";
import type { AuditLogEntry } from "@/utils/types";

// ─── Admin 2FA ────────────────────────────────────────────────────────────────

export async function fetchAdmin2FAStatus() {
  const { data } = await api.get<{
    success: boolean;
    data: { totp_enabled: boolean; verified: boolean };
  }>("/api/admin/2fa/status");
  return data.data;
}

export async function setupAdmin2FA() {
  const { data } = await api.post<{
    success: boolean;
    data: { qrCode: string; manualEntryKey: string };
  }>("/api/admin/2fa/setup");
  return data.data;
}

export async function verifyAdmin2FA(token: string, setup = false) {
  const { data } = await api.post<{
    success: boolean;
    token?: string;
    data: { backupCodes?: string[]; message?: string };
  }>("/api/admin/2fa/verify", { token, setup });
  return { token: data.token, backupCodes: data.data?.backupCodes, message: data.data?.message };
}

// ─── Admin Functions ──────────────────────────────────────────────────────────

export async function fetchAdminMetrics(period: "7d" | "30d" | "90d" = "30d") {
  const { data } = await api.get<{
    success: boolean;
    data: {
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
      disputeMetrics: Array<{
        week: string;
        disputes_opened: number;
        disputes_resolved: number;
      }>;
      topEarners: Array<{
        public_key: string;
        display_name: string;
        total_earned_xlm: number;
        completed_jobs: number;
        rating: number;
      }>;
      jobVolume: Array<{
        date: string;
        jobs_created: number;
        jobs_completed: number;
      }>;
    };
  }>("/api/admin/metrics", { params: { period } });
  return data.data;
}

export async function fetchAdminJobReports() {
  const { data } = await api.get<{ success: boolean; data: any[] }>(
    "/api/admin/reports/jobs",
  );
  return data.data;
}

export async function fetchAdminDisputes() {
  const { data } = await api.get<{ success: boolean; data: any[] }>(
    "/api/admin/disputes",
  );
  return data.data;
}

export async function fetchAdminLogs() {
  const { data } = await api.get<{ success: boolean; data: any[] }>(
    "/api/admin/logs",
  );
  return data.data;
}

export async function fetchAuditLogs(params?: {
  action?: string;
  resource_type?: string;
  from?: string;
  to?: string;
  limit?: number;
  after?: string;
}) {
  const { data } = await api.get<{
    success: boolean;
    data: AuditLogEntry[];
    nextCursor: string | null;
  }>("/api/audit", {
    params,
  });
  return { logs: data.data, nextCursor: data.nextCursor };
}

export async function fetchFrozenWallets() {
  const { data } = await api.get<{ success: boolean; data: any[] }>(
    "/api/admin/wallets/frozen",
  );
  return data.data;
}

export async function adminCancelJob(jobId: string, reason: string) {
  const { data } = await api.patch<{ success: boolean; message: string }>(
    `/api/admin/jobs/${jobId}/cancel`,
    { reason },
  );
  return data;
}

export async function freezeWallet(address: string, reason: string) {
  const { data } = await api.post<{ success: boolean; message: string }>(
    `/api/admin/wallets/${address}/freeze`,
    { reason },
  );
  return data;
}

export async function unfreezeWallet(address: string) {
  const { data } = await api.delete<{ success: boolean; message: string }>(
    `/api/admin/wallets/${address}/freeze`,
  );
  return data;
}

// ─── Admin Cost Report & Time-Series (Issues #569, #561) ──────────────────────

export async function fetchCostReport() {
  const { data } = await api.get<{ success: boolean; data: any }>(
    "/api/admin/cost-report",
  );
  return data.data;
}

export async function generateCostReport() {
  const { data } = await api.post<{ success: boolean; message: string }>(
    "/api/admin/cost-report/generate",
  );
  return data;
}

export interface TimeSeriesMetric {
  metric_name: string;
  value: number;
  granularity: string;
  bucket: string;
}

export async function fetchTimeSeriesMetrics(params: {
  metric: string;
  from?: string;
  to?: string;
  granularity?: string;
}): Promise<TimeSeriesMetric[]> {
  const { data } = await api.get<{ success: boolean; data: TimeSeriesMetric[] }>(
    "/api/admin/metrics/time-series",
    { params },
  );
  return data.data;
}

// ─── Admin API Key Usage Stats (Issue #452) ───────────────────────────────────

export interface ApiKeyUsageEndpoint {
  endpoint: string;
  requests: number;
  lastMinute: string;
}

export interface ApiKeyUsageRow {
  id: number;
  label: string;
  key_prefix: string;
  requests_today: number;
  requests_last_hour: number;
  endpoint_breakdown: ApiKeyUsageEndpoint[];
}

export interface ApiKeyUsageStats {
  lookbackDays: number;
  keys: ApiKeyUsageRow[];
}

/**
 * Fetch per-API-key usage statistics for the admin dashboard (Issue #452).
 * Each row includes today's request count, the rolling 60-minute request
 * count, and a per-endpoint breakdown for the most recent activity.
 */
export async function fetchAdminApiKeyUsage(
  days = 7,
): Promise<ApiKeyUsageStats> {
  const { data } = await api.get<{ success: boolean; data: ApiKeyUsageStats }>(
    "/api/admin/api-keys/usage",
    { params: { days } },
  );
  return data.data;
}
