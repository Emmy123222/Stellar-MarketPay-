/**
 * utils/types.ts
 * Shared TypeScript types for Stellar MarketPay.
 */

export type JobStatus = "open" | "in_progress" | "completed" | "cancelled" | "expired";
export type UserRole  = "client" | "freelancer" | "both";
export type Currency  = "XLM" | "USDC";
export type FreelancerTier = "Newcomer" | "Rising Star" | "Expert" | "Top Talent";
export type AvailabilityStatus = "available" | "busy" | "unavailable";
export type PortfolioItemType = "github" | "live" | "stellar_tx";

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

export type FreelancerTier = "Newcomer" | "Rising Star" | "Expert" | "Top Talent";

export type AvailabilityStatus = "available" | "busy" | "unavailable";

export interface Availability {
  status: AvailabilityStatus;
  availableFrom?: string;   // ISO date string
  availableUntil?: string;  // ISO date string
}

export type PortfolioItemType = "github" | "live" | "stellar_tx";

export interface PortfolioItem {
  title: string;
  url: string;
  type: PortfolioItemType;
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

export interface AssessmentQuestion {
  id: number;
  question: string;
  options: string[];
}

export interface AssessmentInfo {
  skill: string;
  label: string;
  questions: AssessmentQuestion[];
  durationSeconds: number;
  passScore: number;
  canRetake: boolean;
  retakeAvailableAt: string | null;
  lastAttempt: { score: number; passed: boolean; taken_at: string } | null;
}

export interface AssessmentResult {
  skill: string;
  score: number;
  passed: boolean;
  correct: number;
  total: number;
}

export interface SkillBadge {
  skill: string;
  score: number;
  passed: boolean;
  taken_at: string;
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
