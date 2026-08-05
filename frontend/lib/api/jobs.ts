import { api } from "./client";
import type { Job, JobAnalytics, BulkActionResponse } from "@/utils/types";

export async function fetchJobs(params?: {
  category?: string;
  status?: string;
  limit?: number;
  search?: string;
  after?: string;
  cursor?: string;
  timezone?: string;
  viewerAddress?: string;
  minBudget?: string;
  maxBudget?: string;
  skills?: string;
  minClientRating?: string;
  duration?: string;
  postedSince?: string;
  maxApplications?: string;
}) {
  const {
    minBudget,
    maxBudget,
    minClientRating,
    postedSince,
    maxApplications,
    after,
    ...rest
  } = params || {};

  const { data } = await api.get<{
    success: boolean;
    data: Job[];
    next_cursor: string | null;
    has_more: boolean;
  }>("/api/jobs", {
    params: {
      ...rest,
      after,
      min_budget: minBudget,
      max_budget: maxBudget,
      skills: params?.skills,
      min_client_rating: minClientRating,
      duration: params?.duration,
      posted_since: postedSince,
      max_applications: maxApplications,
    },
  });

  return {
    jobs: data.data,
    nextCursor: data.next_cursor ?? null,
    hasMore: data.has_more ?? Boolean(data.next_cursor),
  };
}

export interface JobSuggestion {
  type: "title" | "skill" | "category";
  value: string;
}

export async function fetchJobSuggestions(query: string): Promise<JobSuggestion[]> {
  try {
    const { data } = await api.get<{ success: boolean; data: JobSuggestion[] }>(
      "/api/jobs/suggestions",
      { params: { q: query } },
    );
    return data.data;
  } catch {
    return [];
  }
}

export async function fetchRelatedJobs(category: string, currentJobId: string) {
  const { jobs } = await fetchJobs({
    category,
    status: "open",
    limit: 4,
  });

  return jobs.filter((job) => job.id !== currentJobId).slice(0, 3);
}

export async function fetchRecentlyCompletedJobs(limit = 3): Promise<Job[]> {
  const { jobs } = await fetchJobs({ status: "completed", limit });
  return jobs;
}

/**
 * Fetches a single job by its identifier.
 *
 * @param id Job identifier.
 * @returns The matching job record.
 * @throws {import("axios").AxiosError} If the job is not found or the request fails.
 * @see backend/src/routes/jobs.js
 */
export async function fetchJob(id: string, viewerAddress?: string) {
  const { data } = await api.get<{ success: boolean; data: Job }>(
    `/api/jobs/${id}`,
    {
      params: viewerAddress ? { viewerAddress } : undefined,
    },
  );
  return data.data;
}

export async function createJob(payload: {
  title: string;
  description: string;
  budget: string;
  currency?: "XLM" | "USDC";
  category: string;
  skills: string[];
  deadline?: string;
  timezone?: string;
  clientAddress: string;
  screeningQuestions?: string[];
  visibility?: "public" | "private" | "invite_only";
  milestones?: { description: string; amount: string }[];
}) {
  const { data } = await api.post<{ success: boolean; data: Job }>(
    "/api/jobs",
    payload,
  );
  return data.data;
}

export async function fetchMyJobs(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Job[] }>(
    `/api/jobs/client/${publicKey}`,
  );
  return data.data;
}

/**
 * Evaluates application quality using AI (Claude API).
 *
 * @param jobId Job identifier.
 * @returns Array of scores and reasonings for all applications.
 */
export async function scoreProposals(jobId: string) {
  const { data } = await api.post<{
    success: boolean;
    data: { id: string; score: number; reasoning: string }[];
  }>(`/api/jobs/${jobId}/score-proposals`);
  return data.data;
}

/**
 * Get analytics for a job (applications per day, avg bid, skill distribution, time to hire).
 *
 * @param jobId Job identifier.
 * @returns Analytics data for the job.
 */
export async function fetchJobAnalytics(jobId: string) {
  const { data } = await api.get<{ success: boolean; data: JobAnalytics }>(
    `/api/jobs/${jobId}/analytics`,
  );
  return data.data;
}

/**
 * Extend a job's expiry by the given number of days.
 * Charges a 0.5 XLM fee per 7-day block.
 *
 * @param jobId Job identifier.
 * @param days Number of days to extend (7, 14, or 30).
 * @returns Updated job record.
 */
export async function extendJobExpiry(jobId: string, days = 30) {
  const { data } = await api.patch<{ success: boolean; data: Job }>(
    `/api/jobs/${jobId}/extend`,
    { days },
  );
  return data.data;
}

/**
 * Get jobs expiring within 3 days.
 *
 * @returns Array of expiring jobs.
 */
export async function fetchExpiringJobs() {
  const { data } = await api.get<{ success: boolean; data: Job[] }>(
    "/api/jobs/expiring",
  );
  return data.data;
}

/**
 * Manually trigger expiry check for old jobs.
 *
 * @returns Count of expired jobs.
 */
export async function expireOldJobs() {
  const { data } = await api.post<{
    success: boolean;
    data: { expiredCount: number };
  }>("/api/jobs/expire-old");
  return data.data.expiredCount;
}

export async function inviteFreelancer(
  jobId: string,
  freelancerAddress: string,
) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    `/api/jobs/${jobId}/invite`,
    {
      freelancerAddress,
    },
  );
  return data.data;
}

/**
 * Stores the on-chain escrow contract ID against a job record.
 *
 * @param jobId Job identifier.
 * @param escrowContractId Soroban transaction hash returned after create_escrow().
 * @returns The updated job record.
 */
export async function updateJobEscrowId(
  jobId: string,
  escrowContractId: string,
) {
  const { data } = await api.patch<{ success: boolean; data: Job }>(
    `/api/jobs/${jobId}/escrow`,
    { escrowContractId },
  );
  return data.data;
}

export async function deleteJob(jobId: string) {
  await api.delete(`/api/jobs/${jobId}`);
}

/**
 * Raises a dispute for an in-progress job.
 *
 * @param jobId Job identifier.
 * @param payload Dispute details (reason and description).
 * @returns The updated job record.
 */
export async function raiseDispute(
  jobId: string,
  payload: { reason: string; description: string },
) {
  const { data } = await api.post<{ success: boolean; data: Job }>(
    `/api/jobs/${jobId}/dispute`,
    payload,
  );
  return data.data;
}

/**
 * Resolves a dispute for a job (Admin only).
 *
 * @param jobId Job identifier.
 * @param note Resolution note.
 * @param releaseTo Release funds to "client" or "freelancer".
 * @returns The updated job record.
 */
export async function resolveDispute(jobId: string, note?: string, releaseTo?: string) {
  const { data } = await api.post<{ success: boolean; data: Job }>(
    `/api/jobs/${jobId}/resolve`,
    { note, releaseTo },
  );
  return data.data;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

export async function fetchRecommendedJobs(
  publicKey: string,
): Promise<(Job & { matchScore: number })[]> {
  const { data } = await api.get<{
    success: boolean;
    data: (Job & { matchScore: number })[];
  }>(`/api/jobs/recommended/${encodeURIComponent(publicKey)}`);
  return data.data;
}

// ─── Drafts ─────────────────────────────────────────────────────────────────

export async function fetchDrafts() {
  const { data } = await api.get<{ success: boolean; data: any[] }>(
    "/api/jobs/drafts",
  );
  return data.data;
}

export async function fetchDraft(draftId: string) {
  const { data } = await api.get<{ success: boolean; data: any }>(
    `/api/jobs/drafts/${draftId}`,
  );
  return data.data;
}

export async function saveDraft(draft: {
  id?: string;
  title?: string;
  description?: string;
  budget?: number;
  category?: string;
  skills?: string[];
  deadline?: string;
}) {
  const { data } = await api.post<{ success: boolean; data: { id: string } }>("/api/jobs/drafts", draft);
  return data.data;
}

export async function updateDraft(draft: {
  id: string;
  title?: string;
  description?: string;
  budget?: number;
  category?: string;
  skills?: string[];
  deadline?: string;
}) {
  const { data } = await api.put<{ success: boolean; data: { id: string } }>(`/api/jobs/drafts/${draft.id}`, draft);
  return data.data;
}

export async function deleteDraft(draftId: string) {
  await api.delete(`/api/jobs/drafts/${draftId}`);
}

// ─── Bulk Job Actions ───────────────────────────────────────────────────────

export async function bulkCancelJobs(jobIds: string[]): Promise<BulkActionResponse> {
  const { data } = await api.post<{ success: boolean; data: BulkActionResponse }>(
    "/api/jobs/bulk-cancel",
    { jobIds },
  );
  return data.data;
}

export async function bulkExtendJobs(jobIds: string[], days: number): Promise<BulkActionResponse> {
  const { data } = await api.post<{ success: boolean; data: BulkActionResponse }>(
    "/api/jobs/bulk-extend",
    { jobIds, days },
  );
  return data.data;
}

export async function bulkBoostJobs(jobIds: string[], txHash: string): Promise<BulkActionResponse> {
  const { data } = await api.post<{ success: boolean; data: BulkActionResponse }>(
    "/api/jobs/bulk-boost",
    { jobIds, txHash },
  );
  return data.data;
}

// ─── Job Boost (Issue #344) ───────────────────────────────────────────────────

/**
 * Notify the backend that a boost payment was made on-chain.
 * The backend sets boosted=true and calculates the expiry from amountXlm.
 */
export async function boostJob(
  jobId: string,
  txHash: string,
  amountXlm: number,
): Promise<Job> {
  const { data } = await api.patch<{ success: boolean; data: Job }>(
    `/api/jobs/${jobId}/boost`,
    { txHash, amountXlm },
  );
  return data.data;
}
