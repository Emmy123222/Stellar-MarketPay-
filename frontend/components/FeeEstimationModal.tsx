/**
 * components/FeeEstimationModal.tsx
 * Pre-flight confirmation for Soroban contract calls (Issue #222, enhanced per #845).
 *
 * Runs `simulateTransaction` to compute the actual fee, shows it in XLM
 * and USD, lets the user set a custom max fee via a slider (1× to 3× of
 * the estimated fee), warns when the wallet's XLM balance is below the fee,
 * and allows proceeding with a default fee when estimation fails.
 */
import { useEffect, useState, useCallback } from "react";
import type { Transaction } from "@stellar/stellar-sdk";
import { estimateSorobanFee, describeContractCall, stroopsToXlm, type FeeEstimate } from "@/lib/sorobanFees";
import { getXLMBalance } from "@/lib/stellar";
import { usePriceContext } from "@/contexts/PriceContext";

const DEFAULT_FEE_STROOPS = BigInt(100_000); // 0.01 XLM default fallback

interface FeeEstimationModalProps {
  /** Pre-built (but not yet prepared) Soroban transaction. */
  transaction: Transaction;
  /** Contract function being called — used for the title. */
  functionName: string;
  /** Wallet that will sign and pay the fee. */
  payerPublicKey: string;
  /** Platform fee in basis points (e.g. 100 = 1%), shown for informational purposes. */
  platformFeeBps?: number;
  /** User clicked "Confirm & Sign". Passes the chosen max fee multiplier and computed max stroops. */
  onConfirm: (details: { maxFeeMultiplier: number; maxFeeStroops: bigint }) => void;
  /** User cancelled or closed the modal. */
  onCancel: () => void;
}

export default function FeeEstimationModal({
  transaction,
  functionName,
  payerPublicKey,
  platformFeeBps,
  onConfirm,
  onCancel,
}: FeeEstimationModalProps) {
  const [estimate, setEstimate] = useState<FeeEstimate | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxFeeMultiplier, setMaxFeeMultiplier] = useState(1);
  const { xlmPriceUsd } = usePriceContext();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      estimateSorobanFee(transaction, xlmPriceUsd),
      getXLMBalance(payerPublicKey).catch(() => "0"),
    ])
      .then(([fee, bal]) => {
        if (cancelled) return;
        setEstimate(fee);
        setBalance(bal);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not estimate fee.");
      });
    return () => {
      cancelled = true;
    };
  }, [transaction, payerPublicKey, xlmPriceUsd]);

  const safeEstimateStroops = estimate?.totalStroops ?? DEFAULT_FEE_STROOPS;
  const maxFeeStroops = safeEstimateStroops * BigInt(Math.round(maxFeeMultiplier * 2)) / BigInt(2);
  const maxFeeXlm = stroopsToXlm(maxFeeStroops);
  const maxFeeUsd =
    typeof xlmPriceUsd === "number" && xlmPriceUsd > 0
      ? Number(maxFeeXlm) * xlmPriceUsd
      : null;

  const balanceXlm = balance ? parseFloat(balance) : null;
  const feeXlm = estimate ? parseFloat(estimate.totalXlm) : null;
  const insufficient = balanceXlm !== null && feeXlm !== null && balanceXlm < feeXlm;

  const handleConfirm = useCallback(() => {
    onConfirm({ maxFeeMultiplier, maxFeeStroops });
  }, [onConfirm, maxFeeMultiplier, maxFeeStroops]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="card max-w-md w-full bg-ink-900 border border-market-500/20">
        <h2 className="font-display text-xl font-bold text-amber-100 mb-1">
          Confirm transaction
        </h2>
        <p className="text-xs text-amber-700 mb-4">
          {describeContractCall(functionName)} — review the fee before signing.
        </p>

        {error && (
          <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-3 mb-4">
            <p className="text-red-400 text-sm mb-1">
              <span className="font-semibold">Fee estimation failed:</span> {error}
            </p>
            <p className="text-amber-300 text-xs">
              You can still proceed with a default max fee of {stroopsToXlm(DEFAULT_FEE_STROOPS)} XLM.
            </p>
          </div>
        )}

        {!estimate && !error && (
          <p className="text-amber-200 text-sm mb-4">Simulating contract call…</p>
        )}

        {estimate && (
          <dl className="text-sm text-amber-200 space-y-2 mb-4">
            <div className="flex justify-between">
              <dt className="text-amber-700">Function</dt>
              <dd className="font-mono">{functionName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Estimated fee</dt>
              <dd className="font-mono">
                {estimate.totalXlm} XLM
                {estimate.totalUsd != null && (
                  <span className="text-amber-700 ml-2">≈ ${estimate.totalUsd.toFixed(4)} USD</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Max fee ({maxFeeMultiplier}×)</dt>
              <dd className="font-mono">
                {maxFeeXlm} XLM
                {maxFeeUsd != null && (
                  <span className="text-amber-700 ml-2">≈ ${maxFeeUsd.toFixed(4)} USD</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-amber-700">Exchange rate</dt>
              <dd className="font-mono">
                {xlmPriceUsd != null
                  ? `1 XLM ≈ $${xlmPriceUsd.toFixed(4)} USD`
                  : "—"}
              </dd>
            </div>
            {platformFeeBps != null && platformFeeBps > 0 && (
              <div className="flex justify-between">
                <dt className="text-amber-700">Platform fee</dt>
                <dd className="font-mono text-amber-400">{(platformFeeBps / 100).toFixed(2)}%</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-amber-700">Wallet balance</dt>
              <dd className="font-mono">
                {balance ? `${parseFloat(balance).toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM` : "—"}
              </dd>
            </div>
          </dl>
        )}

        {/* Custom max-fee slider */}
        <div className="mb-4">
          <label
            htmlFor="max-fee-slider"
            className="block text-xs text-amber-700 mb-2"
          >
            Max fee multiplier: <span className="font-mono text-amber-300">{maxFeeMultiplier}×</span>
            <span className="ml-2 text-amber-600">
              (max: {maxFeeXlm} XLM
              {maxFeeUsd != null && ` ≈ $${maxFeeUsd.toFixed(4)}`})
            </span>
          </label>
          <input
            id="max-fee-slider"
            type="range"
            min={1}
            max={3}
            step={0.5}
            value={maxFeeMultiplier}
            onChange={(e) => setMaxFeeMultiplier(parseFloat(e.target.value))}
            className="w-full h-2 bg-market-500/20 rounded-lg appearance-none cursor-pointer accent-market-400"
            aria-label="Set custom max fee multiplier"
          />
          <div className="flex justify-between text-[11px] text-amber-700 mt-1">
            <span>1× (minimum)</span>
            <span>2×</span>
            <span>3× (maximum)</span>
          </div>
        </div>

        {insufficient && (
          <p className="text-red-400 text-xs mb-3">
            Insufficient balance — top up XLM and try again.
          </p>
        )}

        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-secondary flex-1 text-sm">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={insufficient}
            className="btn-primary flex-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {error ? "Proceed with default fee" : "Confirm & Sign"}
          </button>
        </div>
      </div>
    </div>
  );
}
