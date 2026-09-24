import { api } from "./client";
import type { Application } from "@/utils/types";

export async function fetchApplicationsPage(jobId: string, tier?: string, cursor?: string, limit = 20) {
  const { data } = await api.get<{
    success: boolean;
    data: Application[];
    applications?: Application[];
    nextCursor: string | null;
  }>(
    `/api/applications/job/${jobId}`,
    { params: { ...(tier ? { tier } : {}), limit, ...(cursor ? { cursor } : {}) } },
  );
  return { applications: data.applications ?? data.data, nextCursor: data.nextCursor };
}

export async function fetchApplications(jobId: string, tier?: string) {
  return (await fetchApplicationsPage(jobId, tier)).applications;
}

export async function submitApplication(payload: {
  jobId: string;
  freelancerAddress: string;
  proposal: string;
  bidAmount: string;
  currency: string;
  bidCommitment?: string;
  bidNonce?: string;
  screeningAnswers?: Record<string, string>;
  referredBy?: string;
}) {
  const { data } = await api.post<{ success: boolean; data: Application }>(
    "/api/applications",
    payload,
  );
  return data.data;
}

export async function closeBidding(jobId: string, clientAddress: string) {
  const { data } = await api.post(`/api/applications/job/${jobId}/close-bidding`, {
    clientAddress,
  });
  return data.data;
}

export async function revealApplicationBid(
  applicationId: string,
  payload: { freelancerAddress: string; bidAmount: string; nonce: string },
) {
  const { data } = await api.post(`/api/applications/${applicationId}/reveal`, payload);
  return data.data;
}

export async function acceptApplication(
  applicationId: string,
  clientAddress: string,
) {
  const { data } = await api.post(`/api/applications/${applicationId}/accept`, {
    clientAddress,
  });
  return data.data;
}

export async function fetchMyApplications(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Application[] }>(
    `/api/applications/freelancer/${publicKey}`,
  );
  return data.data;
}
