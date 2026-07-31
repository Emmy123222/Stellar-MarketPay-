import { api } from "./client";
import type { ReferralStats } from "@/utils/types";

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
