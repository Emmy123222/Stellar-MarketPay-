/**
 * lib/api.ts
 * HTTP client for the MarketPay backend API.
 */

import axios from "axios";
import type { Job, Application, UserProfile } from "@/utils/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export async function fetchJobs(params?: { category?: string; status?: string; limit?: number }) {
  const { data } = await api.get<{ success: boolean; data: Job[] }>("/api/jobs", { params });
  return data.data;
}

export async function fetchJob(id: string) {
  const { data } = await api.get<{ success: boolean; data: Job }>(`/api/jobs/${id}`);
  return data.data;
}

export async function createJob(payload: {
  title: string; description: string; budget: string;
  category: string; skills: string[]; deadline?: string;
  clientAddress: string;
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
  const { data } = await api.get<{ success: boolean; data: Application[] }>(`/api/applications/job/${jobId}`);
  return data.data;
}

export async function submitApplication(payload: {
  jobId: string; freelancerAddress: string; proposal: string; bidAmount: string;
}) {
  const { data } = await api.post<{ success: boolean; data: Application }>("/api/applications", payload);
  return data.data;
}

export async function acceptApplication(applicationId: string, clientAddress: string) {
  const { data } = await api.post(`/api/applications/${applicationId}/accept`, { clientAddress });
  return data.data;
}

export async function fetchMyApplications(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Application[] }>(`/api/applications/freelancer/${publicKey}`);
  return data.data;
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function fetchProfile(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: UserProfile }>(`/api/profiles/${publicKey}`);
  return data.data;
}

export async function upsertProfile(payload: Partial<UserProfile> & { publicKey: string }) {
  const { data } = await api.post<{ success: boolean; data: UserProfile }>("/api/profiles", payload);
  return data.data;
}

// ─── Escrow ───────────────────────────────────────────────────────────────────

export async function releaseEscrow(jobId: string, clientAddress: string) {
  const { data } = await api.post(`/api/escrow/${jobId}/release`, { clientAddress });
  return data.data;
}
