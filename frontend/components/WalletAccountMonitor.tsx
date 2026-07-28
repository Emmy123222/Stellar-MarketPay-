/**
 * components/WalletAccountMonitor.tsx
 * Monitors Freighter wallet account changes/disconnections, and (#871) polls
 * the connected account's XLM balance so we can warn the user before they
 * run out of the minimum reserve.
 *
 * Balance monitoring:
 *   - Polls Horizon `accounts/:address` every 60 s while a wallet is connected.
 *   - Balance < 10 XLM  → one-time warning toast (per low-balance episode).
 *   - Balance < 5 XLM   → persistent banner (Stellar's minimum account
 *     reserve is currently 1 XLM + 0.5 XLM/subentry — 5 XLM is a safety
 *     margin above that). Dismissible for the rest of the session.
 *   - Banner links to the FaucetButton on testnet (already rendered
 *     globally once `onBalanceChange` reports a real balance) or opens the
 *     Buy XLM flow on mainnet.
 */
import { useEffect, useRef, useState } from "react";
import { subscribeToAccountChanges } from "@/lib/wallet";
import { setJwtToken } from "@/lib/api";
import { getXLMBalance } from "@/lib/stellar";
import { useToast } from "@/components/Toast";
import BuyXLMModal from "@/components/BuyXLMModal";

const WALLET_PUBLIC_KEY_STORAGE_KEY = "smp_wallet_public_key";
const BALANCE_POLL_INTERVAL_MS = 60_000;
const MINIMUM_RESERVE_XLM = 5;
const LOW_BALANCE_WARNING_XLM = 10;
const IS_TESTNET = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") !== "mainnet";

interface Props {
  currentPublicKey: string | null;
  onDisconnect: () => void;
  /** Called on every successful balance poll — lets the parent keep other
   * balance-dependent UI (e.g. FaucetButton) in sync without double-polling. */
  onBalanceChange?: (xlmBalance: string) => void;
}

export default function WalletAccountMonitor({
  currentPublicKey,
  onDisconnect,
  onBalanceChange,
}: Props) {
  const { info } = useToast();
  const [xlmBalance, setXlmBalance] = useState<number | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const hasWarnedRef = useRef(false);

  // ── Account change / disconnection monitoring (#499) ────────────────────
  useEffect(() => {
    if (!currentPublicKey) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const handleAccountChanged = (newKey: string | null) => {
      if (cancelled) return;
      if (!newKey || newKey !== currentPublicKey) {
        // Clear JWT and persisted state
        setJwtToken(null);
        if (typeof window !== "undefined") {
          localStorage.removeItem(WALLET_PUBLIC_KEY_STORAGE_KEY);
        }
        onDisconnect();
        info("Wallet account changed. Please reconnect.");
      }
    };

    // Use subscribeToAccountChanges if available, otherwise poll
    const cleanup = subscribeToAccountChanges(handleAccountChanged);
    if (cleanup) {
      unsubscribe = cleanup;
    } else {
      // Fallback: poll every 3 seconds
      const interval = setInterval(async () => {
        const { getConnectedPublicKey: getPk } = await import("@/lib/wallet");
        const pk = await getPk();
        handleAccountChanged(pk);
      }, 3000);
      unsubscribe = () => clearInterval(interval);
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [currentPublicKey, onDisconnect, info]);

  // ── Low-balance monitoring (#871) ────────────────────────────────────────
  useEffect(() => {
    // Reset per-account state whenever the connected wallet changes.
    setXlmBalance(null);
    setBannerDismissed(false);
    hasWarnedRef.current = false;

    if (!currentPublicKey) return;

    let cancelled = false;

    const pollBalance = async () => {
      const balanceStr = await getXLMBalance(currentPublicKey);
      if (cancelled) return;
      const balance = parseFloat(balanceStr);
      if (Number.isNaN(balance)) return;

      setXlmBalance(balance);
      onBalanceChange?.(balanceStr);

      if (balance < LOW_BALANCE_WARNING_XLM) {
        if (!hasWarnedRef.current) {
          hasWarnedRef.current = true;
          info(
            `Low balance warning: ${balance.toFixed(2)} XLM remaining. Keep at least ${MINIMUM_RESERVE_XLM} XLM for the network reserve.`,
          );
        }
      } else {
        // Balance recovered above the warning threshold — allow the toast
        // to fire again if it drops a second time this session.
        hasWarnedRef.current = false;
      }
    };

    pollBalance();
    const interval = setInterval(pollBalance, BALANCE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentPublicKey, info, onBalanceChange]);

  const showBanner =
    currentPublicKey !== null &&
    xlmBalance !== null &&
    xlmBalance < MINIMUM_RESERVE_XLM &&
    !bannerDismissed;

  return (
    <>
      {showBanner && (
        <div
          role="alert"
          className="fixed top-0 inset-x-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-red-500/15 border-b border-red-500/30 px-4 py-2.5 text-sm text-red-200 backdrop-blur-sm"
        >
          <span>
            ⚠ Your balance is <span className="font-mono font-semibold">{xlmBalance!.toFixed(2)} XLM</span> — below the {MINIMUM_RESERVE_XLM} XLM minimum reserve.
          </span>
          {IS_TESTNET ? (
            <span className="text-red-300/90 text-xs">
              A testnet funding widget is available in the bottom-right corner.
            </span>
          ) : (
            <button
              onClick={() => setShowBuyModal(true)}
              className="text-xs font-medium px-2.5 py-1 rounded-lg bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 transition-colors"
            >
              Buy XLM
            </button>
          )}
          <button
            onClick={() => setBannerDismissed(true)}
            className="text-xs text-red-300/80 hover:text-red-100 transition-colors"
            aria-label="Dismiss low balance banner"
          >
            Dismiss
          </button>
        </div>
      )}

      {showBuyModal && currentPublicKey && (
        <BuyXLMModal
          publicKey={currentPublicKey}
          onClose={() => setShowBuyModal(false)}
          onComplete={() => setShowBuyModal(false)}
        />
      )}
    </>
  );
}
