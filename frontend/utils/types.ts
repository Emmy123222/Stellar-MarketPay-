/**
 * utils/types.ts
 * Shared TypeScript types for Stellar MarketPay.
 */

export type JobStatus = "open" | "in_progress" | "completed" | "cancelled";
export type UserRole  = "client" | "freelancer" | "both";
export type Currency  = "XLM" | "USDC";

export interface Job {
  id: string;
  title: string;
  description: string;
  budget: string;        // Amount as string
  currency: Currency;   // XLM or USDC
  category: string;
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
}

export interface Application {
  id: string;
  jobId: string;
  freelancerAddress: string;
  proposal: string;
  bidAmount: string;     // Amount as string
  currency: Currency;    // XLM or USDC
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

export interface UserProfile {
  publicKey: string;
  displayName?: string;
  bio?: string;
  skills?: string[];
  role: UserRole;
  completedJobs: number;
  totalEarnedXLM: string;
  rating?: number;
  /** Number of ratings received (when returned by profile API). */
  ratingCount?: number;
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

export interface EscrowState {
  contractId: string;
  jobId: string;
  client: string;
  freelancer: string;
  amount: string;
  status: "locked" | "released" | "refunded" | "disputed";
  createdLedger: number;
}
