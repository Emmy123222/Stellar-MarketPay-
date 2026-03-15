/**
 * utils/types.ts
 * Shared TypeScript types for Stellar MarketPay.
 */

export type JobStatus = "open" | "in_progress" | "completed" | "cancelled";
export type UserRole  = "client" | "freelancer" | "both";

export interface Job {
  id: string;
  title: string;
  description: string;
  budget: string;        // XLM amount as string
  category: string;
  skills: string[];
  status: JobStatus;
  clientAddress: string;
  freelancerAddress?: string;
  escrowContractId?: string;
  applicantCount: number;
  createdAt: string;
  updatedAt: string;
  deadline?: string;
}

export interface Application {
  id: string;
  jobId: string;
  freelancerAddress: string;
  proposal: string;
  bidAmount: string;     // XLM amount as string
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
