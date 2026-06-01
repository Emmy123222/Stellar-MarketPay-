import type { AppProps } from "next/app";
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Navbar from "@/components/Navbar";
import FaucetButton from "@/components/FaucetButton";
import AppFooter from "@/components/AppFooter";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import {
  connectWallet,
  getConnectedPublicKey,
  signTransactionWithWallet,
} from "@/lib/wallet";
import {
  fetchAuthChallenge,
  verifyAuthChallenge,
  setJwtToken,
  registerReferral,
} from "@/lib/api";
import "@/styles/globals.css";
import { ToastProvider } from "@/components/Toast";
import { PriceProvider } from "@/contexts/PriceContext";
import OfflineBanner from "@/components/OfflineBanner";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useBackgroundSync } from "@/hooks/useBackgroundSync";
import "../lib/i18n";

const REF_STORAGE_KEY = "marketpay_pending_referrer";

function App({ Component, pageProps }: AppProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  } | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const router = useRouter();

  // Background sync: refresh the current page when the SW replays queued requests
  useBackgroundSync({
    onSyncComplete: () => router.replace(router.asPath),
  });

  // Capture ?ref= query param and persist it until the user connects a wallet
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && /^G[A-Z0-9]{55}$/.test(ref)) {
      localStorage.setItem(REF_STORAGE_KEY, ref);
    }
  }, []);

  const handleOpenShortcutsModal = useCallback(() => {
    setShortcutsModalOpen(true);
  }, []);

  const handleCloseShortcutsModal = useCallback(() => {
    setShortcutsModalOpen(false);
  }, []);

  const handleToggleShortcutsModal = useCallback(() => {
    setShortcutsModalOpen((current) => !current);
  }, []);

  useKeyboardShortcuts({
    onGoToJobs: () => router.push("/jobs"),
    onGoToDashboard: () => router.push("/dashboard"),
    onPostJob: () => router.push("/post-job"),
    onToggleShortcutsModal: handleToggleShortcutsModal,
    onFocusSearch: () =>
      window.dispatchEvent(new CustomEvent("shortcut-focus-search")),
    onToggleBookmark: () =>
      window.dispatchEvent(new CustomEvent("shortcut-toggle-bookmark")),
    shortcutsModalOpen,
  });

  /**
   * After a successful auth, check if there's a pending referrer in localStorage.
   * If so, register the referral relationship and clear the stored key.
   */
  const maybeRegisterReferral = useCallback(async (newPublicKey: string) => {
    if (typeof window === "undefined") return;
    const referrerAddress = localStorage.getItem(REF_STORAGE_KEY);
    if (!referrerAddress || referrerAddress === newPublicKey) return;
    try {
      await registerReferral(referrerAddress, newPublicKey);
      localStorage.removeItem(REF_STORAGE_KEY);
    } catch {
      // Non-fatal — referral registration failure should not block login
    }
  }, []);

  const handleAuthAndConnect = async (pk: string) => {
    try {
      const challengeTx = await fetchAuthChallenge(pk);
      const { signedXDR, error } = await signTransactionWithWallet(challengeTx);
      if (error || !signedXDR) {
        console.error("Authentication failed:", error);
        return false;
      }
      const token = await verifyAuthChallenge(signedXDR);
      setJwtToken(token);
      return true;
    } catch (e) {
      console.error("Auth error:", e);
      return false;
    }
  };

  useEffect(() => {
    getConnectedPublicKey().then(async (pk) => {
      if (pk) {
        const authenticated = await handleAuthAndConnect(pk);
        if (authenticated) {
          setPublicKey(pk);
          await maybeRegisterReferral(pk);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.log("Service worker registration failed:", error);
      });
    }
  }, []);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(
        event as unknown as {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string }>;
        }
      );
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, []);

  const handleInstallApp = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice?.outcome !== "accepted") setInstallDismissed(true);
    setDeferredInstallPrompt(null);
  };

  const handleConnect = async () => {
    const { publicKey: pk, error } = await connectWallet();
    if (pk) {
      const authenticated = await handleAuthAndConnect(pk);
      if (authenticated) {
        setPublicKey(pk);
        await maybeRegisterReferral(pk);
      } else {
        alert("Wallet connected, but authentication failed.");
      }
    } else if (error) {
      alert(error);
    }
  };

  return (
    <>
      <PriceProvider>
        <ToastProvider>
          <Head>
            <title>
              Stellar MarketPay — Decentralised Freelance Marketplace
            </title>
            <meta
              name="description"
              content="Post jobs, hire freelancers, and pay with XLM — secured by Soroban smart contracts."
            />
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            />
            <link rel="manifest" href="/manifest.json" />
            <link rel="apple-touch-icon" href="/icon-192x192.png" />
            <link
              rel="alternate"
              type="application/rss+xml"
              title="Stellar MarketPay — Job Listings (RSS)"
              href="/api/jobs/feed.rss"
            />
            <link
              rel="alternate"
              type="application/atom+xml"
              title="Stellar MarketPay — Job Listings (Atom)"
              href="/api/jobs/feed.atom"
            />
          </Head>
          <OfflineBanner />
          <div className="min-h-screen bg-ink-900 bg-lines flex flex-col">
            <Navbar
              publicKey={publicKey}
              onConnect={handleConnect}
              onDisconnect={() => setPublicKey(null)}
            />
            <main id="main-content" className="flex-1">
              <Component
                {...pageProps}
                publicKey={publicKey}
                onConnect={handleConnect}
              />
            </main>
            <AppFooter onOpenShortcuts={handleOpenShortcutsModal} />
            {publicKey && <FaucetButton publicKey={publicKey} />}
            {deferredInstallPrompt && !installDismissed && (
              <button
                onClick={handleInstallApp}
                className="fixed right-4 bottom-4 z-50 btn-primary text-sm"
                type="button"
              >
                Install App
              </button>
            )}
            <KeyboardShortcutsModal
              isOpen={shortcutsModalOpen}
              onClose={handleCloseShortcutsModal}
            />
          </div>
        </ToastProvider>
      </PriceProvider>
    </>
  );
}

export default App;
