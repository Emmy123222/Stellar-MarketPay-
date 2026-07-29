/**
 * components/BoostJobModal.tsx
 * Issue #344 — Job boost with XLM payment via smart contract.
 *
 * Shows boost tiers, triggers a Freighter transaction to pay the platform
 * treasury, then calls PATCH /api/jobs/:id/boost with the tx hash.
 */
"use client";

import { useState } from "react";
import { buildBoostJobTx, signAndSubmitSorobanTx, XLM_SAC_ADDRESS } from "@/lib/stellar";
import { formatDate } from "@/utils/format";

// ─── Boost tiers ─────────────────────────────────────────────────────────────

interface BoostTier {
  label: string;
  amountXlm: number;
  days: number;
  description: string;
  badge: string;
  recommended?: boolean;
}

const BOOST_TIERS: BoostTier[] = [
  {
    label: "7-Day Boost",
    amountXlm: 5,
    days: 7,
    description: "Featured at the top of listings for 7 days",
    badge: "⚡ Featured",
    recommended: false,
  },
  {
    label: "30-Day Boost",
    amountXlm: 15,
    days: 30,
    description: "Featured at the top of listings for 30 days",
    badge: "🔥 Top Pick",
    recommended: true,
  },
] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

interface BoostJobModalProps {
  jobId: string;
  jobTitle: string;
  clientPublicKey: string;
  onClose: () => void;
  onSuccess: (boostedUntil: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BoostJobModal({
  jobId,
  jobTitle,
  clientPublicKey,
  onClose,
  onSuccess,
}: BoostJobModalProps) {
  const [selectedTier, setSelectedTier] = useState<(typeof BOOST_TIERS)[number]>(
    BOOST_TIERS[0]
  );
  const [step, setStep] = useState<"select" | "signing" | "confirming" | "done" | "error">(
    "select"
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const isMockMode = process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true";
  const treasuryAddress =
    process.env.NEXT_PUBLIC_TREASURY_ADDRESS || clientPublicKey; // fallback for dev

  const handleBoost = async () => {
    setStep("signing");
    setErrorMsg(null);

    try {
      let hash: string;

      if (isMockMode) {
        // Mock mode — skip on-chain tx
        await new Promise((r) => setTimeout(r, 800));
        hash = `mock-boost-${Date.now()}`;
        console.info("[CONTRACT MOCK] boost_job called", {
          jobId,
          amountXlm: selectedTier.amountXlm,
        });
      } else {
        const xdr = await buildBoostJobTx({
          clientPublicKey,
          jobId,
          amountXlm: selectedTier.amountXlm,
          treasuryAddress,
        });
        setStep("confirming");
        hash = await signAndSubmitSorobanTx(xdr);
      }

      setTxHash(hash);

      // Notify backend
      const res = await fetch(`/api/jobs/${jobId}/boost`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: hash, amountXlm: selectedTier.amountXlm }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "Backend boost update failed");
      }

      const boostedUntil = new Date();
      boostedUntil.setDate(boostedUntil.getDate() + selectedTier.days);
      setStep("done");
      onSuccess(boostedUntil.toISOString());
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Boost failed");
      setStep("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-950/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-ink-900 border border-market-500/20 rounded-2xl p-6 shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="font-display text-xl font-bold text-amber-100">
              Boost Job Listing
            </h2>
            <p className="text-xs text-amber-800 mt-0.5 truncate max-w-xs">
              {jobTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-amber-700 hover:text-amber-400 text-xl leading-none ml-4"
          >
            ✕
          </button>
        </div>

        {/* Tier selection */}
        {(step === "select" || step === "error") && (
          <>
            <div className="space-y-3 mb-5">
              {BOOST_TIERS.map((tier) => (
                <button
                  key={tier.label}
                  onClick={() => setSelectedTier(tier)}
                  className={`w-full text-left rounded-xl p-4 border transition-all ${
                    selectedTier.label === tier.label
                      ? "border-market-500/60 bg-market-500/10"
                      : "border-market-500/15 bg-ink-800 hover:border-market-500/30"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-amber-100">
                      {tier.label}
                    </span>
                    <div className="flex items-center gap-2">
                      {tier.recommended && (
                        <span className="text-xs bg-market-500/20 text-market-400 border border-market-500/30 px-2 py-0.5 rounded-full">
                          Best value
                        </span>
                      )}
                      <span className="font-mono text-market-400 font-bold">
                        {tier.amountXlm} XLM
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-amber-700">{tier.description}</p>
                  <p className="text-xs text-amber-800 mt-1">
                    Expires:{" "}
                    {formatDate(
                      new Date(
                        Date.now() + tier.days * 86400000
                      ).toISOString()
                    )}
                  </p>
                </button>
              ))}
            </div>

            {isMockMode && (
              <p className="text-xs text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
                Mock mode — no real XLM will be charged.
              </p>
            )}

            {step === "error" && errorMsg && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
                {errorMsg}
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 btn-secondary py-2.5 text-sm">
                Cancel
              </button>
              <button
                onClick={handleBoost}
                className="flex-1 btn-primary py-2.5 text-sm"
              >
                Pay {selectedTier.amountXlm} XLM &amp; Boost
              </button>
            </div>
          </>
        )}

        {/* Signing / confirming */}
        {(step === "signing" || step === "confirming") && (
          <div className="text-center py-6">
            <div className="w-10 h-10 border-2 border-market-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-amber-100 font-medium">
              {step === "signing"
                ? "Building transaction…"
                : "Waiting for Freighter signature…"}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {step === "confirming" && "Please approve in your Freighter wallet."}
            </p>
          </div>
        )}

        {/* Done */}
        {step === "done" && (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
              <span className="text-emerald-400 text-xl">✓</span>
            </div>
            <p className="text-amber-100 font-semibold mb-1">Boost activated!</p>
            <p className="text-xs text-amber-700 mb-1">
              Your job is now featured for {selectedTier.days} days.
            </p>
            {txHash && (
              <p className="text-xs text-amber-800 font-mono truncate mb-4">
                tx: {txHash}
              </p>
            )}
            <button onClick={onClose} className="btn-primary text-sm px-6 py-2">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
