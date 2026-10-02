import { api } from "./client";

export interface UnifiedSearchJob {
  id: string;
  title: string;
  description: string;
  budget: string;
  currency: string;
  category: string;
  status: string;
  clientAddress?: string;
  createdAt?: string;
  rank?: number;
}

export interface UnifiedSearchFreelancer {
  publicKey: string;
  displayName?: string;
  bio?: string;
  skills?: string[];
  rating?: number | null;
  completedJobs?: number;
  role?: string;
  createdAt?: string;
  rank?: number;
}

export interface UnifiedSearchProposal {
  id: string;
  title: string;
  description: string;
  type: string;
  proposer: string;
  amount?: string;
  recipient?: string;
  status: string;
  votingEndsAt?: string;
  createdAt?: string;
  rank?: number;
}

export interface UnifiedSearchResult {
  jobs: UnifiedSearchJob[];
  freelancers: UnifiedSearchFreelancer[];
  proposals: UnifiedSearchProposal[];
}

/**
 * Platform-wide unified search across jobs, freelancers, and DAO proposals.
 * GET /api/search?q=
 */
export async function searchUnified(
  query: string,
  limit = 5,
): Promise<UnifiedSearchResult> {
  const { data } = await api.get<UnifiedSearchResult>("/api/search", {
    params: { q: query, limit },
  });
  return data;
}
