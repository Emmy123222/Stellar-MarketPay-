import type { AppProps } from "next/app";
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import Script from "next/script";
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
  logout,
  registerReferral,
} from "@/lib/api";
import { useToast } from "@/components/Toast";
import WalletAccountMonitor from "@/components/WalletAccountMonitor";
import "@/styles/globals.css";
import { ToastProvider } from "@/components/Toast";
import { PriceProvider } from "@/contexts/PriceContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";

import OfflineBanner from "@/components/OfflineBanner";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useBackgroundSync } from "@/hooks/useBackgroundSync";
import "../lib/i18n";

const WALLET_PUBLIC_KEY_STORAGE_KEY = "smp_wallet_public_key";
const REF_STORAGE_KEY = "smp_referrer";

function loadStoredPublicKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WALLET_PUBLIC_KEY_STORAGE_KEY);
}


function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="fixed bottom-6 left-6 z-50 w-11 h-11 rounded-full flex items-center justify-center shadow-lg border transition-colors duration-200 bg-white dark:bg-ink-800 border-gray-200 dark:border-market-500/20 text-gray-600 dark:text-amber-400 hover:border-gray-400 dark:hover:border-market-500/50"
    >
      {theme === "dark" ? (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}

function App({ Component, pageProps }: AppProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  } | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const router = useRouter();
  const isJobDetailPage = router.pathname === "/jobs/[id]";

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
    
    // Hydration fix: load public key after mount
    const storedKey = loadStoredPublicKey();
    if (storedKey && !publicKey) {
      setPublicKey(storedKey);
    }
  }, [publicKey]);

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

  const persistPublicKey = useCallback((pk: string | null) => {
    setPublicKey(pk);
    if (typeof window === "undefined") return;
    try {
      if (pk) localStorage.setItem(WALLET_PUBLIC_KEY_STORAGE_KEY, pk);
      else localStorage.removeItem(WALLET_PUBLIC_KEY_STORAGE_KEY);
    } catch {
      // Ignore storage failures; wallet state still works in memory.
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
          persistPublicKey(pk);
          await maybeRegisterReferral(pk);
        } else {
          persistPublicKey(null);
        }
      }
    });
  }, [maybeRegisterReferral, persistPublicKey]);

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
        persistPublicKey(pk);
        await maybeRegisterReferral(pk);
      } else {
        alert("Wallet connected, but authentication failed.");
      }
    } else if (error) {
      alert(error);
    }
  };

  const handleWalletDisconnect = useCallback(() => {
    persistPublicKey(null);
  }, [persistPublicKey]);

  return (
    <>
      {/*
       * Non-critical third-party scripts — loaded after the page is interactive
       * so they don't block TTI. Add any analytics, widgets, or tracking scripts
       * here using strategy="lazyOnload". They run after hydration completes.
       *
       * Example (uncomment and replace src with your script URL):
       *   <Script src="https://example.com/analytics.js" strategy="lazyOnload" />
       *
       * For CPU-intensive scripts (analytics, chat widgets), consider Partytown:
       *   npm install @builder.io/partytown
       *   Then use strategy="worker" to offload to a web worker thread.
       */}
      <ThemeProvider>
        <ToastProvider>
          <PriceProvider>
            <WalletAccountMonitor
              currentPublicKey={publicKey}
              onDisconnect={handleWalletDisconnect}
            />
            <Head>
              <title>Stellar MarketPay — Decentralised Freelance Marketplace</title>
              <meta name="description" content="Post jobs, hire freelancers, and pay with XLM — secured by Soroban smart contracts." />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <meta name="theme-color" content="#f59e0b" />
              <meta name="apple-mobile-web-app-capable" content="yes" />
              <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
              <meta name="apple-mobile-web-app-title" content="MarketPay" />
              <link rel="manifest" href="/manifest.json" />
              <link rel="apple-touch-icon" href="/icon-192x192.png" />
              <link rel="alternate" type="application/rss+xml" title="Stellar MarketPay — Job Listings (RSS)" href="/api/jobs/feed.rss" />
              <link rel="alternate" type="application/atom+xml" title="Stellar MarketPay — Job Listings (Atom)" href="/api/jobs/feed.atom" />
            </Head>
            <OfflineBanner />
            <div className="min-h-screen bg-lines" style={{ backgroundColor: "var(--bg)" }}>
              <Navbar publicKey={publicKey} onConnect={handleConnect} onDisconnect={() => setPublicKey(null)} />
              <main>
                <Component {...pageProps} publicKey={publicKey} onConnect={handleConnect} />
              </main>
              {publicKey && <FaucetButton publicKey={publicKey} />}
              <ThemeToggle />
              <KeyboardShortcutsModal
                isOpen={shortcutsModalOpen}
                onClose={() => setShortcutsModalOpen(false)}
                showJobDetailShortcuts={isJobDetailPage}
              />
            </div>
          </PriceProvider>
        </ToastProvider>
      </ThemeProvider>
    </>
  );
}

export default App;
