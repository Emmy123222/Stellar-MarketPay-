/**
 * lib/sorobanFees.ts
 * Fee estimation for Soroban contract calls.
 *
 * Two modes:
 *  1. estimateSorobanFee()  — simulate a specific tx to get its exact resource fee.
 *  2. fetchGasEstimate()    — fetch the dynamic Slow/Medium/Fast tiers from the backend API.
 *     Use this before building a transaction so you can pre-populate the fee field.
 */

import { Transaction, SorobanRpc } from "@stellar/stellar-sdk";
import { sorobanServer, NETWORK_PASSPHRASE } from "./stellar";

// ─── Per-transaction simulation ──────────────────────────────────────────────

export interface FeeEstimate {
  /** Sum of base fee + Soroban resource fee, in stroops. */
  totalStroops: bigint;
  /** Same value as a human-readable XLM amount (max 7 decimals). */
  totalXlm: string;
  /** USD equivalent — null if no price available. */
  totalUsd: number | null;
  /** Just the resource (CPU/memory/storage) portion. */
  resourceFeeStroops: bigint;
  /** The base inclusion fee that was set on the transaction. */
  inclusionFeeStroops: bigint;
}

const STROOPS_PER_XLM = BigInt(10_000_000);

export function stroopsToXlm(stroops: bigint): string {
  const integer = stroops / STROOPS_PER_XLM;
  const fraction = stroops % STROOPS_PER_XLM;
  const fractionStr = fraction.toString().padStart(7, "0").replace(/0+$/, "");
  return fractionStr ? `${integer}.${fractionStr}` : integer.toString();
}

/**
 * Run `simulateTransaction` on a Soroban transaction and return the fee that
 * will actually be charged. Throws a friendly error if simulation fails.
 */
export async function estimateSorobanFee(
  tx: Transaction,
  xlmPriceUsd: number | null
): Promise<FeeEstimate> {
  const sim = await sorobanServer.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Could not estimate fee — the contract rejected the call: ${sim.error}`);
  }

  const resourceFeeStroops = BigInt(sim.minResourceFee || "0");
  const inclusionFeeStroops = BigInt(tx.fee || "0");
  const totalStroops = resourceFeeStroops + inclusionFeeStroops;

  const totalXlm = stroopsToXlm(totalStroops);
  const totalUsd = typeof xlmPriceUsd === "number" ? Number(totalXlm) * xlmPriceUsd : null;

  return {
    totalStroops,
    totalXlm,
    totalUsd,
    resourceFeeStroops,
    inclusionFeeStroops,
  };
}

/**
 * After submission, Horizon/RPC reports the actual fee charged.
 * Used for the post-confirmation log line.
 */
export async function fetchActualFee(txHash: string): Promise<{
  feeChargedStroops: bigint;
  feeChargedXlm: string;
} | null> {
  try {
    const info = await sorobanServer.getTransaction(txHash);
    if (info.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) return null;
    const meta = (info as unknown as { resultMetaXdr?: unknown }).resultMetaXdr;
    if (!meta) return null;
    const feeChargedRaw = (info as unknown as { feeCharged?: string | number }).feeCharged;
    if (feeChargedRaw == null) return null;
    const feeChargedStroops = BigInt(feeChargedRaw);
    return {
      feeChargedStroops,
      feeChargedXlm: stroopsToXlm(feeChargedStroops),
    };
  } catch {
    return null;
  }
}

// ─── Dynamic fee tiers from backend ──────────────────────────────────────────

export type FeeTierLabel = "slow" | "medium" | "fast";

export interface FeeTier {
  label: FeeTierLabel;
  /** Raw fee in stroops. */
  stroops: number;
  /** Human-readable XLM amount. */
  xlm: string;
  /** USD equivalent, or null when XLM price is unavailable. */
  usd: number | null;
}

export interface GasEstimateResult {
  slow: FeeTier;
  medium: FeeTier;
  fast: FeeTier;
  /** True when the network is experiencing a fee spike. */
  spikeDetected: boolean;
  /** Overall network congestion level. */
  networkCongestion: "low" | "medium" | "high" | "unknown";
  /** Last processed ledger sequence, or null. */
  ledger: string | null;
  /** Ledger minimum base fee in stroops. */
  ledgerBaseFeeStroops: number;
  /** ISO timestamp of when the estimate was computed. */
  updatedAt: string;
  /** True when the result was served from cache. */
  cached: boolean;
  /** True when the estimator fell back to hardcoded defaults. */
  fallback?: boolean;
}

/**
 * Fetch the dynamic Slow/Medium/Fast fee tiers from the MarketPay backend.
 * Falls back gracefully to hardcoded defaults when the API is unreachable.
 *
 * @param opts.currency  Pass "USD" to include USD values in the response.
 * @param opts.apiUrl    Override the API base URL (defaults to NEXT_PUBLIC_API_URL).
 */
export async function fetchGasEstimate(opts: {
  currency?: "XLM" | "USD";
  apiUrl?: string;
} = {}): Promise<GasEstimateResult> {
  const base = opts.apiUrl
    ?? (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_API_URL ?? "" : "");

  const url = `${base}/api/gas-estimate${opts.currency === "USD" ? "?currency=USD" : ""}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`Gas estimate API returned ${res.status}`);
  }

  const json = await res.json();
  if (!json?.success || !json?.data) {
    throw new Error("Unexpected gas estimate API response format");
  }

  return json.data as GasEstimateResult;
}

/**
 * Same as fetchGasEstimate but never throws — returns a hardcoded fallback on error.
 * Ideal for use in transaction-building flows where you want a best-effort fee.
 */
export async function fetchGasEstimateSafe(opts: {
  currency?: "XLM" | "USD";
  apiUrl?: string;
} = {}): Promise<GasEstimateResult> {
  try {
    return await fetchGasEstimate(opts);
  } catch {
    return {
      slow:   { label: "slow",   stroops: 100,  xlm: "0.0000100", usd: null },
      medium: { label: "medium", stroops: 200,  xlm: "0.0000200", usd: null },
      fast:   { label: "fast",   stroops: 1000, xlm: "0.0001000", usd: null },
      spikeDetected: false,
      networkCongestion: "unknown",
      ledger: null,
      ledgerBaseFeeStroops: 100,
      updatedAt: new Date().toISOString(),
      cached: false,
      fallback: true,
    };
  }
}

/**
 * Given a selected fee tier, return the stroops value to use as the transaction fee.
 * Applies a small buffer (10%) on top of the tier value to improve inclusion odds.
 *
 * @param tier       The chosen tier from a GasEstimateResult.
 * @param bufferPct  Buffer percentage to add on top (default: 10).
 * @returns          Fee in stroops as a string (required by TransactionBuilder).
 */
export function tierToTransactionFee(tier: FeeTier, bufferPct = 10): string {
  const withBuffer = Math.ceil(tier.stroops * (1 + bufferPct / 100));
  return String(Math.max(withBuffer, 100)); // never below protocol minimum
}

/** Human label for a contract call, used in confirmation modals. */
export function describeContractCall(fnName: string): string {
  const labels: Record<string, string> = {
    create_escrow: "Lock job budget in escrow",
    start_work: "Mark job as in progress",
    release_escrow: "Release escrow to freelancer",
    release_with_conversion: "Release escrow with currency conversion",
    refund_escrow: "Refund escrow to client",
    raise_dispute: "Raise dispute on escrow",
    mint_certificate: "Mint completion certificate",
    cast_vote: "Cast governance vote",
  };
  return labels[fnName] || fnName.replace(/_/g, " ");
}

export { NETWORK_PASSPHRASE };
