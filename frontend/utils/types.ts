/**
 * utils/types.ts
 * Shared TypeScript types for Stellar MarketPay.
 */

export type JobStatus = "open" | "in_progress" | "completed" | "cancelled" | "expired";
export type UserRole  = "client" | "freelancer" | "both";
export type Currency  = "XLM" | "USDC";
export type JobVisibility = "public" | "private" | "invite_only";
export type FreelancerTier = "Newcomer" | "Rising Star" | "Expert" | "Top Talent";
export type AvailabilityStatus = "available" | "busy" | "unavailable";
export type PortfolioItemType = "github" | "live" | "stellar_tx" | "file";

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
  icon?: string;
  verified?: boolean;
}

export interface TokenBalance {
  balance: string;
  exists: boolean;
  limit: string;
}

export interface ApplicationStatusCounts {
  pending?: number;
  accepted?: number;
  rejected?: number;
}

export interface ApplicationPerDay {
  day: string;
  count: number;
}

export interface AverageBid {
  currency: Currency;
  avgBid: number;
  count: number;
}

export interface JobAnalytics {
  applicationsPerDay: ApplicationPerDay[];
  averageBidAmount: AverageBid[];
  skillDistribution: Record<string, number>;
  daysToHire: number | null;
  applicationStatusCounts: ApplicationStatusCounts;
}

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
  budget: string;        // Amount as string
  currency: Currency;   // XLM or USDC
  category: string;
  visibility?: JobVisibility;
  skills: string[];
  status: JobStatus;
  clientAddress: string;
  freelancerAddress?: string;
  escrowContractId?: string;
  applicantCount: number;
  shareCount?: number;   // Track share clicks
  boosted?: boolean;     // Featured/boosted status
  boostedUntil?: string; // ISO date when boost expires
  createdAt: string;
  updatedAt: string;
  deadline?: string;
  timezone?: string;     // IANA timezone string (e.g., "America/New_York")
  screeningQuestions?: string[];  // Up to 5 screening questions
  expiresAt?: string;    // ISO date when job expires if not hired
  extendedCount?: number; // Number of times expiry has been extended
  extendedUntil?: string; // Final expiry after all extensions
}

export interface Application {
  id: string;
  jobId: string;
  freelancerAddress: string;
  freelancerTier?: FreelancerTier;
  proposal: string;
  bidAmount: string;     // Amount as string
  currency: Currency;    // XLM or USDC
  status: "pending" | "accepted" | "rejected";
  screeningAnswers?: Record<string, string>;  // Question -> Answer mapping
  referredBy?: string;
  createdAt: string;
}

export interface ProfileStats {
  totalApplications: number;
  acceptedApplications: number;
  successRate: number;
}

export interface ResponseTimeStats {
  averageDays: number | null;
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
  reputationPoints?: number;
  referralCount?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface Rating {
  id: string;
  jobId: string;
  raterAddress: string;
  ratedAddress: string;
  stars: number;          // 1–5
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

export interface EscrowState {
  contractId: string;
  jobId: string;
  client: string;
  freelancer: string;
  amount: string;
  status: "locked" | "released" | "refunded" | "disputed";
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
}
