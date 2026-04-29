import axios from "axios";
import type { Availability, Job, Application, UserProfile, Rating, ProfileStats, ResponseTimeStats } from "@/utils/types";

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

/**
 * Fetches a single job by its identifier.
 *
 * @param id Job identifier.
 * @returns The matching job record.
 * @throws {import("axios").AxiosError} If the job is not found or the request fails.
 * @see backend/src/routes/jobs.js
 */
export async function fetchJob(id: string, viewerAddress?: string) {
  const { data } = await api.get<{ success: boolean; data: Job }>(`/api/jobs/${id}`, {
    params: viewerAddress ? { viewerAddress } : undefined,
  });
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
  const { data } = await api.post<{ success: boolean; data: Job }>("/api/jobs", payload);
  return data.data;
}

export async function fetchMyJobs(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Job[] }>(`/api/jobs/client/${publicKey}`);
  return data.data;
}

/**
 * Tracks a referral click for a job.
 * 
 * @param jobId Job identifier.
 * @param referrer Referrer's Stellar public key.
 */
export async function trackReferralClick(jobId: string, referrer: string) {
  await api.post(`/api/jobs/${jobId}/referral`, { referrer });
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
  screeningAnswers?: Record<string, string>;
  referredBy?: string;
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
    { didHash }
  );
  return data.data;
}

/**
 * Fetches application statistics for a freelancer profile.
 *
 * @param publicKey Freelancer Stellar public key.
 * @returns Statistics including total applications, accepted count, and success rate.
 */
export async function fetchProfileStats(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: ProfileStats }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/stats`
  );
  return data.data;
}

/**
 * Fetches the average response time (acceptance to completion) for a freelancer.
 *
 * @param publicKey Freelancer Stellar public key.
 * @returns Average response time in days.
 */
export async function fetchResponseTime(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: ResponseTimeStats }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/response-time`
  );
  return data.data;
}

// ─── Escrow ───────────────────────────────────────────────────────────────────

export async function releaseEscrow(
  jobId: string,
  clientAddress: string,
  contractTxHash?: string,
  releaseCurrency?: "XLM" | "USDC"
) {
  const { data } = await api.post(`/api/escrow/${jobId}/release`, {
    clientAddress,
    ...(contractTxHash ? { contractTxHash } : {}),
    ...(releaseCurrency ? { releaseCurrency } : {}),
  });
  return data.data;
}

export async function inviteFreelancer(jobId: string, freelancerAddress: string) {
  const { data } = await api.post<{ success: boolean; data: any }>(`/api/jobs/${jobId}/invite`, {
    freelancerAddress,
  });
  return data.data;
}

export async function fetchProposalTemplates() {
  const { data } = await api.get<{ success: boolean; data: ProposalTemplate[] }>("/api/proposal-templates");
  return data.data;
}

export async function createProposalTemplate(payload: { name: string; content: string }) {
  const { data } = await api.post<{ success: boolean; data: ProposalTemplate }>("/api/proposal-templates", payload);
  return data.data;
}

export async function updateProposalTemplate(id: string, payload: { name?: string; content?: string }) {
  const { data } = await api.patch<{ success: boolean; data: ProposalTemplate }>(`/api/proposal-templates/${id}`, payload);
  return data.data;
}

export async function deleteProposalTemplate(id: string) {
  await api.delete(`/api/proposal-templates/${id}`);
}

export async function fetchPriceAlertPreference(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: PriceAlertPreference | null }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/price-alerts`
  );
  return data.data;
}

export async function upsertPriceAlertPreference(publicKey: string, payload: {
  minXlmPriceUsd?: number | null;
  maxXlmPriceUsd?: number | null;
  emailNotificationsEnabled?: boolean;
  email?: string;
}) {
  const { data } = await api.post<{ success: boolean; data: PriceAlertPreference }>(
    `/api/profiles/${encodeURIComponent(publicKey)}/price-alerts`,
    payload
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

// ─── Job Suggestions (Autocomplete) ─────────────────────────────────────

export async function fetchJobSuggestions(query: string): Promise<{ type: 'title' | 'skill' | 'category'; value: string }[]> {
  const { data } = await api.get<{ success: boolean; data: { type: string; value: string }[] }>("/api/jobs/suggestions", { params: { q: query } });
  return data.data.map((item) => ({ type: item.type as 'title' | 'skill' | 'category', value: item.value }));
}

// ─── Job Drafts (Issue #219) ────────────────────────────────────────────

export async function saveDraft(draftData: any) {
  const { data } = await api.post<{ success: boolean; data: any }>("/api/jobs/drafts", draftData);
  return data.data;
}

export async function fetchDrafts() {
  const { data } = await api.get<{ success: boolean; data: any[] }>("/api/jobs/drafts");
  return data.data;
}

export async function fetchDraft(draftId: string) {
  const { data } = await api.get<{ success: boolean; data: any }>(`/api/jobs/drafts/${draftId}`);
  return data.data;
}

export async function deleteDraft(draftId: string) {
  await api.delete(`/api/jobs/drafts/${draftId}`);
}

// ─── Job Recommendations (Issue #221) ───────────────────────────────────

export async function fetchRecommendedJobs(limit = 10) {
  const { data } = await api.get<{ success: boolean; data: Job[] }>("/api/jobs/recommended", { params: { limit } });
  return data.data;
}

// ─── IPFS File Upload (Issue #202) ──────────────────────────────────────────

export async function uploadPortfolioFiles(publicKey: string, files: FileList) {
  const formData = new FormData();
  
  // Append all files to FormData
  Array.from(files).forEach((file) => {
    formData.append("files", file);
  });

  const { data } = await api.post<{ 
    success: boolean; 
    data: { 
      uploadedFiles: PortfolioFile[];
      gatewayUrls: string[];
    }
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/upload-files`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
    timeout: 60000, // 60 seconds for file uploads
  });

  return data.data;
}

// ─── Stellar Faucet (Issue #205) ───────────────────────────────────────────

export async function fundTestnetWallet(publicKey: string) {
  const { data } = await api.post<{ 
    success: boolean; 
    data: {
      success: boolean;
      message: string;
      fundedAmount: string;
      newBalance?: string;
      transactionHash?: string;
      ledger?: number;
    }
  }>("/api/faucet/fund", { publicKey });

  return data.data;
}

export async function checkAccountNeedsFunding(publicKey: string) {
  const { data } = await api.get<{ 
    success: boolean; 
    data: {
      needsFunding: boolean;
      currentBalance: string;
      exists: boolean;
    }
  }>(`/api/faucet/check/${encodeURIComponent(publicKey)}`);

  return data.data;
}

export async function getFaucetStatus() {
  const { data } = await api.get<{ 
    success: boolean; 
    data: {
      enabled: boolean;
      network: string;
      amount: string;
      asset: string;
    }
  }>("/api/faucet/status");

  return data.data;
}

// ─── Token Support (Issue #228) ─────────────────────────────────────────────

export async function getPopularTokens() {
  const { data } = await api.get<{ 
    success: boolean; 
    data: TokenInfo[];
  }>("/api/tokens/popular");

  return data.data;
}

export async function searchTokens(query: string) {
  const { data } = await api.get<{ 
    success: boolean; 
    data: TokenInfo[];
  }>("/api/tokens/search", { params: { q: query } });

  return data.data;
}

export async function getTokenMetadata(contractId: string) {
  const { data } = await api.get<{ 
    success: boolean; 
    data: TokenInfo;
  }>(`/api/tokens/${contractId}/metadata`);

  return data.data;
}

export async function getTokenBalance(contractId: string, publicKey: string) {
  const { data } = await api.get<{ 
    success: boolean; 
    data: TokenBalance;
  }>(`/api/tokens/${contractId}/balance/${publicKey}`);

  return data.data;
}

export async function validateTokenContract(contractId: string) {
  const { data } = await api.post<{ 
    success: boolean; 
    data: {
      valid: boolean;
      error?: string;
    };
  }>("/api/tokens/validate", { contractId });

  return data.data;
}

// ─── Stellar Turrets (Issue #224) ───────────────────────────────────────────

export async function submitViaTurrets(transactionXDR: string, useTurret?: boolean) {
  const { data } = await api.post<{ 
    success: boolean; 
    data: {
      success: boolean;
      hash: string;
      ledger: number;
      feeCharged: string;
      turretUsed: boolean;
      message: string;
    };
  }>("/api/turrets/submit", { transactionXDR, useTurret });

  return data.data;
}

export async function getTurretsStatus() {
  const { data } = await api.get<{ 
    success: boolean; 
    data: {
      available: boolean;
      url?: string;
      network?: string;
      version?: string;
      feeSponsorship?: boolean;
      message: string;
      error?: string;
    };
  }>("/api/turrets/status");

  return data.data;
}

export async function estimateTurretsFee(transactionXDR: string) {
  const { data } = await api.post<{ 
    success: boolean; 
    data: {
      success: boolean;
      baseFee: string;
      turretFee: string;
      totalFee: string;
      feeSponsored: boolean;
      message?: string;
    };
  }>("/api/turrets/estimate", { transactionXDR });

  return data.data;
}

export async function getTurretsConfig() {
  const { data } = await api.get<{ 
    success: boolean; 
    data: {
      configured: boolean;
      url: string | null;
      hasApiKey: boolean;
      shouldUseByDefault: boolean;
    };
  }>("/api/turrets/config");

  return data.data;
}

// ─── Messages ──────────────────────────────────────────────────────────────────

/**
 * Fetches all messages for a specific job.
 * Automatically marks messages as read for the current user.
 *
 * @param jobId Job identifier.
 * @returns Messages sorted chronologically (oldest first).
 * @throws {import("axios").AxiosError} If unauthorized, job not found, or request fails.
 * @see backend/src/routes/messageRoutes.js
 */
export async function fetchMessages(jobId: string): Promise<Message[]> {
  const { data } = await api.get<{ success: boolean; data: Message[] }>(`/api/messages/job/${jobId}`);
  return data.data;
}

/**
 * Sends a message in a job thread.
 *
 * Request payload shape:
 * - `content` (string): message text (1-2000 characters).
 *
 * @param jobId Job identifier.
 * @param content Message content.
 * @returns The created message object.
 * @throws {import("axios").AxiosError} If unauthorized, validation fails, or request fails.
 * @see backend/src/routes/messageRoutes.js
 */
export async function sendMessage(jobId: string, content: string): Promise<Message> {
  const { data } = await api.post<{ success: boolean; data: Message }>(`/api/messages/job/${jobId}`, { content });
  return data.data;
}

/**
 * Fetches the total unread message count for the authenticated user.
 *
 * @returns Number of unread messages.
 * @throws {import("axios").AxiosError} If not authenticated or request fails.
 * @see backend/src/routes/messageRoutes.js
 */
export async function fetchUnreadCount(): Promise<number> {
  const { data } = await api.get<{ success: boolean; data: { unreadCount: number } }>("/api/messages/unread-count");
  return data.data.unreadCount;
}

