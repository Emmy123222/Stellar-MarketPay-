import axios from "axios";
import type { Availability, Job, Application, UserProfile, Rating } from "@/utils/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
  timeout: 10000,
});

let jwtToken: string | null = null;

export function setJwtToken(token: string | null) {
  jwtToken = token;
}

export function getJwtToken() {
  return jwtToken;
}

api.interceptors.request.use((config: any) => {
  if (jwtToken) {
    config.headers.Authorization = `Bearer ${jwtToken}`;
  }
  return config;
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function fetchAuthChallenge(publicKey: string) {
  const { data } = await api.get<{ transaction: string }>(`/api/auth?account=${publicKey}`);
  return data.transaction;
}

export async function verifyAuthChallenge(transaction: string) {
  const { data } = await api.post<{ success: boolean; token: string }>("/api/auth", { transaction });
  return data.token;
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export async function fetchJobs(params?: {
  category?: string;
  status?: string;
  limit?: number;
  search?: string;
  cursor?: string;
  timezone?: string;
}) {
  const { data } = await api.get<{
    success: boolean;
    data: Job[];
    nextCursor: string | null;
  }>("/api/jobs", { params });

  return {
    jobs: data.data,
    nextCursor: data.nextCursor ?? null,
  };
}

export async function fetchRelatedJobs(category: string, currentJobId: string) {
  const { jobs } = await fetchJobs({
    category,
    status: "open",
    limit: 4,
  });

  return jobs
    .filter((job) => job.id !== currentJobId)
    .slice(0, 3);
}

export async function fetchRecentlyCompletedJobs(limit = 3): Promise<Job[]> {
  const { jobs } = await fetchJobs({ status: "completed", limit });
  return jobs;
}

export async function fetchJob(id: string) {
  const { data } = await api.get<{ success: boolean; data: Job }>(`/api/jobs/${id}`);
  return data.data;
}

export async function createJob(payload: {
  title: string;
  description: string;
  budget: string;
  category: string;
  skills: string[];
  deadline?: string;
  timezone?: string;
  clientAddress: string;
  screeningQuestions?: string[];
}) {
  const { data } = await api.post<{ success: boolean; data: Job }>("/api/jobs", payload);
  return data.data;
}

export async function fetchMyJobs(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Job[] }>(`/api/jobs/client/${publicKey}`);
  return data.data;
}

// ─── Applications ─────────────────────────────────────────────────────────────

export async function fetchApplications(jobId: string) {
  const { data } = await api.get<{ success: boolean; data: Application[] }>(
    `/api/applications/job/${jobId}`
  );
  return data.data;
}

export async function submitApplication(payload: {
  jobId: string;
  freelancerAddress: string;
  proposal: string;
  bidAmount: string;
  currency: string;
}) {
  const { data } = await api.post<{ success: boolean; data: Application }>(
    "/api/applications",
    payload
  );
  return data.data;
}

export async function acceptApplication(applicationId: string, clientAddress: string) {
  const { data } = await api.post(`/api/applications/${applicationId}/accept`, {
    clientAddress,
  });
  return data.data;
}

export async function fetchMyApplications(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Application[] }>(
    `/api/applications/freelancer/${publicKey}`
  );
  return data.data;
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function fetchProfile(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: UserProfile }>(
    `/api/profiles/${publicKey}`
  );
  return data.data;
}

export async function fetchPublicProfile(publicKey: string): Promise<UserProfile | null> {
  try {
    const { data } = await api.get<{ success: boolean; data: UserProfile }>(
      `/api/profiles/${encodeURIComponent(publicKey)}`
    );
    return data.data;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) return null;
    throw e;
  }
}

export async function upsertProfile(payload: Partial<UserProfile> & { publicKey: string }) {
  const { data } = await api.post<{ success: boolean; data: UserProfile }>(
    "/api/profiles",
    payload
  );
  return data.data;
}

export async function updateProfileAvailability(publicKey: string, payload: Availability) {
  const { data } = await api.post<{ success: boolean; data: UserProfile }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/availability`,
    payload
  );
  return data.data;
}

// ─── Escrow ───────────────────────────────────────────────────────────────────

export async function releaseEscrow(
  jobId: string,
  clientAddress: string,
  contractTxHash?: string
) {
  const { data } = await api.post(`/api/escrow/${jobId}/release`, {
    clientAddress,
    ...(contractTxHash ? { contractTxHash } : {}),
  });
  return data.data;
}

export async function updateJobEscrowId(jobId: string, escrowContractId: string) {
  const { data } = await api.patch<{ success: boolean; data: Job }>(
    `/api/jobs/${jobId}/escrow`,
    { escrowContractId }
  );
  return data.data;
}

export async function deleteJob(jobId: string) {
  await api.delete(`/api/jobs/${jobId}`);
}

// ─── Ratings ──────────────────────────────────────────────────────────────────

export async function submitRating(payload: {
  jobId: string;
  ratedAddress: string;
  stars: number;
  review?: string;
}) {
  const { data } = await api.post<{ success: boolean; data: Rating }>("/api/ratings", payload);
  return data.data;
}

export async function fetchRatings(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Rating[] }>(
    `/api/ratings/${publicKey}`
  );
  return data.data;
}