/**
 * components/WalletAccountMonitor.tsx
 * Monitors Freighter wallet account changes and disconnections.
 * Listens for accountChanged event and prompts re-authentication on change.
 */
import { useEffect } from "react";
import { subscribeToAccountChanges } from "@/lib/wallet";
import { setJwtToken } from "@/lib/api";
import { useToast } from "@/components/Toast";

const WALLET_PUBLIC_KEY_STORAGE_KEY = "smp_wallet_public_key";

interface Props {
  currentPublicKey: string | null;
  onDisconnect: () => void;
}

export default function WalletAccountMonitor({
  currentPublicKey,
  onDisconnect,
}: Props) {
  const { info } = useToast();

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

  return null;
}
