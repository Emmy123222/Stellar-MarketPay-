import axios from "axios";
import { api } from "./client";
import type {
  ClientReputation,
  Availability,
  UserProfile,
  PriceAlertPreference,
  ClientSpendingAnalytics,
  PortfolioFile,
  ProfileStats,
  ResponseTime,
} from "@/utils/types";

export async function fetchProfile(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: UserProfile }>(
    `/api/profiles/${publicKey}`,
  );
  return data.data;
}

export async function fetchProfileResponseTime(publicKey: string) {
  const { data } = await api.get<{
    success: boolean;
    data: { averageDays: number | null };
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/response-time`);
  return data.data;
}

export async function fetchPublicProfile(
  publicKey: string,
): Promise<UserProfile | null> {
  try {
    const { data } = await api.get<{ success: boolean; data: UserProfile }>(
      `/api/profiles/${encodeURIComponent(publicKey)}`,
    );
    return data.data;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) return null;
    throw e;
  }
}

export async function fetchProfiles(params?: {
  role?: string;
  availability?: string;
  search?: string;
  limit?: number;
  after?: string;
}) {
  const { data } = await api.get<{
    success: boolean;
    data: UserProfile[];
    next_cursor: string | null;
    has_more: boolean;
  }>("/api/profiles", { params });
  return {
    profiles: data.data,
    nextCursor: data.next_cursor ?? null,
    hasMore: data.has_more ?? false,
  };
}

export async function syncOnboardingProgress(payload: {
  publicKey: string;
  currentStep: number;
  completedSteps: string[];
  dismissed: boolean;
  completed: boolean;
}) {
  const { data } = await api.patch<{ success: boolean; data?: unknown }>(
    "/api/onboarding",
    payload,
  );
  return data;
}

export async function searchFreelancers(params?: { search?: string; limit?: number }) {
  const { data } = await api.get<{ success: boolean; data: UserProfile[] }>(
    "/api/freelancers",
    { params },
  );
  return data.data;
}

export async function fetchProfileStats(publicKey: string): Promise<ProfileStats> {
  const { data } = await api.get<{ success: boolean; data: ProfileStats }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/stats`,
  );
  return data.data;
}

export async function fetchResponseTime(publicKey: string): Promise<ResponseTime> {
  const { data } = await api.get<{ success: boolean; data: ResponseTime }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/response-time`,
  );
  return data.data;
}

export async function upsertProfile(
  payload: Partial<UserProfile> & { publicKey: string },
) {
  const { data } = await api.post<{ success: boolean; data: UserProfile }>(
    "/api/profiles",
    payload,
  );
  return data.data;
}

export async function updateProfileAvailability(
  publicKey: string,
  payload: Availability,
) {
  const { data } = await api.post<{ success: boolean; data: UserProfile }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/availability`,
    payload,
  );
  return data.data;
}

/**
 * Verifies a user's identity via a DID provider and stores the resulting credential hash.
 *
 * @param publicKey User Stellar public key.
 * @param didHash The credential hash/DID URI returned by the provider.
 * @returns The updated profile.
 */
export async function verifyIdentity(publicKey: string, didHash: string) {
  const { data } = await api.post<{ success: boolean; data: UserProfile }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/verify`,
    { didHash },
  );
  return data.data;
}

export async function fetchPriceAlertPreference(publicKey: string) {
  const { data } = await api.get<{
    success: boolean;
    data: PriceAlertPreference | null;
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/price-alerts`);
  return data.data;
}

export async function upsertPriceAlertPreference(
  publicKey: string,
  payload: {
    minXlmPriceUsd?: number | null;
    maxXlmPriceUsd?: number | null;
    emailNotificationsEnabled?: boolean;
    email?: string;
  },
) {
  const { data } = await api.post<{
    success: boolean;
    data: PriceAlertPreference;
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/price-alerts`, payload);
  return data.data;
}

export async function fetchClientSpendingAnalytics(publicKey: string) {
  const { data } = await api.get<{
    success: boolean;
    data: ClientSpendingAnalytics;
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/spending`);
  return data.data;
}

export async function fetchClientReputation(publicKey: string): Promise<ClientReputation> {
  const { data } = await api.get<{ success: boolean; data: ClientReputation }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/client-reputation`
  );
  return data.data;
}

// ─── IPFS File Upload (Issue #202) ──────────────────────────────────────────

export async function uploadPortfolioFiles(
  publicKey: string,
  files: FileList | File[],
  onProgress?: (fileIndex: number, percent: number) => void,
) {
  const formData = new FormData();
  const filesArr = Array.from(files);
  filesArr.forEach((file) => {
    formData.append("files", file);
  });

  const { data } = await api.post<{
    success: boolean;
    data: {
      uploadedFiles: PortfolioFile[];
      gatewayUrls: string[];
    };
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/portfolio-files`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
    timeout: 120000,
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        const overallPercent = Math.round((e.loaded / e.total) * 100);
        filesArr.forEach((_, i) => onProgress(i, overallPercent));
      }
    },
  });

  return data.data;
}

// ─── Earnings (Issue #181) ────────────────────────────────────────────────────

export interface EarningPayment {
  id: string;
  jobId: string;
  jobTitle: string;
  amountXlm: string;
  releasedAt: string;
  clientAddress: string;
}

export interface MonthlyEarning {
  month: string; // "YYYY-MM"
  totalXlm: number;
}

export interface EarningsData {
  totalXlm: string;
  totalUsdc?: string;
  payments: EarningPayment[];
  monthly: MonthlyEarning[];
}

export async function fetchFreelancerEarnings(
  publicKey: string,
): Promise<EarningsData> {
  const { data } = await api.get<{ success: boolean; data: EarningsData }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/earnings`,
  );
  return data.data;
}

// ── Encryption key (#498) ─────────────────────────────────────────────────

export async function fetchRecipientEncryptionKey(
  publicKey: string,
): Promise<string | null> {
  const { data } = await api.get<{
    success: boolean;
    data: { encryptionPublicKey: string | null };
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/encryption-key`);
  return data.data.encryptionPublicKey;
}

export async function publishMyEncryptionKey(
  userPublicKey: string,
  naclPublicKey: string,
): Promise<void> {
  await api.put(`/api/profiles/${encodeURIComponent(userPublicKey)}/encryption-key`, {
    encryptionPublicKey: naclPublicKey,
  });
}
