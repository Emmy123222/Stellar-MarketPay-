/**
 * lib/sorobanFees.ts
 * Fee estimation for Soroban contract calls (Issue #222).
 *
 * Uses `simulateTransaction` to compute the minimum fee a contract call
 * will need, so the user can review and confirm before signing.
 */

import { Transaction, SorobanRpc } from "@stellar/stellar-sdk";
import { sorobanServer, NETWORK_PASSPHRASE } from "./stellar";

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

function stroopsToXlm(stroops: bigint): string {
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
 * Used for the post-confirmation log line in the AC.
 */
export async function fetchActualFee(txHash: string): Promise<{
  feeChargedStroops: bigint;
  feeChargedXlm: string;
} | null> {
  try {
    const info = await sorobanServer.getTransaction(txHash);
    if (info.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) return null;
    // Fee data is most reliably parsed from the result envelope.
    const meta = (info as unknown as { resultMetaXdr?: unknown }).resultMetaXdr;
    if (!meta) return null;
    // The envelope stores the fee in the txInternal: rather than parse XDR
    // here we rely on resultXdr/feeCharged when present.
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

/** Human label for a contract call, used in the confirmation modal. */
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

export { stroopsToXlm, NETWORK_PASSPHRASE };
