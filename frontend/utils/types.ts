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
  | "Rising Talent"
  | "Top Rated"
  | "Expert";
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

export interface JobMilestone {
  description: string;
  amount: string;
  status: "pending" | "released" | "disputed" | "rejected";
  releasedAt?: string | null;
  disputedAt?: string | null;
  rejectedAt?: string | null;
}

export interface NotificationItem {
  id: string;
  userAddress: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  jobId?: string | null;
  linkPath?: string | null;
  createdAt: string;
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
  /** URL-safe category slug, used for category filter links. */
  categorySlug?: string;
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
  milestones?: JobMilestone[]; // Up to 10 milestone payments
  expiresAt?: string; // ISO date when job expires if not hired
  extendedCount?: number; // Number of times expiry has been extended
  extendedUntil?: string; // Final expiry after all extensions
  searchHeadline?: string | null; // HTML with <mark> tags from ts_headline
  descriptionHeadline?: string | null; // HTML with <mark> tags from ts_headline
  biddingClosedAt?: string | null;
  clientReputationScore?: number | null;
  disputedBy?: string;
  disputedAt?: string | null;
  disputeReason?: string | null;
  disputeDescription?: string | null;
  isInvited?: boolean; // True if the current viewer has been invited to this job
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
  bidAmount: string;
  currency: Currency;
  status: "pending" | "accepted" | "rejected";
  screeningAnswers?: Record<string, string>;
  estimatedDuration?: string;
  bidCommitment?: string | null;
  bidRevealed?: boolean;
  revealedBidAmount?: string | null;
  revealedAt?: string | null;
  createdAt: string;
  acceptedAt?: string;
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
  ratingCount?: number;
  referralCount?: number;
  reputationPoints?: number;
  reputationScore?: number;
  reputationMetrics?: {
    avgAcceptHours: number;
    avgReleaseHours: number;
  };
  didHash?: string;
  isKycVerified?: boolean;
  createdAt: string;
  updatedAt?: string;
  blockedAddresses?: string[];
}

export interface ProfileStats {
  totalApplications: number;
  acceptedApplications: number;
  successRate: number;
}

export interface ResponseTime {
  averageDays: number | null;
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

export interface PriceAlert {
  id: string;
  userAddress: string;
  condition: "above" | "below";
  threshold: number;
  oneTime: boolean;
  triggered: boolean;
  triggeredAt: string | null;
  createdAt: string;
}

export interface ClientSpendingFreelancer {
  freelancerAddress: string;
  jobsCount: number;
  totalPaidXlm: string;
}

export interface ClientSpendingMonthly {
  month: string; // "YYYY-MM"
  totalSpentXlm: number;
}

export interface ClientSpendingAnalytics {
  totalSpentXlm: string;
  totalBudgetXlm?: string;
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
  monthly?: ClientSpendingMonthly[];
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
  attachmentCid?:  string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  attachmentMime?: string | null;
  senderNaclPub?:  string | null;
}

export interface PortfolioFile {
  cid: string;
  /** Gateway URL for the pinned file, when the API supplies one. */
  url?: string;
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
  milestoneIndex?: number | null;
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

// ─── Analytics ───────────────────────────────────────────────────────────────

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
  applicationsPerDay: { day: string; count: number }[];
  averageBidAmount: { currency: string; avgBid: number; count: number }[];
  applicationStatusCounts: { pending?: number; accepted?: number; rejected?: number; [key: string]: number | undefined };
  skillDistribution: Record<string, number>;
  daysToHire: number | null;
  timeToHire?: number | null;
}

// ─── Job Timeline (Issue #876) ────────────────────────────────────────────────

export type TimelineEventType =
  | "job_posted"
  | "bid_accepted"
  | "escrow_funded"
  | "work_completed"
  | "escrow_released";

export interface TimelineEvent {
  id: string;
  jobId: string;
  eventType: TimelineEventType;
  txHash: string | null;
  createdAt: string;
}

// ─── Bulk Actions ────────────────────────────────────────────────────────────

export interface BulkActionResponse {
  success: boolean;
  message?: string;
  succeeded: number;
  failed: number;
  processedCount: number;
  failedCount: number;
  results: { id: string; success: boolean; error?: string; boostedUntil?: string }[];
}

// ─── Job Invitations ─────────────────────────────────────────────────────────

export interface JobInvitation {
  id: string;
  jobId: string;
  clientAddress: string;
  clientName?: string;
  freelancerAddress: string;
  jobTitle: string;
  jobBudget: string;
  jobCurrency: Currency;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  adminAddress: string;
  action: string;
  resource: string;
  timestamp: string;
  changesDiff?: Record<string, any>;
}

// ─── Passkeys (WebAuthn) ────────────────────────────────────────────────────

export interface PasskeyCredential {
  id: string;
  credential_name: string;
  created_at: string;
}

// ─── Referral Pipeline (Issue #1559) ─────────────────────────────────────────

export type PipelineStatus = "registered" | "first_job_completed" | "credit_paid";

export interface PipelineReferee {
  id: string;
  refereeAddress: string;
  refereeDisplayName: string | null;
  status: PipelineStatus;
  registeredAt: string;
  firstJobId: string | null;
  firstJobTitle: string | null;
  firstJobCompletedAt: string | null;
  creditXlm: string | null;
  paidAt: string | null;
}

export interface MyReferralStats {
  referralLink: string;
  bonusBps: number;
  totalReferred: number;
  pendingCreditsXlm: string | null;
  paidCreditsXlm: string | null;
  pipeline: {
    registered: number;
    firstJobCompleted: number;
    creditPaid: number;
  };
  referees: PipelineReferee[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Auto-Convert XLM to USDC (Issue #1560) ──────────────────────────────────

export interface AutoConvertSettings {
  enabled: boolean;
  slippageBps: number;
  usdcIssuer: string;
}

export interface AutoConversion {
  id: string;
  userAddress: string;
  jobId: string | null;
  jobTitle: string | null;
  milestoneIndex: number | null;
  sourceAmountXlm: string;
  quotedUsdc: string | null;
  destMinUsdc: string | null;
  receivedUsdc: string | null;
  exchangeRate: string | null;
  txHash: string | null;
  status: "pending" | "completed" | "failed" | "skipped";
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  path?: Array<{ type: string; code?: string; issuer?: string }>;
  quoteAvailable?: boolean;
}

export interface AutoConvertHistory {
  conversions: AutoConversion[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── On-Chain Reputation (Issue #1561) ───────────────────────────────────────

export type ReputationLabel = "New" | "Building" | "Established" | "Trusted" | "Excellent";

export interface ReputationScore {
  userId: string;
  score: number;
  scoreBps: number;
  label: ReputationLabel;
  completedJobs: number;
  disputeRate: number;
  avgResponseHours: number | null;
  avgRating: number | null;
  ratingCount: number;
  referralQuality: number;
  updatedAt: string;
}

