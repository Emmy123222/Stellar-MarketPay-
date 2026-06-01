/**
 * utils/types.ts
 * Shared TypeScript types for Stellar MarketPay.
 */

export type JobStatus =
  | "open"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "disputed";
export type UserRole = "client" | "freelancer" | "both";
export type Currency = "XLM" | "USDC";
export type JobVisibility = "public" | "private" | "invite_only";
export type FreelancerTier =
  | "Newcomer"
  | "Rising Star"
  | "Expert"
  | "Top Talent";
export type AvailabilityStatus = "available" | "busy" | "unavailable";
export type PortfolioItemType = "link" | "image" | "pdf" | "github" | "live" | "stellar_tx" | "file";

export interface PortfolioItem {
  title: string;
  url: string;
  type: PortfolioItemType;
}

export interface Availability {
  status: AvailabilityStatus;
  availableFrom?: string;
  availableUntil?: string;
}

export interface Job {
  id: string;
  title: string;
  description: string;
  budget: string; // Amount as string
  currency: Currency; // XLM or USDC
  category: string;
  visibility?: JobVisibility;
  skills: string[];
  status: JobStatus;
  clientAddress: string;
  freelancerAddress?: string;
  escrowContractId?: string;
  applicantCount: number;
  shareCount?: number; // Track share clicks
  boosted?: boolean; // Featured/boosted status
  boostedUntil?: string; // ISO date when boost expires
  createdAt: string;
  updatedAt: string;
  deadline?: string;
  timezone?: string; // IANA timezone string (e.g., "America/New_York")
  screeningQuestions?: string[]; // Up to 5 screening questions
  expiresAt?: string; // ISO date when job expires if not hired
  extendedCount?: number; // Number of times expiry has been extended
  extendedUntil?: string; // Final expiry after all extensions
  clientReputationScore?: number | null;
}

export interface ClientReputation {
  publicKey: string;
  score: number;
  paymentReleaseRate: number;
  disputeRate: number;
  completionRate: number;
  avgTimeToReleaseHours: number;
  responseTimeToApplicationsHours: number;
  totals: {
    totalJobs: number;
    completedJobs: number;
    disputedJobs: number;
    totalReleased: number;
    releasedOnTime: number;
  };
}

export interface Application {
  id: string;
  jobId: string;
  freelancerAddress: string;
  freelancerTier?: FreelancerTier;
  proposal: string;
  bidAmount: string; // Amount as string
  currency: Currency; // XLM or USDC
  status: "pending" | "accepted" | "rejected";
  screeningAnswers?: Record<string, string>; // Question -> Answer mapping
  createdAt: string;
  estimatedDuration?: string;
}

export interface UserProfile {
  publicKey: string;
  displayName?: string;
  bio?: string;
  skills?: string[];
  portfolioItems?: PortfolioItem[];
  portfolioFiles?: PortfolioFile[];
  availability?: Availability | null;
  role: UserRole;
  completedJobs: number;
  totalEarnedXLM: string;
  rating?: number;
  tier?: FreelancerTier;
  /** Number of ratings received (when returned by profile API). */
  ratingCount?: number;
  didHash?: string;
  isKycVerified?: boolean;
  createdAt: string;
  updatedAt?: string;
  referralCount?: number;
  reputationPoints?: number;
}

export interface Rating {
  id: string;
  jobId: string;
  raterAddress: string;
  ratedAddress: string;
  stars: number; // 1–5
  review?: string;
  createdAt: string;
}

export interface ProposalTemplate {
  id: string;
  freelancerAddress: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceAlertPreference {
  freelancer_address: string;
  min_xlm_price_usd?: string | null;
  max_xlm_price_usd?: string | null;
  email_notifications_enabled: boolean;
  email?: string | null;
  last_min_alert_at?: string | null;
  last_max_alert_at?: string | null;
}

export interface ClientSpendingFreelancer {
  freelancerAddress: string;
  jobsCount: number;
  totalPaidXlm: string;
}

export interface ClientSpendingAnalytics {
  totalSpentXlm: string;
  jobsBreakdown: {
    posted: number;
    completed: number;
    cancelled: number;
    inProgress: number;
  };
  averageBudgetXlm: string;
  averagePaidXlm: string;
  topFreelancers: ClientSpendingFreelancer[];
  hasCompletedJobs: boolean;
}

export interface EscrowState {
  contractId: string;
  jobId: string;
  client: string;
  freelancer: string;
  amount: string;
  status: "locked" | "released" | "refunded" | "disputed" | "timeout_refunded";
  createdLedger: number;
}

export interface Message {
  id: string;
  jobId: string;
  senderAddress: string;
  receiverAddress: string;
  content: string;
  read: boolean;
  createdAt: string;
  ipfsCid?: string;
  txHash?: string;
}

export interface PortfolioFile {
  cid: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface TokenInfo {
  contractId: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
}

export interface TokenBalance {
  contractId: string;
  balance: string;
  symbol: string;
}

// ─── Skill Endorsements ────────────────────────────────────────

export interface SkillEndorsement {
  skill: string;
  count: number;
  endorsers: string[];
}

export interface SkillBadge {
  skill: string;
  score: number;
  passed: boolean;
  taken_at: string;
}

export interface AssessmentQuestion {
  id: number;
  question: string;
  options: string[];
}

// ─── Referrals ────────────────────────────────────────────────────────────────

export type ReferralStatus = "pending" | "paid" | "ineligible";

export interface ReferralReferee {
  id: string;
  refereeAddress: string;
  refereeDisplayName: string | null;
  status: ReferralStatus;
  payoutAmount: string | null; // XLM string, e.g. "0.5000000"
  paidAt: string | null;
  jobTitle: string | null;
  createdAt: string;
}

export interface ReferralPayout {
  id: string;
  refereeAddress: string;
  jobId: string;
  jobTitle: string;
  amountXlm: string;
  contractTxHash: string | null;
  createdAt: string;
}

export interface ReferralStats {
  totalReferrals: number;
  paidReferrals: number;
  pendingReferrals: number;
  totalEarnedXlm: string;
  bonusBps: number;
  referees: ReferralReferee[];
  payouts: ReferralPayout[];
}

export interface TimeEntry {
  id: string;
  jobId: string;
  durationMinutes: number;
  description?: string;
  startedAt?: string;
  createdAt: string;
}

export interface TimeInvoice {
  id: string;
  jobId: string;
  status: "pending" | "approved" | "rejected";
  totalMinutes: number;
  amountXlm: string;
  hourlyRateXlm: string;
  totalAmountXlm: string;
  createdAt: string;
}

export interface BulkActionResponse {
  success: boolean;
  message?: string;
  succeeded: number;
  failed: number;
  processedCount: number;
  failedCount: number;
  results: { id: string; success: boolean; error?: string; boostedUntil?: string }[];
}

export interface JobAnalytics {
  jobId: string;
  title: string;
  applicantCount: number;
  averageBid: string;
  minBid: string;
  maxBid: string;
  views?: number;
  applications: Array<{
    freelancerAddress: string;
    bidAmount: string;
    createdAt: string;
  }>;
  applicationsPerDay: Array<{ day: string; count: number }>;
  averageBidAmount: Array<{ currency: string; avgBid: number; count: number }>;
  skillDistribution: Record<string, number>;
  daysToHire: number | null;
  applicationStatusCounts: Record<string, number>;
}

export interface JobInvitation {
  id: string;
  jobId: string;
  clientAddress: string;
  clientName?: string;
  jobTitle: string;
  jobBudget: string;
  jobCurrency: Currency;
  createdAt: string;
}
