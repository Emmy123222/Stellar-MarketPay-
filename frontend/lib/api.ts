import axios from "axios";
import { optionalClientEnv } from "./env";
import type {
  Availability,
  Job,
  Application,
  JobAnalytics,
  UserProfile,
  Rating,
  ProposalTemplate,
  PriceAlertPreference,
  SkillEndorsement,
  ClientSpendingAnalytics,
  PortfolioFile,
  TokenInfo,
  TokenBalance,
  ReferralStats,
  TimeEntry,
  TimeInvoice,
  Message,
  AssessmentQuestion,
  SkillBadge,
  BulkActionResponse,
} from "@/utils/types";

const api = axios.create({
  baseURL: optionalClientEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000"),
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

export interface InsightCategory {
  category: string;
  totalJobs: number;
  avgBudget: number;
  avgApplicationsPerJob: number;
  acceptanceRate: number;
  lowCompetitionJobs: number;
  uniqueClients: number;
}

export interface InsightClientMix {
  newClients: number;
  returningClients: number;
  totalClients: number;
}

export interface InsightSkill {
  skill: string;
  demandCount: number;
  avgApplicationsPerJob: number;
  lowCompetitionJobs: number;
}

export interface InsightCompetitiveJob {
  id: string;
  title: string;
  category: string;
  budget: number;
  currency: string;
  clientAddress: string;
  createdAt: string;
  applicationCount: number;
  competitionLevel: "uncontested" | "light" | "active";
}

export interface InsightPayTrend {
  date: string;
  category: string;
  avgBudget: number;
  jobCount: number;
}

export async function fetchInsightCategories(limit = 20) {
  const { data } = await api.get<{
    success: boolean;
    data: {
      categories: InsightCategory[];
      clientMix: InsightClientMix;
    };
  }>("/api/insights/categories", { params: { limit } });
  return data.data;
}

export async function fetchInsightSkills(limit = 20) {
  const { data } = await api.get<{ success: boolean; data: InsightSkill[] }>(
    "/api/insights/skills",
    { params: { limit } },
  );
  return data.data;
}

export async function fetchInsightCompetitive(limit = 20) {
  const { data } = await api.get<{ success: boolean; data: InsightCompetitiveJob[] }>(
    "/api/insights/competitive",
    { params: { limit } },
  );
  return data.data;
}

export async function fetchInsightPayTrends(days = 30) {
  const { data } = await api.get<{ success: boolean; data: InsightPayTrend[] }>(
    "/api/insights/trends/pay",
    { params: { days } },
  );
  return data.data;
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

// ─── Applications ─────────────────────────────────────────────────────────────

export async function fetchApplications(jobId: string) {
  const { data } = await api.get<{ success: boolean; data: Application[] }>(
    `/api/applications/job/${jobId}`,
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

export async function fetchEscrow(jobId: string) {
  const { data } = await api.get<{ success: boolean; data: any }>(
    `/api/escrow/${jobId}`,
  );
  return data.data;
}

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

export async function timeoutRefund(
  jobId: string,
  clientAddress: string,
  contractTxHash?: string,
) {
  const { data } = await api.post(`/api/escrow/${jobId}/timeout-refund`, {
    clientAddress,
    ...(contractTxHash ? { contractTxHash } : {}),
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

export async function fetchClientSpendingAnalytics(publicKey: string) {
  const { data } = await api.get<{
    success: boolean;
    data: ClientSpendingAnalytics;
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/spending`);
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
 * @returns The updated job record.
 */
export async function resolveDispute(jobId: string) {
  const { data } = await api.post<{ success: boolean; data: Job }>(
    `/api/jobs/${jobId}/resolve`,
  );
  return data.data;
}

// ─── Time entries ─────────────────────────────────────────────────────────────

export async function logTimeEntry(payload: {
  jobId: string;
  durationMinutes: number;
  description?: string;
  startedAt?: string;
}) {
  const { data } = await api.post<{ success: boolean; data: TimeEntry }>(
    "/api/time-entries",
    payload,
  );
  return data.data;
}

export async function fetchTimeEntries(jobId: string): Promise<TimeEntry[]> {
  const { data } = await api.get<{ success: boolean; data: TimeEntry[] }>(
    `/api/time-entries/job/${jobId}`,
  );
  return data.data;
}

export async function fetchTimeInvoices(jobId: string): Promise<TimeInvoice[]> {
  const { data } = await api.get<{ success: boolean; data: TimeInvoice[] }>(
    `/api/time-entries/job/${jobId}/invoices`,
  );
  return data.data;
}

export async function generateTimeInvoice(payload: {
  jobId: string;
  hourlyRateXlm: number;
}) {
  const { data } = await api.post<{ success: boolean; data: TimeInvoice }>(
    "/api/time-entries/invoice",
    payload,
  );
  return data.data;
}

export async function reviewTimeInvoice(
  invoiceId: string,
  decision: "approved" | "rejected",
) {
  const { data } = await api.patch<{ success: boolean; data: TimeInvoice }>(
    `/api/time-entries/invoice/${invoiceId}/review`,
    { decision },
  );
  return data.data;
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
    `/api/ratings/${publicKey}`,
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

export async function deleteDraft(draftId: string) {
  await api.delete(`/api/jobs/drafts/${draftId}`);
}

// ─── Skill Assessments ─────────────────────────────────────────────────────────

export async function fetchAssessment(skill: string) {
  const { data } = await api.get<{ success: boolean; data: AssessmentQuestion[] }>(
    `/api/assessments/${skill}`
  );
  return data.data;
}

export async function submitAssessment(payload: {
  skill: string;
  answers: Record<number, string>;
}) {
  const { data } = await api.post<{ success: boolean; data: SkillBadge }>(
    "/api/assessments/submit",
    payload
  );
  return data.data;
}

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
    };
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
    };
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
    };
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
    };
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

export async function submitViaTurrets(
  transactionXDR: string,
  useTurret?: boolean,
) {
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
  const { data } = await api.get<{ success: boolean; data: Message[] }>(
    `/api/messages/job/${jobId}`,
  );
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
export async function sendMessage(
  jobId: string,
  content: string,
  contractTxHash?: string,
): Promise<Message> {
  const { data } = await api.post<{ success: boolean; data: Message }>(
    `/api/messages/job/${jobId}`,
    { content, contractTxHash },
  );
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
  const { data } = await api.get<{
    success: boolean;
    data: { unreadCount: number };
  }>("/api/messages/unread-count");
  return data.data.unreadCount;
}

/**
 * Attaches an on-chain Soroban transaction hash to a message record.
 * Called after the frontend signs and submits the publish_message event.
 */
export async function attachMessageTxHash(
  messageId: string,
  txHash: string,
): Promise<Message> {
  const { data } = await api.patch<{ success: boolean; data: Message }>(
    `/api/messages/${messageId}/tx-hash`,
    { txHash },
  );
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

// ─── Dispute Evidence (Issue #223) ───────────────────────────────────────────

export interface DisputeEvidence {
  id: string;
  uploaderAddress: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  ipfsCid: string;
  gatewayUrl: string;
  createdAt: string;
}

export interface DisputeDetail {
  job: {
    id: string;
    title: string;
    status: string;
    client_address: string;
    freelancer_address: string;
    created_at: string;
  };
  evidence: DisputeEvidence[];
}

export async function fetchDisputeDetail(
  jobId: string,
): Promise<DisputeDetail> {
  const { data } = await api.get<{ success: boolean; data: DisputeDetail }>(
    `/api/disputes/${jobId}`,
  );
  return data.data;
}

export async function uploadDisputeEvidence(
  jobId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<DisputeEvidence> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post<{ success: boolean; data: DisputeEvidence }>(
    `/api/disputes/${jobId}/evidence`,
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60000,
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)); }
        : undefined,
    },
  );
  return data.data;
}

// ─── WebAuthn / Passkeys (Issue #218) ────────────────────────────────────────

export interface PasskeyCredential {
  id: string;
  credential_name: string;
  created_at: string;
}

export async function fetchPasskeyRegistrationOptions(publicKey: string) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    "/api/webauthn/register-options",
    { publicKey },
  );
  return data.data;
}

export async function verifyPasskeyRegistration(credential: any, name: string) {
  const { data } = await api.post<{ success: boolean; message: string }>(
    "/api/webauthn/register-verify",
    { credential, name },
  );
  return data;
}

export async function fetchPasskeyLoginOptions(publicKey: string) {
  const { data } = await api.post<{ success: boolean; data: any }>(
    "/api/webauthn/login-options",
    { publicKey },
  );
  return data.data;
}

export async function verifyPasskeyLogin(credential: any, publicKey: string) {
  const { data } = await api.post<{ success: boolean; token: string }>(
    "/api/webauthn/login-verify",
    { credential, publicKey },
  );
  return data;
}

export async function fetchPasskeyCredentials(): Promise<PasskeyCredential[]> {
  const { data } = await api.get<{
    success: boolean;
    data: PasskeyCredential[];
  }>("/api/webauthn/credentials");
  return data.data;
}

export async function deletePasskeyCredential(id: string) {
  await api.delete(`/api/webauthn/credentials/${id}`);
}

// ─── Developer API ────────────────────────────────────────────────────────────

export interface DeveloperApiKey {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  requests_today: number;
}

export interface CreatedDeveloperApiKey {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  apiKey: string;
}

function buildApiKeyHeaders(apiKey: string) {
  return { headers: { "X-API-Key": apiKey } };
}

export async function fetchDeveloperApiKeys(): Promise<DeveloperApiKey[]> {
  const { data } = await api.get<{ success: boolean; data: DeveloperApiKey[] }>(
    "/api/developer/keys",
  );
  return data.data;
}

export async function createDeveloperApiKey(
  label?: string,
): Promise<CreatedDeveloperApiKey> {
  const { data } = await api.post<{ success: boolean; data: CreatedDeveloperApiKey }>(
    "/api/developer/keys",
    { label },
  );
  return data.data;
}

export async function revokeDeveloperApiKey(id: string): Promise<void> {
  await api.delete(`/api/developer/keys/${id}`);
}

export async function fetchPublicJobs(apiKey: string, limit = 20) {
  const { data } = await api.get<{ success: boolean; data: any[] }>(
    "/api/public/jobs",
    {
      params: { limit },
      ...buildApiKeyHeaders(apiKey),
    },
  );
  return data.data;
}

export async function fetchPublicJob(apiKey: string, id: string) {
  const { data } = await api.get<{ success: boolean; data: any }>(
    `/api/public/jobs/${encodeURIComponent(id)}`,
    buildApiKeyHeaders(apiKey),
  );
  return data.data;
}

export async function fetchPublicFreelancerProfile(
  apiKey: string,
  publicKey: string,
) {
  const { data } = await api.get<{ success: boolean; data: any }>(
    `/api/public/freelancers/${encodeURIComponent(publicKey)}`,
    buildApiKeyHeaders(apiKey),
  );
  return data.data;
}

// ─── Skill Certificates ─────────────────────────────────────────

export interface CertificateData {
  id: string;
  publicKey: string;
  displayName: string | null;
  skill: string;
  score: number;
  certificateHash: string;
  ipfsCid: string | null;
  txHash: string | null;
  issuedAt: string;
  verifyUrl: string;
}

export async function fetchCertificate(id: string): Promise<CertificateData> {
  const { data } = await api.get<{ success: boolean; data: CertificateData }>(
    `/api/certificates/${id}`,
  );
  return data.data;
}

export async function fetchUserCertificates(
  publicKey: string,
): Promise<CertificateData[]> {
  const { data } = await api.get<{
    success: boolean;
    data: CertificateData[];
  }>(`/api/certificates/user/${encodeURIComponent(publicKey)}`);
  return data.data;
}

// ─── Skill Endorsements ─────────────────────────────────────────

export interface SkillEndorsementData {
  skill: string;
  count: number;
  endorsers: string[];
}

export async function fetchSkillEndorsements(
  publicKey: string,
): Promise<SkillEndorsementData[]> {
  const { data } = await api.get<{
    success: boolean;
    data: SkillEndorsementData[];
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/endorsements`);
  return data.data;
}

export async function endorseSkill(
  publicKey: string,
  skill: string,
): Promise<void> {
  await api.post(`/api/profiles/${encodeURIComponent(publicKey)}/endorse`, {
    skill,
  });
}

export async function fetchSkillBadges(
  publicKey: string,
): Promise<SkillBadge[]> {
  const { data } = await api.get<{
    success: boolean;
    data: SkillBadge[];
  }>(`/api/assessments/results/${encodeURIComponent(publicKey)}`);
  return data.data;
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

// ─── Referrals ────────────────────────────────────────────────────────────────

/**
 * Fetch referral stats and history for a referrer.
 */
export async function fetchReferralStats(
  publicKey: string,
): Promise<ReferralStats> {
  const { data } = await api.get<{ success: boolean; data: ReferralStats }>(
    `/api/referrals/${encodeURIComponent(publicKey)}`,
  );
  return data.data;
}

/**
 * Register a referral relationship when a new user signs up via a referral link.
 */
export async function registerReferral(
  referrerAddress: string,
  refereeAddress: string,
): Promise<void> {
  await api.post("/api/referrals/register", {
    referrerAddress,
    refereeAddress,
  });
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

// ─── Job Invitations (Issue #342) ────────────────────────────────────────────

export interface JobInvitation {
  id: string;
  jobId: string;
  jobTitle: string;
  jobBudget: string;
  jobCurrency: string;
  clientAddress: string;
  clientName?: string;
  freelancerAddress: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
}

/**
 * Fetch all pending invitations for the authenticated freelancer.
 */
export async function fetchMyInvitations(): Promise<JobInvitation[]> {
  const { data } = await api.get<{ success: boolean; data: JobInvitation[] }>(
    "/api/invitations",
  );
  return data.data;
}

/**
 * Decline a job invitation.
 */
export async function declineInvitation(invitationId: string): Promise<void> {
  await api.patch(`/api/invitations/${invitationId}/decline`);
}

/**
 * Accept a job invitation (auto-creates an application).
 */
export async function acceptInvitation(
  invitationId: string,
  proposal: string,
  bidAmount: string,
): Promise<Application> {
  const { data } = await api.post<{ success: boolean; data: Application }>(
    `/api/invitations/${invitationId}/accept`,
    { proposal, bidAmount },
  );
  return data.data;
}

// ─── Bulk Job Actions ─────────────────────────────────────────────────────────

export async function bulkCancelJobs(
  jobIds: string[]
): Promise<BulkActionResponse> {
  const { data } = await api.post<{ success: boolean; data: BulkActionResponse }>(
    "/api/jobs/bulk/cancel",
    { jobIds }
  );
  return data.data;
}

export async function bulkExtendJobs(
  jobIds: string[],
  days: number
): Promise<BulkActionResponse> {
  const { data } = await api.post<{ success: boolean; data: BulkActionResponse }>(
    "/api/jobs/bulk/extend",
    { jobIds, days }
  );
  return data.data;
}

export async function bulkBoostJobs(
  jobIds: string[],
  amountXlm: number | string
): Promise<BulkActionResponse> {
  const { data } = await api.post<{ success: boolean; data: BulkActionResponse }>(
    "/api/jobs/bulk/boost",
    { jobIds, amountXlm }
  );
  return data.data;
}
