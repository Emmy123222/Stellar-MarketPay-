import { api } from "./client";
import type {
  AutoConvertSettings,
  AutoConversion,
  AutoConvertHistory,
  SwapQuote,
  ManualSwapStart,
} from "@/utils/types";

/**
 * Fetch auto-convert settings for the authenticated user (Issue #1560).
 */
export async function fetchAutoConvertSettings(): Promise<AutoConvertSettings> {
  const { data } = await api.get<{
    success: boolean;
    data: AutoConvertSettings;
  }>("/api/auto-convert/settings");
  return data.data;
}

/**
 * Update auto-convert settings (toggle enabled or adjust slippage bps).
 */
export async function updateAutoConvertSettings(payload: {
  enabled?: boolean;
  slippageBps?: number;
}): Promise<AutoConvertSettings> {
  const { data } = await api.patch<{
    success: boolean;
    data: AutoConvertSettings;
  }>("/api/auto-convert/settings", payload);
  return data.data;
}

/**
 * Fetch pending auto-conversions with fresh Horizon quotes.
 */
export async function fetchPendingAutoConversions(): Promise<AutoConversion[]> {
  const { data } = await api.get<{ success: boolean; data: AutoConversion[] }>(
    "/api/auto-convert/pending",
  );
  return data.data;
}

/**
 * Complete an auto-conversion by providing the on-chain tx hash.
 */
export async function completeAutoConversion(
  id: string,
  txHash: string,
): Promise<AutoConversion> {
  const { data } = await api.post<{ success: boolean; data: AutoConversion }>(
    `/api/auto-convert/${encodeURIComponent(id)}/complete`,
    { txHash },
  );
  return data.data;
}

/**
 * Dismiss or skip a pending auto-conversion.
 */
export async function dismissAutoConversion(
  id: string,
  opts?: { status?: "failed" | "skipped"; error?: string },
): Promise<AutoConversion> {
  const { data } = await api.post<{ success: boolean; data: AutoConversion }>(
    `/api/auto-convert/${encodeURIComponent(id)}/dismiss`,
    opts,
  );
  return data.data;
}

/**
 * Live XLM → USDC quote (rate, estimated receive, network fee) for the
 * dashboard "Swap earnings" flow (Issue #1547).
 */
export async function fetchSwapQuote(
  amountXlm: string,
  slippageBps?: number,
): Promise<SwapQuote> {
  const { data } = await api.post<{ success: boolean; data: SwapQuote }>(
    "/api/auto-convert/quote",
    { amountXlm, slippageBps },
  );
  return data.data;
}

/**
 * Start a manual XLM → USDC swap. Returns a pending conversion whose quote the
 * wallet signs with pathPaymentStrictSend before completing it.
 */
export async function createManualSwap(
  amountXlm: string,
  slippageBps?: number,
): Promise<ManualSwapStart> {
  const { data } = await api.post<{ success: boolean; data: ManualSwapStart }>(
    "/api/auto-convert/manual",
    { amountXlm, slippageBps },
  );
  return data.data;
}

/**
 * Fetch paginated auto-conversion payment history.
 */
export async function fetchAutoConvertHistory(opts?: {
  page?: number;
  limit?: number;
}): Promise<AutoConvertHistory> {
  const params = new URLSearchParams();
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.limit) params.set("limit", String(opts.limit));

  const query = params.toString();
  const url = `/api/auto-convert/history${query ? `?${query}` : ""}`;
  const { data } = await api.get<{
    success: boolean;
    data: AutoConvertHistory;
  }>(url);
  return data.data;
}
