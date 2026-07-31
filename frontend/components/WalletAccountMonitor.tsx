/**
 * components/WalletAccountMonitor.tsx
 * Monitors Freighter wallet account changes and disconnections.
 * Listens for accountChanged event, polls isConnected(), and polls getConnectedPublicKey.
 */
import { useEffect } from "react";
import { subscribeToAccountChanges, isFreighterInstalled } from "@/lib/wallet";
import { setJwtToken } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { useRouter } from "next/router";

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
  const router = useRouter();

  function handleDisconnect() {
    setJwtToken(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem(WALLET_PUBLIC_KEY_STORAGE_KEY);
    }
    onDisconnect();
    info("Your wallet was disconnected");
    router.push("/");
  }

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

    return () => {
      cancelled = true;
      unsubscribe?.();
      clearInterval(connectionCheck);
    };
  }, [currentPublicKey, onDisconnect, info, router]);

  return null;
}
