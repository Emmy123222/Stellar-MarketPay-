/**
 * components/WithdrawToBankModal.tsx
 * Cross-border withdraw flow (Issue #231).
 *
 * Tries SEP-0031 (direct cross-border payments) first when the anchor
 * advertises it; falls back to SEP-0024 interactive withdraw, which
 * provides a comparable bank-payout UX through the anchor's hosted form.
 *
 * Withdrawal history is persisted client-side in localStorage so the user
 * can review past withdrawals from the dashboard.
 */
import { useEffect, useRef, useState } from "react";
import {
  ANCHOR_HOME_DOMAIN,
  fetchAnchorEndpoints,
  fetchSep31Info,
  initiateSep31Send,
  startInteractiveWithdraw,
  pollAnchorTransaction,
  type AnchorTransactionRecord,
} from "@/lib/anchors";
import { useToast } from "@/components/Toast";

interface WithdrawToBankModalProps {
  publicKey: string;
  onClose: () => void;
}

export type WithdrawHistoryEntry = {
  id: string;
  flow: "SEP-31" | "SEP-24";
  asset: string;
  fiatCurrency: string;
  amount: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  stellarTxId?: string;
  externalTxId?: string;
};

const HISTORY_KEY = "marketpay_withdraw_history";
const FIAT_CURRENCIES = ["USD", "EUR", "NGN"] as const;
type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

/** Returns the most-recent first list of withdrawals saved on this device. */
export function loadWithdrawHistory(): WithdrawHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WithdrawHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: WithdrawHistoryEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 50)));
}

function upsertHistory(entry: WithdrawHistoryEntry) {
  const existing = loadWithdrawHistory();
  const filtered = existing.filter((e) => e.id !== entry.id);
  saveHistory([entry, ...filtered]);
}

type Phase = "form" | "loading" | "interactive" | "polling" | "completed" | "error";

export default function WithdrawToBankModal({ publicKey, onClose }: WithdrawToBankModalProps) {
  const [phase, setPhase] = useState<Phase>("form");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [asset, setAsset] = useState<string>("USDC");
  const [availableAssets, setAvailableAssets] = useState<string[]>([]);
  const [fiat, setFiat] = useState<FiatCurrency>("USD");
  const [amount, setAmount] = useState<string>("");
  const [supportsSep31, setSupportsSep31] = useState<boolean>(false);
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<AnchorTransactionRecord | null>(null);
  const cancelRef = useRef(false);
  const popupRef = useRef<Window | null>(null);
  const toast = useToast();

  useEffect(() => {
    let isMounted = true;
    fetchAnchorEndpoints()
      .then(async (endpoints) => {
        if (!isMounted) return;
        const codes = endpoints.currencies.map((c) => c.code);
        if (codes.length > 0) {
          setAvailableAssets(codes);
          if (!codes.includes(asset)) setAsset(codes[0]);
        }
        if (endpoints.directPaymentServer) {
          const info = await fetchSep31Info().catch(() => null);
          if (isMounted && info) {
            setSupportsSep31(Object.values(info.receive || {}).some((cfg) => cfg.enabled));
          }
        }
      })
      .catch(() => {
        // Surface a generic error if the user attempts to withdraw without TOML.
      });

    return () => {
      isMounted = false;
      cancelRef.current = true;
      popupRef.current?.close();
    };
  }, [asset]);

  const validate = (): string | null => {
    const numeric = parseFloat(amount);
    if (!amount || isNaN(numeric) || numeric <= 0) return "Enter an amount greater than 0.";
    if (!asset) return "Pick an asset to withdraw.";
    return null;
  };

  const startWithdraw = async () => {
    const error = validate();
    if (error) {
      setErrorMessage(error);
      return;
    }
    setErrorMessage(null);
    setPhase("loading");

    try {
      let id: string | null = null;
      let usedFlow: "SEP-31" | "SEP-24" = "SEP-24";

      if (supportsSep31) {
        usedFlow = "SEP-31";
        // SEP-0031 requires the sender to register KYC fields via SEP-0012.
        // For most anchors, those fields are collected through the anchor's
        // own form (linked from the transaction's `more_info_url`).
        const sendResult = await initiateSep31Send({
          account: publicKey,
          amount,
          assetCode: asset,
          fields: {
            transaction: { receiver_currency: fiat },
          },
        }).catch((sendErr) => {
          // If the anchor rejects (e.g. unsupported field), fall back to SEP-24.
          // eslint-disable-next-line no-console
          console.warn("SEP-31 send failed, falling back to SEP-24:", sendErr);
          return null;
        });
        id = sendResult?.id || null;
      }

      if (!id) {
        usedFlow = "SEP-24";
        const interactive = await startInteractiveWithdraw({
          account: publicKey,
          assetCode: asset,
        });
        id = interactive.id;
        const popup = window.open(
          interactive.url,
          "stellar-anchor-withdraw",
          "width=500,height=700"
        );
        popupRef.current = popup;
        setInteractiveUrl(interactive.url);
        setPhase("interactive");
      } else {
        setPhase("polling");
      }

      const startedAt = new Date().toISOString();
      upsertHistory({
        id,
        flow: usedFlow,
        asset,
        fiatCurrency: fiat,
        amount,
        status: "started",
        startedAt,
      });

      const finalRecord = await pollAnchorTransaction({
        account: publicKey,
        id,
        onUpdate: (record) => {
          setTransaction(record);
          if (phase === "interactive") setPhase("polling");
          upsertHistory({
            id,
            flow: usedFlow,
            asset,
            fiatCurrency: fiat,
            amount: record.amount_in || amount,
            status: record.status,
            startedAt,
            completedAt: record.completed_at,
            stellarTxId: record.stellar_transaction_id,
            externalTxId: record.external_transaction_id,
          });
        },
        isCancelled: () => cancelRef.current,
      });

      if (cancelRef.current) return;
      if (finalRecord?.status === "completed") {
        setTransaction(finalRecord);
        setPhase("completed");
        toast.success(`Withdrawal complete — ${finalRecord.amount_out || amount} ${fiat} sent to your bank.`);
      } else if (finalRecord) {
        setTransaction(finalRecord);
        setPhase("error");
        setErrorMessage(`Withdrawal ended with status "${finalRecord.status}".`);
      } else {
        setPhase("error");
        setErrorMessage("Withdrawal timed out. Check the anchor's tracking page.");
      }
    } catch (err: unknown) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : "Withdrawal failed.");
    }
  };

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

        <h2 className="font-display text-xl font-bold text-amber-100 mb-1">Withdraw to Bank</h2>
        <p className="text-xs text-amber-700 mb-5">
          Powered by <span className="font-mono">{ANCHOR_HOME_DOMAIN}</span>{" "}
          {supportsSep31 ? "via SEP-0031" : "via SEP-0024"}.
        </p>

        {phase === "form" && (
          <div className="space-y-4">
            <label className="block">
              <span className="label mb-1 block">Asset to send</span>
              <select value={asset} onChange={(e) => setAsset(e.target.value)} className="input-field">
                {(availableAssets.length ? availableAssets : ["USDC", "XLM"]).map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label mb-1 block">Amount</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.0000001"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input-field"
                placeholder="100"
              />
            </label>

            <label className="block">
              <span className="label mb-1 block">Receive currency</span>
              <select
                value={fiat}
                onChange={(e) => setFiat(e.target.value as FiatCurrency)}
                className="input-field"
              >
                {FIAT_CURRENCIES.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </label>

            {errorMessage && <p className="text-red-400 text-sm">{errorMessage}</p>}

            <p className="text-xs text-amber-700">
              You'll provide your bank details on the anchor's secure form. The anchor
              receives the {asset} payment from this wallet and pays out {fiat} to your
              registered account.
            </p>
            <button onClick={startWithdraw} className="btn-primary w-full">
              Continue
            </button>
          </div>
        )}

        {phase === "loading" && <p className="text-amber-200 text-sm">Authenticating with the anchor…</p>}

        {(phase === "interactive" || phase === "polling") && (
          <div className="space-y-3">
            <p className="text-amber-200 text-sm">
              {phase === "interactive"
                ? "Complete the withdrawal form in the popup."
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
                  <div className="flex justify-between"><dt>Amount sent</dt><dd>{transaction.amount_in} {asset}</dd></div>
                )}
                {transaction.amount_out && (
                  <div className="flex justify-between"><dt>Estimated payout</dt><dd>{transaction.amount_out} {fiat}</dd></div>
                )}
              </dl>
            )}
          </div>
        )}

        {phase === "completed" && transaction && (
          <div className="space-y-3">
            <p className="text-emerald-400 text-sm font-medium">Withdrawal complete.</p>
            <dl className="text-xs text-amber-200 space-y-1">
              <div className="flex justify-between"><dt>Sent to bank</dt><dd>{transaction.amount_out} {fiat}</dd></div>
              {transaction.external_transaction_id && (
                <div className="flex justify-between">
                  <dt>Bank reference</dt>
                  <dd className="font-mono">{transaction.external_transaction_id.slice(0, 14)}…</dd>
                </div>
              )}
            </dl>
            <button onClick={onClose} className="btn-primary w-full">Done</button>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            <p className="text-red-400 text-sm">{errorMessage || "Something went wrong."}</p>
            <button onClick={() => setPhase("form")} className="btn-secondary w-full">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
