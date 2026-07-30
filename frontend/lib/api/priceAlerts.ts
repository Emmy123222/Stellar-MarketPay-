import { api } from "./client";
import type { PriceAlert } from "@/utils/types";

export type { PriceAlert };

// ─── Price Alerts (Issue #887) ─────────────────────────────────────────────

/**
 * Create a new price alert with condition/threshold.
 */
export async function createPriceAlert(payload: {
  condition: "above" | "below";
  threshold: number;
  oneTime?: boolean;
}): Promise<PriceAlert> {
  const { data } = await api.post<{ success: boolean; data: PriceAlert }>(
    "/api/price-alerts",
    payload,
  );
  return data.data;
}

/**
 * List price alerts for the authenticated user.
 */
export async function fetchPriceAlerts(): Promise<PriceAlert[]> {
  const { data } = await api.get<{ success: boolean; data: PriceAlert[] }>(
    "/api/price-alerts",
  );
  return data.data;
}

/**
 * Delete a price alert by ID.
 */
export async function deletePriceAlert(id: string): Promise<void> {
  await api.delete(`/api/price-alerts/${id}`);
}
