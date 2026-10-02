/**
 * components/WalletAccountMonitor.tsx
 * Monitors Freighter wallet account changes and disconnections.
 * Listens for accountChanged event, polls isConnected(), and polls getConnectedPublicKey.
 * 
 * Issue #871: Also monitors XLM balance and shows alerts when balance is low.
 * - Polls Horizon accounts/:address every 60 seconds
 * - Shows a banner if balance < 5 XLM (minimum reserve)
 * - Shows a warning toast if balance < 10 XLM
 * - Banner links to the FaucetButton (on testnet) or a buy XLM flow (on mainnet)
 * - User can dismiss the banner for the session
 */
import { useEffect, useCallback, useState } from "react";
import { subscribeToAccountChanges, isFreighterInstalled } from "@/lib/wallet";
import { setJwtToken } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { useRouter } from "next/router";

const WALLET_PUBLIC_KEY_STORAGE_KEY = "smp_wallet_public_key";
const BALANCE_CHECK_INTERVAL = 60_000; // 60 seconds
const MIN_RESERVE_XLM = 5;
const WARNING_THRESHOLD_XLM = 10;

interface Props {
  currentPublicKey: string | null;
  onDisconnect: () => void;
}

export default function WalletAccountMonitor({
  currentPublicKey,
  onDisconnect,
}: Props) {
  const { info, warning } = useToast();
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [lastWarningTime, setLastWarningTime] = useState(0);

  const handleDisconnect = useCallback(() => {
    setJwtToken(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem(WALLET_PUBLIC_KEY_STORAGE_KEY);
    }
    onDisconnect();
    info("Your wallet was disconnected");
    router.push("/");
  }, [onDisconnect, info, router]);

  // Check balance via Horizon
  const checkBalance = useCallback(async () => {
    if (!currentPublicKey) return;
    
    try {
      const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
      const response = await fetch(`${horizonUrl}/accounts/${currentPublicKey}`);
      
      if (!response.ok) {
        console.warn("Failed to fetch account balance:", response.statusText);
        return;
      }
      
      const accountData = await response.json();
      const nativeBalance = accountData.balances.find(
        (b: any) => b.asset_type === "native"
      );
      
      if (nativeBalance) {
        const xlmBalance = parseFloat(nativeBalance.balance);
        setBalance(xlmBalance);
        
        // Show warning toast if balance < 10 XLM (but not more than once every 5 minutes)
        const now = Date.now();
        if (xlmBalance < WARNING_THRESHOLD_XLM && xlmBalance >= MIN_RESERVE_XLM) {
          if (now - lastWarningTime > 300_000) { // 5 minutes
            warning(`Low balance: ${xlmBalance.toFixed(2)} XLM. Consider adding more funds.`);
            setLastWarningTime(now);
          }
        }
      }
    } catch (err) {
      console.error("Error checking balance:", err);
    }
  }, [currentPublicKey, warning, lastWarningTime]);

  useEffect(() => {
    if (!currentPublicKey) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const handleAccountChanged = (newKey: string | null) => {
      if (cancelled) return;
      if (!newKey) {
        handleDisconnect();
      } else if (newKey !== currentPublicKey) {
        setJwtToken(null);
        if (typeof window !== "undefined") {
          localStorage.removeItem(WALLET_PUBLIC_KEY_STORAGE_KEY);
        }
        onDisconnect();
        info("Wallet account changed. Please reconnect.");
      }
    };

    const cleanup = subscribeToAccountChanges(handleAccountChanged);
    if (cleanup) {
      unsubscribe = cleanup;
    } else {
      const interval = setInterval(async () => {
        const { getConnectedPublicKey: getPk } = await import("@/lib/wallet");
        const pk = await getPk();
        handleAccountChanged(pk);
      }, 3000);
      unsubscribe = () => clearInterval(interval);
    }

    // Poll isConnected() every 30 seconds as additional safeguard
    const connectionCheck = setInterval(async () => {
      if (cancelled) return;
      try {
        const connected = await isFreighterInstalled();
        if (!connected) {
          handleDisconnect();
        }
      } catch {
        handleDisconnect();
      }
    }, 30000);

    // Poll balance every 60 seconds (Issue #871)
    checkBalance(); // Initial check
    const balanceCheck = setInterval(() => {
      if (!cancelled) {
        checkBalance();
      }
    }, BALANCE_CHECK_INTERVAL);

    return () => {
      cancelled = true;
      unsubscribe?.();
      clearInterval(connectionCheck);
      clearInterval(balanceCheck);
    };
  }, [currentPublicKey, onDisconnect, info, router, handleDisconnect, checkBalance]);

  // Determine if we should show the low balance banner
  const showBanner = balance !== null && balance < MIN_RESERVE_XLM && !bannerDismissed;
  const isTestnet = (process.env.NEXT_PUBLIC_HORIZON_URL || "").includes("testnet");

  return (
    <>
      {showBanner && (
        <div
          className="fixed top-0 left-0 right-0 z-50 bg-red-500/10 border-b border-red-500/30 backdrop-blur-sm"
          role="alert"
          aria-live="polite"
        >
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1">
                <svg
                  className="w-6 h-6 text-red-400 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-300">
                    Critical: Low XLM Balance
                  </p>
                  <p className="text-xs text-red-400/80 mt-0.5">
                    Your balance ({balance?.toFixed(2)} XLM) is below the minimum reserve of {MIN_RESERVE_XLM} XLM. 
                    {isTestnet ? " Fund your account to continue using the platform." : " Add funds to avoid transaction failures."}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {isTestnet ? (
                  <a
                    href={`https://laboratory.stellar.org/#account-creator?network=test`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-colors whitespace-nowrap"
                  >
                    Get Testnet XLM
                  </a>
                ) : (
                  <a
                    href="https://www.stellar.org/lumens/buy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-colors whitespace-nowrap"
                  >
                    Buy XLM
                  </a>
                )}
                
                <button
                  onClick={() => setBannerDismissed(true)}
                  className="p-1 text-red-400/70 hover:text-red-300 transition-colors"
                  aria-label="Dismiss warning"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
