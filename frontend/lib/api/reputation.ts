import { api } from "./client";
import type { ReputationScore } from "@/utils/types";

/**
 * Fetch on-chain reputation score for a Stellar address (Issue #1561).
 */
export async function fetchReputation(
  userId: string,
): Promise<ReputationScore> {
  const { data } = await api.get<{ success: boolean; data: ReputationScore }>(
    `/api/reputation/${encodeURIComponent(userId)}`,
  );
  return data.data;
}
