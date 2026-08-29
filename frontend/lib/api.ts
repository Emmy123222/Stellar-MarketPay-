import axios from "axios";
import type {
  Availability,
  Job,
  Application,
  UserProfile,
  Rating,
  ProposalTemplate,
  PriceAlertPreference,
  SkillEndorsement,
} from "@/utils/types";

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

api.interceptors.response.use(
  (response) => {
    const remaining = response.headers["x-ratelimit-remaining"];
    if (remaining && parseInt(remaining, 10) < 5) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ratelimit-warning"));
      }
    }
    return response;
  },
  (error) => {
    const remaining = error.response?.headers?.["x-ratelimit-remaining"];
    if (remaining && parseInt(remaining, 10) < 5) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ratelimit-warning"));
      }
    }
    return Promise.reject(error);
  }
);

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function fetchAuthChallenge(publicKey: string) {
  const { data } = await api.get<{ transaction: string }>(
    `/api/auth?account=${publicKey}`,
  );
  return data.transaction;
}

export async function verifyAuthChallenge(transaction: string) {
  const { data } = await api.post<{ success: boolean; token: string }>(
    "/api/auth",
    { transaction },
  );
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
    `/api/jobs/${encodeURIComponent(id)}`,
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
  category: string;
  skills: string[];
  deadline?: string;
  timezone?: string;
  clientAddress: string;
  screeningQuestions?: string[];
  visibility?: "public" | "private" | "invite_only";
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
 * Extend a job's expiry by 30 days.
 *
 * @param jobId Job identifier.
 * @returns Updated job record.
 */
export async function extendJobExpiry(jobId: string) {
  const { data } = await api.patch<{ success: boolean; data: Job }>(
    `/api/jobs/${jobId}/extend`,
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

// ─── Applications ─────────────────────────────────────────────────────────────

export async function fetchApplications(jobId: string) {
  const { data } = await api.get<{ success: boolean; data: Application[] }>(
    `/api/applications/job/${encodeURIComponent(jobId)}`,
  );
  return data.data;
}

export async function submitApplication(payload: {
  jobId: string;
  freelancerAddress: string;
  proposal: string;
  bidAmount: string;
  currency: string;
  screeningAnswers?: Record<string, string>;
}) {
  const { data } = await api.post<{ success: boolean; data: Application }>(
    "/api/applications",
    payload,
  );
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

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function fetchProfile(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: UserProfile }>(
    `/api/profiles/${publicKey}`,
  );
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

// ─── Escrow ───────────────────────────────────────────────────────────────────

export async function releaseEscrow(
  jobId: string,
  clientAddress: string,
  contractTxHash?: string,
  releaseCurrency?: "XLM" | "USDC",
) {
  const { data } = await api.post(`/api/escrow/${jobId}/release`, {
    clientAddress,
    ...(contractTxHash ? { contractTxHash } : {}),
    ...(releaseCurrency ? { releaseCurrency } : {}),
  });
  return data.data;
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

export async function fetchProposalTemplates() {
  const { data } = await api.get<{
    success: boolean;
    data: ProposalTemplate[];
  }>("/api/proposal-templates");
  return data.data;
}

export async function createProposalTemplate(payload: {
  name: string;
  content: string;
}) {
  const { data } = await api.post<{ success: boolean; data: ProposalTemplate }>(
    "/api/proposal-templates",
    payload,
  );
  return data.data;
}

export async function updateProposalTemplate(
  id: string,
  payload: { name?: string; content?: string },
) {
  const { data } = await api.patch<{
    success: boolean;
    data: ProposalTemplate;
  }>(`/api/proposal-templates/${id}`, payload);
  return data.data;
}

export async function deleteProposalTemplate(id: string) {
  await api.delete(`/api/proposal-templates/${id}`);
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

// ─── Ratings ──────────────────────────────────────────────────────────────────

export async function submitRating(payload: {
  jobId: string;
  ratedAddress: string;
  stars: number;
  review?: string;
}) {
  const { data } = await api.post<{ success: boolean; data: Rating }>(
    "/api/ratings",
    payload,
  );
  return data.data;
}

export async function fetchRatings(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Rating[] }>(
    `/api/ratings/${encodeURIComponent(publicKey)}`,
  );
  return data.data;
}

// ─── Job Suggestions (Autocomplete) ─────────────────────────────────────

export async function fetchJobSuggestions(
  query: string,
): Promise<{ type: "title" | "skill" | "category"; value: string }[]> {
  const { data } = await api.get<{
    success: boolean;
    data: { type: string; value: string }[];
  }>("/api/jobs/suggestions", { params: { q: query } });
  return data.data.map((item) => ({
    type: item.type as "title" | "skill" | "category",
    value: item.value,
  }));
}

// ─── Job Drafts (Issue #219) ────────────────────────────────────────────

export async function saveDraft(draftData: any) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    "/api/jobs/drafts",
    draftData,
  );
  return data.data;
}

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

export async function deleteDraft(draftId: string) {
  await api.delete(`/api/jobs/drafts/${draftId}`);
}

// ─── Job Recommendations (Issue #221) ───────────────────────────────────

export async function fetchRecommendedJobs(limit = 10) {
  const { data } = await api.get<{ success: boolean; data: Job[] }>(
    "/api/jobs/recommended",
    { params: { limit } },
  );
  return data.data;
}

// ─── Skill Endorsements ───────────────────────────────────────────────────────

/**
 * Endorse a specific skill on a freelancer's profile.
 *
 * @param recipientAddress Profile owner's Stellar public key.
 * @param skill The skill name to endorse.
 */
export async function endorseSkill(recipientAddress: string, skill: string) {
  const { data } = await api.post<{ success: boolean }>(
    `/api/profiles/${encodeURIComponent(recipientAddress)}/skill-endorsements`,
    { skill },
  );
  return data;
}

/**
 * Fetch skill endorsements for a freelancer.
 *
 * @param publicKey Profile owner's Stellar public key.
 * @returns Array of endorsements grouped by skill.
 */
export async function fetchSkillEndorsements(
  publicKey: string,
): Promise<SkillEndorsement[]> {
  const { data } = await api.get<{
    success: boolean;
    data: SkillEndorsement[];
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/skill-endorsements`);
  return data.data;
}

// ─── Freelancer Analytics ───────────────────────────────────────────────────

export async function fetchFreelancerEarnings(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: any }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/earnings`,
  );
  return data.data;
}

export async function fetchProfiles(params?: { category?: string; limit?: number }) {
  const { data } = await api.get<{ success: boolean; data: UserProfile[] }>(
    "/api/profiles",
    { params },
  );
  return data.data;
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export async function fetchCategoryAnalytics(category: string) {
  const { data } = await api.get<{ success: boolean; data: any }>(
    `/api/analytics/category/${encodeURIComponent(category)}`,
  );
  return data.data;
}

export async function fetchAnalyticsOverview() {
  const { data } = await api.get<{ success: boolean; data: any }>(
    "/api/analytics/overview",
  );
  return data.data;
}

// ─── Job Certificates & Disputes ───────────────────────────────────────────

export async function mintCompletionCertificate(jobId: string, freelancerAddress: string) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    `/api/jobs/${jobId}/certificate`,
    { freelancerAddress },
  );
  return data.data;
}

export async function raiseDispute(jobId: string, reason: string) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    `/api/jobs/${jobId}/dispute`,
    { reason },
  );
  return data.data;
}

export async function fetchNftCertificateByJob(jobId: string) {
  const { data } = await api.get<{ success: boolean; data: any }>(
    `/api/jobs/${jobId}/certificate`,
  );
  return data.data;
}

// ─── Saved Searches ─────────────────────────────────────────────────────────

export async function fetchSavedSearches(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: any[] }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/saved-searches`,
  );
  return data.data;
}

export async function createSavedSearch(publicKey: string, payload: { name: string; filters: any }) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/saved-searches`,
    payload,
  );
  return data.data;
}

// ─── Notifications ──────────────────────────────────────────────────────────

export async function fetchNotifications(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: any[] }>(
    `/api/notifications/${encodeURIComponent(publicKey)}`,
  );
  return data.data;
}

export async function markNotificationRead(notificationId: string) {
  const { data } = await api.patch<{ success: boolean; data: any }>(
    `/api/notifications/${notificationId}`,
  );
  return data.data;
}

export async function markAllNotificationsRead(publicKey: string) {
  const { data } = await api.patch<{ success: boolean; data: any }>(
    `/api/notifications/${encodeURIComponent(publicKey)}/read-all`,
  );
  return data.data;
}

// ─── Health & Status ────────────────────────────────────────────────────────

export async function fetchHealthStatus() {
  const { data } = await api.get<{ success: boolean; data: any }>(
    "/api/health/status",
  );
  return data.data;
}

export async function fetchHealthHistory(limit = 30) {
  const { data } = await api.get<{ success: boolean; data: any[] }>(
    "/api/health/history",
    { params: { limit } },
  );
  return data.data;
}

export async function subscribeStatusAlerts(publicKey: string, email: string) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/status-alerts`,
    { email },
  );
  return data.data;
}
