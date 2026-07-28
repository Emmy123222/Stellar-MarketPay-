/**
 * components/AccountMigration.tsx
 *
 * Account migration form that allows users to migrate their MarketPay profile
 * from an old Stellar address to a new one. Requires cryptographic proof of
 * ownership for both addresses via Freighter wallet signing.
 *
 * Flow:
 *   1. Enter the new Stellar public key
 *   2. Sign the migration message with the current (old) wallet
 *   3. Switch to the new wallet in Freighter and sign again
 *   4. Submit both signatures to POST /api/profiles/migrate
 *
 * @issue #885 — Stellar account merge support for identity migration
 */
import { useState, useCallback } from "react";
import Link from "next/link";
import { isValidStellarAddress } from "@/lib/stellar";
import { shortenAddress } from "@/utils/format";
import { migrateProfile } from "@/lib/api";
import type { UserProfile } from "@/utils/types";

const MIGRATION_MESSAGE = "Stellar MarketPay Account Migration";type MigrationStep =
  | "enter-key"     // User enters new public key
  | "sign-old"      // Ready to sign with old wallet
  | "signing-old"   // Signing with old wallet (Freighter prompting)
  | "sign-new"      // Ready to sign with new wallet
  | "signing-new"   // Signing with new wallet (Freighter prompting)
  | "submitting"    // Sending to backend
  | "retry-submit"  // Submission failed, can retry without re-signing
  | "success";       // Migration complete

interface AccountMigrationProps {
  /** The currently connected wallet public key (old address being migrated from). */
  currentPublicKey: string;
  /** Called after successful migration with the new profile data. */
  onMigrationComplete?: (profile: UserProfile) => void;
  /** Optional className for the outer wrapper. */
  className?: string;
}

/**
 * Sign the migration message using Freighter's signBlob API.
 * Encodes the message as base64 (signBlob expects base64 input)
 * and returns the base64-encoded signature.
 *
 * Uses @stellar/freighter-api v2.0.0+ which exports signBlob.
 * Falls back gracefully if signBlob is not available.
 */
async function signMigrationWithFreighter(
  publicKey: string,
): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("Freighter is only available in the browser.");
  }

  // signBlob is available in @stellar/freighter-api v2.0.0+
  const { signBlob } = await import("@stellar/freighter-api");

  // signBlob expects a base64-encoded input blob
  const blobBase64 = btoa(MIGRATION_MESSAGE);

  let result: unknown;
  try {
    // Try with account parameter (v2.x+ API)
    result = await signBlob(blobBase64, { account: publicKey });
  } catch {
    // Fallback: try without account parameter
    try {
      result = await signBlob(blobBase64);
    } catch (innerErr: unknown) {
      throw new Error(
        "signBlob is not available. Please update your Freighter extension to the latest version.",
      );
    }
  }

  // Handle both object and string return types from Freighter API
  const signedBlob =
    typeof result === "object" && result !== null && "signedBlob" in result
      ? (result as { signedBlob: string }).signedBlob
      : (result as string);

  if (!signedBlob) {
    throw new Error("Freighter did not return a signature.");
  }

  return signedBlob;
}

export default function AccountMigration({
  currentPublicKey,
  onMigrationComplete,
  className = "",
}: AccountMigrationProps) {
  const [step, setStep] = useState<MigrationStep>("enter-key");
  const [newPublicKey, setNewPublicKey] = useState("");
  const [newKeyError, setNewKeyError] = useState<string | null>(null);
  const [oldSignature, setOldSignature] = useState<string | null>(null);
  const [newSignature, setNewSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migratedProfile, setMigratedProfile] = useState<UserProfile | null>(null);

  // ── Validation ──────────────────────────────────────────────────────────────

  const validateNewKey = useCallback(
    (key: string): string | null => {
      if (!key.trim()) return "Please enter a Stellar public key.";
      if (!isValidStellarAddress(key.trim()))
        return "Invalid Stellar public key format.";
      if (key.trim() === currentPublicKey)
        return "The new address must be different from your current address.";
      return null;
    },
    [currentPublicKey],
  );

  // ── Step: Enter new key ─────────────────────────────────────────────────────

  const handleContinue = () => {
    const validationError = validateNewKey(newPublicKey);
    if (validationError) {
      setNewKeyError(validationError);
      return;
    }
    setNewKeyError(null);
    setError(null);
    setStep("sign-old");
  };

  // ── Step: Sign with old wallet ──────────────────────────────────────────────

  const handleSignOld = async () => {
    setError(null);
    setStep("signing-old");
    try {
      const sig = await signMigrationWithFreighter(currentPublicKey);
      setOldSignature(sig);
      setStep("sign-new");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User declined") || msg.includes("rejected")) {
        setError("Signing was cancelled. Please try again.");
      } else {
        setError(`Signing failed: ${msg}`);
      }
      setStep("sign-old");
    }
  };

  // ── Step: Sign with new wallet ──────────────────────────────────────────────

  const handleSignNew = async () => {
    setError(null);
    setStep("signing-new");
    try {
      const sig = await signMigrationWithFreighter(newPublicKey.trim());
      setNewSignature(sig);
      // Auto-trigger submission after signing
      await submitMigration(sig);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User declined") || msg.includes("rejected")) {
        setError("Signing was cancelled. Please try again.");
      } else {
        setError(
          `Signing with new wallet failed: ${msg}. Make sure you have switched to the new account in Freighter.`,
        );
      }
      setStep("sign-new");
    }
  };

  // ── Submit migration ────────────────────────────────────────────────────────

  const submitMigration = async (newSig?: string) => {
    const finalNewSig = newSig ?? newSignature;
    if (!oldSignature || !finalNewSig) return;

    setStep("submitting");
    setError(null);

    try {
      const profile = await migrateProfile({
        oldPublicKey: currentPublicKey,
        newPublicKey: newPublicKey.trim(),
        oldSignature,
        newSignature: finalNewSig,
      });

      setMigratedProfile(profile);
      setStep("success");
      onMigrationComplete?.(profile);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Migration failed. Please try again.";
      setError(msg);
      // Keep signatures valid — allow retry without re-signing
      setStep("retry-submit");
    }
  };

  // ── Reset ───────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setStep("enter-key");
    setNewPublicKey("");
    setNewKeyError(null);
    setOldSignature(null);
    setNewSignature(null);
    setError(null);
    setMigratedProfile(null);
  };

  // ── Shared loading spinner ──────────────────────────────────────────────────

  const Spinner = () => (
    <svg
      className="animate-spin w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={`card border-market-500/15 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 sm:p-6 border-b border-market-500/10">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5 text-amber-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-amber-100">
              Migrate Account
            </h2>
            <p className="text-amber-800 text-sm mt-1">
              Transfer your profile, job history, ratings, and referrals to a
              new Stellar address. This is useful when upgrading to a hardware
              wallet or switching wallets.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-5">
        {/* ── Progress steps indicator ─────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          {(["enter-key", "sign-old", "sign-new"] as const).map((s, i) => {
            const isActive =
              step === s ||
              step === (s === "sign-old" ? "signing-old" : s === "sign-new" ? "signing-new" : "");
            const isDone =
              (s === "enter-key" &&
                step !== "enter-key" &&
                step !== "success" &&
                step !== "error") ||
              (s === "sign-old" && oldSignature !== null) ||
              (s === "sign-new" && newSignature !== null);

            return (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    isDone
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : isActive
                        ? "bg-market-500/20 text-market-400 border border-market-500/30"
                        : "bg-ink-800 text-amber-800 border border-amber-900/30"
                  }`}
                >
                  {isDone ? "✓" : i + 1}
                </div>
                {i < 2 && (
                  <div
                    className={`w-4 h-px ${
                      isDone ? "bg-emerald-500/30" : "bg-amber-900/30"
                    }`}
                  />
                )}
              </div>
            );
          })}
          <span className="text-xs text-amber-800 ml-1">
            {step === "enter-key"
              ? "Enter new key"
              : step === "sign-old" || step === "signing-old"
                ? "Sign old wallet"
                : step === "sign-new" || step === "signing-new"
                  ? "Sign new wallet"
                  : step === "submitting"
                    ? "Submitting..."
                    : step === "success"
                      ? "Complete"
                      : ""}
          </span>
        </div>

        {/* ── Error banner ────────────────────────────────────────────────── */}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <div className="flex items-start gap-2">
              <svg
                className="w-4 h-4 mt-0.5 shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* ── Success state ───────────────────────────────────────────────── */}
        {step === "success" && migratedProfile && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-emerald-300 font-semibold text-sm">
                  Migration successful!
                </p>
                <p className="text-emerald-600/90 text-xs mt-1">
                  Your profile has been migrated to{" "}
                  <span className="font-mono text-emerald-400">
                    {shortenAddress(migratedProfile.publicKey)}
                  </span>
                  . The old address now redirects to this new profile.
                </p>
                <Link
                  href={`/freelancers/${encodeURIComponent(migratedProfile.publicKey)}`}
                  className="inline-flex items-center gap-1 mt-3 text-xs text-market-400 hover:text-market-300 transition-colors"
                >
                  View your new profile →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* ── Step: Enter new key ─────────────────────────────────────────── */}
        {step === "enter-key" && (
          <div className="space-y-4">
            <div>
              <label className="label block mb-1.5">Current address</label>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-ink-900/50 border border-market-500/10">
                <span className="text-sm text-amber-500/70 font-mono break-all">
                  {shortenAddress(currentPublicKey)}
                </span>
              </div>
              <p className="text-xs text-amber-800 mt-1">
                This is your currently connected wallet that will be migrated
                from.
              </p>
            </div>

            <div>
              <label htmlFor="new-public-key" className="label block mb-1.5">
                New Stellar address
              </label>
              <input
                id="new-public-key"
                type="text"
                value={newPublicKey}
                onChange={(e) => {
                  setNewPublicKey(e.target.value);
                  if (newKeyError) setNewKeyError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleContinue();
                }}
                placeholder="GABCD..."
                className={`input w-full font-mono text-sm ${
                  newKeyError
                    ? "border-red-500/40 focus:border-red-500/60"
                    : ""
                }`}
                autoComplete="off"
                spellCheck={false}
              />
              {newKeyError && (
                <p className="text-red-400 text-xs mt-1">{newKeyError}</p>
              )}
              <p className="text-xs text-amber-800 mt-1">
                Enter the Stellar public key you want to migrate to.
              </p>
            </div>

            <button
              onClick={handleContinue}
              disabled={!newPublicKey.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              Continue
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </button>
          </div>
        )}

        {/* ── Step: Signing with old wallet (loading) ──────────────────────── */}
        {step === "signing-old" && (
          <div className="flex flex-col items-center justify-center py-6">
            <Spinner />
            <p className="text-amber-300 text-sm font-semibold mt-3">
              Signing with Freighter...
            </p>
            <p className="text-amber-800 text-xs mt-1">
              Please approve the signature request in your Freighter wallet for{" "}
              <span className="font-mono text-amber-400">
                {shortenAddress(currentPublicKey)}
              </span>
              .
            </p>
          </div>
        )}

        {/* ── Step: Sign with old wallet ──────────────────────────────────── */}
        {step === "sign-old" && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15">
              <p className="text-amber-300 text-sm font-semibold mb-1">
                Sign with your current wallet
              </p>
              <p className="text-amber-700/90 text-xs">
                You will be asked to sign a message in Freighter to prove you
                own{" "}
                <span className="font-mono text-amber-400">
                  {shortenAddress(currentPublicKey)}
                </span>
                . This does not submit any transaction.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  setStep("enter-key");
                  setError(null);
                }}
                className="btn-secondary text-sm flex-1"
              >
                ← Back
              </button>
              <button
                onClick={handleSignOld}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                  />
                </svg>
                Sign with Freighter
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Signing with new wallet (loading) ──────────────────────── */}
        {step === "signing-new" && (
          <div className="flex flex-col items-center justify-center py-6">
            <Spinner />
            <p className="text-amber-300 text-sm font-semibold mt-3">
              Signing with new wallet...
            </p>
            <p className="text-amber-800 text-xs mt-1">
              Please approve the signature request in your Freighter wallet for{" "}
              <span className="font-mono text-amber-400">
                {shortenAddress(newPublicKey.trim())}
              </span>
              .
            </p>
          </div>
        )}

        {/* ── Step: Sign with new wallet ──────────────────────────────────── */}
        {step === "sign-new" && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15">
              <p className="text-amber-300 text-sm font-semibold mb-1">
                Switch wallet &amp; sign with new address
              </p>
              <p className="text-amber-700/90 text-xs">
                <strong className="text-amber-400">Important:</strong> Open
                Freighter and switch to the account for{" "}
                <span className="font-mono text-amber-400">
                  {shortenAddress(newPublicKey.trim())}
                </span>
                , then click the button below to sign the same migration
                message. This proves you own both addresses.
              </p>
            </div>

            {oldSignature && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                <svg
                  className="w-4 h-4 text-emerald-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-xs text-emerald-400">
                  Old wallet signature collected
                </span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  setStep("sign-old");
                  setOldSignature(null);
                  setError(null);
                }}
                className="btn-secondary text-sm flex-1"
              >
                ← Back
              </button>
              <button
                onClick={handleSignNew}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                  />
                </svg>
                Sign with New Wallet
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Submitting ────────────────────────────────────────────── */}
        {step === "submitting" && (
          <div className="flex flex-col items-center justify-center py-6">
            <svg
              className="animate-spin w-8 h-8 text-market-400 mb-3"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <p className="text-amber-300 text-sm font-semibold">
              Migrating your profile...
            </p>
            <p className="text-amber-800 text-xs mt-1">
              Transferring profile data, job history, ratings, and referrals.
              This may take a moment.
            </p>
          </div>
        )}

        {/* ── Step: Retry submission (server error, signatures still valid) ── */}
        {step === "retry-submit" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
              <svg
                className="w-4 h-4 text-emerald-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-xs text-emerald-400">
                Both wallet signatures have been collected — you can retry without
                signing again.
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  setStep("sign-new");
                  setNewSignature(null);
                  setError(null);
                }}
                className="btn-secondary text-sm flex-1"
              >
                Re-sign instead
              </button>
              <button
                onClick={() => submitMigration()}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Retry Migration
              </button>
            </div>
          </div>
        )}

        {/* ── Success actions ─────────────────────────────────────────────── */}
        {step === "success" && (
          <button
            onClick={handleReset}
            className="btn-secondary text-sm w-full"
          >
            Migrate another account
          </button>
        )}

        {/* ── Warning footer ──────────────────────────────────────────────── */}
        {step !== "success" && step !== "submitting" && (
          <div className="pt-4 border-t border-market-500/10">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
              <svg
                className="w-4 h-4 text-amber-500 mt-0.5 shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-xs text-amber-700/90">
                This action cannot be undone. Once migrated, your old address
                will permanently redirect to the new one. All history, ratings,
                and referrals will be transferred.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
