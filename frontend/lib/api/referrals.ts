import { api } from "./client";
import type { ReferralStats, MyReferralStats } from "@/utils/types";

/**
 * Fetch referral dashboard stats and pipeline for the authenticated caller (Issue #1559).
 */
export async function fetchMyReferralStats(opts?: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<MyReferralStats> {
  const params = new URLSearchParams();
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.status) params.set("status", opts.status);

  const query = params.toString();
  const url = `/api/referrals/my-stats${query ? `?${query}` : ""}`;
  const { data } = await api.get<{ success: boolean; data: MyReferralStats }>(url);
  return data.data;
}

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

