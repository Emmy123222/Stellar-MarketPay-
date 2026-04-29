/**
 * components/FeeEstimationModal.tsx
 * Pre-flight confirmation for Soroban contract calls (Issue #222).
 *
 * Runs `simulateTransaction` to compute the actual fee, shows it in XLM
 * and USD, warns when the wallet's XLM balance is below the fee, and lets
 * the user cancel before signing.
 */
import { useEffect, useState } from "react";
import type { Transaction } from "@stellar/stellar-sdk";
import { estimateSorobanFee, describeContractCall, type FeeEstimate } from "@/lib/sorobanFees";
import { getXLMBalance } from "@/lib/stellar";
import { usePriceContext } from "@/contexts/PriceContext";

interface FeeEstimationModalProps {
  /** Pre-built (but not yet prepared) Soroban transaction. */
  transaction: Transaction;
  /** Contract function being called — used for the title. */
  functionName: string;
  /** Wallet that will sign and pay the fee. */
  payerPublicKey: string;
  /** User clicked "Confirm & Sign". */
  onConfirm: () => void;
  /** User cancelled or closed the modal. */
  onCancel: () => void;
}

export default function FeeEstimationModal({
  transaction,
  functionName,
  payerPublicKey,
  onConfirm,
  onCancel,
}: FeeEstimationModalProps) {
  const [estimate, setEstimate] = useState<FeeEstimate | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const balanceXlm = balance ? parseFloat(balance) : null;
  const feeXlm = estimate ? parseFloat(estimate.totalXlm) : null;
  const insufficient = balanceXlm !== null && feeXlm !== null && balanceXlm < feeXlm;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="card max-w-md w-full bg-ink-900 border border-market-500/20">
        <h2 className="font-display text-xl font-bold text-amber-100 mb-1">
          Confirm transaction
        </h2>
        <p className="text-xs text-amber-700 mb-4">
          {describeContractCall(functionName)} — review the fee before signing.
        </p>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

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
              <dt className="text-amber-700">Wallet balance</dt>
              <dd className="font-mono">
                {balance ? `${parseFloat(balance).toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM` : "—"}
              </dd>
            </div>
          </dl>
        )}

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
            onClick={onConfirm}
            disabled={!estimate || Boolean(error) || insufficient}
            className="btn-primary flex-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm & Sign
          </button>
        </div>
      </div>
    </div>
  );
}
