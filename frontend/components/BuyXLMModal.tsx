/**
 * components/BuyXLMModal.tsx
 * SEP-0024 deposit flow — converts fiat to XLM via a Stellar anchor.
 * (Issue #220)
 *
 * When the installed Freighter extension supports requestBuy() (>= 5.0.0),
 * the native on-ramp UI is opened directly. Older versions and missing/
 * disconnected Freighter fall back to the SEP-0024 anchor flow.
 */
import { useEffect, useRef, useState } from "react";
import {
  ANCHOR_HOME_DOMAIN,
  fetchAnchorEndpoints,
  startInteractiveDeposit,
  pollAnchorTransaction,
  type AnchorTransactionRecord,
} from "@/lib/anchors";
import { supportsRequestBuy, freighterRequestBuy } from "@/lib/wallet";
import { useToast } from "@/components/Toast";
import { usePriceContext } from "@/contexts/PriceContext";

interface BuyXLMModalProps {
  publicKey: string;
  onClose: () => void;
  /** Refresh the dashboard balance after a successful deposit. */
  onComplete?: () => void;
}

type Phase = "idle" | "loading" | "interactive" | "polling" | "completed" | "error";

export default function BuyXLMModal({ publicKey, onClose, onComplete }: BuyXLMModalProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [assetCode, setAssetCode] = useState<string>("XLM");
  const [availableAssets, setAvailableAssets] = useState<string[]>(["XLM"]);
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<AnchorTransactionRecord | null>(null);
  // Three-state: null = not yet checked, true/false = checked
  const [canUseFreighterOnRamp, setCanUseFreighterOnRamp] = useState<boolean | null>(null);
  const cancelRef = useRef(false);
  const popupRef = useRef<Window | null>(null);
  const toast = useToast();
  const { xlmPriceUsd } = usePriceContext();

  // Check Freighter on-ramp support on mount
  useEffect(() => {
    supportsRequestBuy()
      .then(setCanUseFreighterOnRamp)
      .catch(() => setCanUseFreighterOnRamp(false));
  }, []);

  useEffect(() => {
    fetchAnchorEndpoints()
      .then((endpoints) => {
        const codes = endpoints.currencies.map((c) => c.code);
        if (codes.length > 0) {
          setAvailableAssets(codes);
          if (!codes.includes(assetCode)) setAssetCode(codes[0]);
        }
      })
      .catch(() => {
        // If TOML fetch fails the user can still try; the deposit call will surface the error.
      });
    return () => {
      cancelRef.current = true;
      popupRef.current?.close();
    };
  }, [assetCode]);

  // ── Freighter native on-ramp ──────────────────────────────────────────────

  const startFreighterOnRamp = async () => {
    setPhase("loading");
    setErrorMessage(null);
    try {
      await freighterRequestBuy("XLM");
      // requestBuy resolves once the user completes or closes the Freighter UI.
      setPhase("completed");
      toast.success("XLM purchase initiated via Freighter.");
      onComplete?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // User cancelled — treat as a non-error dismissal
      if (
        msg.toLowerCase().includes("cancel") ||
        msg.toLowerCase().includes("declined") ||
        msg.toLowerCase().includes("rejected") ||
        msg.toLowerCase().includes("closed")
      ) {
        setPhase("idle");
      } else {
        setPhase("error");
        setErrorMessage(msg || "Freighter on-ramp failed.");
      }
    }
  };

  // ── SEP-0024 anchor fallback ──────────────────────────────────────────────

  const startDeposit = async () => {
    setPhase("loading");
    setErrorMessage(null);
    try {
      const response = await startInteractiveDeposit({
        account: publicKey,
        assetCode,
      });

      const popup = window.open(
        `${response.url}${response.url.includes("?") ? "&" : "?"}callback=postMessage`,
        "stellar-anchor-deposit",
        "width=500,height=700"
      );
      popupRef.current = popup;
      setInteractiveUrl(response.url);
      setPhase("interactive");

      const finalRecord = await pollAnchorTransaction({
        account: publicKey,
        id: response.id,
        onUpdate: (record) => {
          setTransaction(record);
          if (phase === "interactive") setPhase("polling");
        },
        isCancelled: () => cancelRef.current,
      });

      if (cancelRef.current) return;

      if (finalRecord?.status === "completed") {
        setTransaction(finalRecord);
        setPhase("completed");
        toast.success(`Deposit complete — ${finalRecord.amount_out || ""} ${assetCode} arrived in your wallet.`);
        onComplete?.();
      } else if (finalRecord) {
        setTransaction(finalRecord);
        setPhase("error");
        setErrorMessage(`Deposit ended with status "${finalRecord.status}".`);
      } else {
        setPhase("error");
        setErrorMessage("Deposit timed out. Check the anchor's tracking page for status.");
      }
    } catch (error: unknown) {
      setPhase("error");
      setErrorMessage(error instanceof Error ? error.message : "Deposit failed.");
    }
  };

  const usdNote =
    xlmPriceUsd && transaction?.amount_out
      ? `≈ $${(parseFloat(transaction.amount_out) * xlmPriceUsd).toFixed(2)} USD`
      : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="card max-w-md w-full bg-ink-900 border border-market-500/20 relative">
        <button
          onClick={() => {
            cancelRef.current = true;
            popupRef.current?.close();
            onClose();
          }}
          className="absolute top-3 right-3 text-amber-700 hover:text-amber-300"
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className="font-display text-xl font-bold text-amber-100 mb-1">Buy XLM with Fiat</h2>

        {/* Freighter on-ramp path */}
        {canUseFreighterOnRamp === true && phase === "idle" && (
          <div className="space-y-4">
            <p className="text-xs text-amber-700 mb-5">
              Your Freighter wallet supports a built-in purchase flow.
            </p>
            <button
              onClick={startFreighterOnRamp}
              className="btn-primary w-full"
              data-testid="freighter-onramp-btn"
            >
              Buy XLM via Freighter
            </button>
            <button
              onClick={() => setCanUseFreighterOnRamp(false)}
              className="btn-secondary w-full text-xs"
              data-testid="use-anchor-fallback-btn"
            >
              Use exchange list instead
            </button>
          </div>
        )}

        {/* Anchor/exchange fallback path */}
        {(canUseFreighterOnRamp === false || canUseFreighterOnRamp === null) && phase === "idle" && (
          <div className="space-y-4">
            <p className="text-xs text-amber-700 mb-5">
              Powered by <span className="font-mono">{ANCHOR_HOME_DOMAIN}</span> via SEP-0024.
            </p>
            <label className="block">
              <span className="label mb-1 block">Asset to receive</span>
              <select
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
                className="input-field"
              >
                {availableAssets.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </label>
            <p className="text-xs text-amber-700">
              You&apos;ll be redirected to the anchor&apos;s secure deposit page to enter your fiat
              payment details. The funds arrive in this wallet ({publicKey.slice(0, 6)}…
              {publicKey.slice(-4)}) once the anchor confirms the deposit.
            </p>
            <button
              onClick={startDeposit}
              className="btn-primary w-full"
              data-testid="anchor-deposit-btn"
            >
              Continue
            </button>
          </div>
        )}

        {phase === "loading" && (
          <p className="text-amber-200 text-sm" data-testid="loading-msg">
            {canUseFreighterOnRamp ? "Opening Freighter…" : "Authenticating with the anchor…"}
          </p>
        )}

        {(phase === "interactive" || phase === "polling") && (
          <div className="space-y-3">
            <p className="text-amber-200 text-sm">
              {phase === "interactive"
                ? "Complete the deposit form in the popup window."
                : `Anchor status: ${transaction?.status || "pending"}`}
            </p>
            {interactiveUrl && (
              <a
                href={interactiveUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-xs w-full text-center"
              >
                Reopen anchor window
              </a>
            )}
            {transaction && (
              <dl className="text-xs text-amber-200 space-y-1">
                <div className="flex justify-between"><dt>Transaction ID</dt><dd className="font-mono">{transaction.id.slice(0, 10)}…</dd></div>
                {transaction.amount_in && (
                  <div className="flex justify-between"><dt>Amount in</dt><dd>{transaction.amount_in}</dd></div>
                )}
                {transaction.amount_out && (
                  <div className="flex justify-between"><dt>Amount out</dt><dd>{transaction.amount_out} {assetCode}</dd></div>
                )}
              </dl>
            )}
          </div>
        )}

        {phase === "completed" && (
          <div className="space-y-3">
            <p className="text-emerald-400 text-sm font-medium" data-testid="completed-msg">
              {transaction ? "Deposit complete." : "Purchase initiated via Freighter."}
            </p>
            {transaction && (
              <dl className="text-xs text-amber-200 space-y-1">
                <div className="flex justify-between"><dt>Received</dt><dd>{transaction.amount_out} {assetCode} {usdNote && <span className="text-amber-700">({usdNote})</span>}</dd></div>
                {transaction.stellar_transaction_id && (
                  <div className="flex justify-between">
                    <dt>Stellar tx</dt>
                    <dd className="font-mono">{transaction.stellar_transaction_id.slice(0, 10)}…</dd>
                  </div>
                )}
              </dl>
            )}
            <button onClick={onClose} className="btn-primary w-full">Done</button>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            <p className="text-red-400 text-sm" data-testid="error-msg">{errorMessage || "Something went wrong."}</p>
            <button onClick={() => setPhase("idle")} className="btn-secondary w-full">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
