import type { AppProps } from "next/app";
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import Script from "next/script";
import { useRouter } from "next/router";
import toast, { Toaster } from "react-hot-toast";
import Navbar from "@/components/Navbar";
import MobileTabBar from "@/components/MobileTabBar";
import FaucetButton from "@/components/FaucetButton";
import AppFooter from "@/components/AppFooter";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import CommandPalette from "@/components/CommandPalette";
import OnboardingWizard from "@/components/Onboarding/OnboardingWizard";
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
import PWAInstall from "@/components/PWAInstall";
import "@/styles/globals.css";
import { ToastProvider } from "@/components/Toast";
import { PriceProvider } from "@/contexts/PriceContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";

import OfflineBanner from "@/components/OfflineBanner";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useBackgroundSync } from "@/hooks/useBackgroundSync";
import { appWithTranslation } from "next-i18next";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nextI18NextConfig = require("../next-i18next.config.js");

const WALLET_PUBLIC_KEY_STORAGE_KEY = "smp_wallet_public_key";
const REF_STORAGE_KEY = "smp_referrer";

function loadStoredPublicKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WALLET_PUBLIC_KEY_STORAGE_KEY);
}


function ThemeToggle() {
  const { theme, setTheme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  
  useEffect(() => setMounted(true), []);
  
  // Listen for keyboard shortcut
  useEffect(() => {
    const handleThemeToggle = () => {
      toggleTheme();
      setShowMenu(false);
    };
    
    window.addEventListener("shortcut-toggle-theme", handleThemeToggle);
    return () => window.removeEventListener("shortcut-toggle-theme", handleThemeToggle);
  }, [toggleTheme]);
  
  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[role="menu"]') && !target.closest('[aria-haspopup="menu"]')) {
        setShowMenu(false);
      }
    };
    
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [showMenu]);
  
  if (!mounted) return null;
  
  const getThemeIcon = () => {
    if (theme === "high-contrast") {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 3v18M3 12h18M6 6l12 12M6 18L18 6" />
        </svg>
      );
    }
    if (theme === "dark") {
      return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
      </svg>
    );
  };

  const getThemeLabel = () => {
    if (theme === "high-contrast") return "High Contrast";
    if (theme === "dark") return "Dark Mode";
    return "Light Mode";
  };

  return (
    <div className="fixed bottom-6 left-6 z-50">
      <button
        onClick={() => setShowMenu(!showMenu)}
        aria-label={`Current theme: ${getThemeLabel()}. Click to change theme.`}
        aria-expanded={showMenu}
        aria-haspopup="menu"
        title={`Theme: ${getThemeLabel()}`}
        className="w-11 h-11 rounded-full flex items-center justify-center shadow-lg border-2 transition-all duration-200 bg-white dark:bg-ink-800 border-gray-300 dark:border-market-500/30 text-gray-700 dark:text-amber-400 hover:border-gray-500 dark:hover:border-market-500/60 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-market-500 focus:ring-offset-2"
      >
        {getThemeIcon()}
      </button>

      {showMenu && (
        <div
          role="menu"
          className="absolute bottom-14 left-0 bg-white dark:bg-ink-800 border-2 border-gray-300 dark:border-market-500/30 rounded-xl shadow-xl overflow-hidden animate-scale-in min-w-[180px]"
        >
          <button
            role="menuitem"
            onClick={() => {
              setTheme("light");
              setShowMenu(false);
            }}
            className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-ink-700 ${
              theme === "light" ? "bg-gray-100 dark:bg-ink-700 text-market-600 dark:text-market-400" : "text-gray-700 dark:text-amber-200"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
            Light Mode
            {theme === "light" && <span className="ml-auto text-xs">✓</span>}
          </button>

          <button
            role="menuitem"
            onClick={() => {
              setTheme("dark");
              setShowMenu(false);
            }}
            className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-ink-700 ${
              theme === "dark" ? "bg-gray-100 dark:bg-ink-700 text-market-600 dark:text-market-400" : "text-gray-700 dark:text-amber-200"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
              <circle cx="12" cy="12" r="4" />
              <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            Dark Mode
            {theme === "dark" && <span className="ml-auto text-xs">✓</span>}
          </button>

          <button
            role="menuitem"
            onClick={() => {
              setTheme("high-contrast");
              setShowMenu(false);
            }}
            className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-ink-700 ${
              theme === "high-contrast" ? "bg-gray-100 dark:bg-ink-700 text-market-600 dark:text-market-400" : "text-gray-700 dark:text-amber-200"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M12 3v18M3 12h18" />
            </svg>
            High Contrast
            {theme === "high-contrast" && <span className="ml-auto text-xs">✓</span>}
          </button>

          <div className="px-4 py-2 text-xs text-gray-500 dark:text-amber-900 border-t border-gray-200 dark:border-market-500/20">
            <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-ink-700 rounded text-xs">Shift</kbd> + <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-ink-700 rounded text-xs">T</kbd> to cycle
          </div>
        </div>
      )}
    </div>
  );
}

function App({ Component, pageProps }: AppProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
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

  const handleToggleTheme = useCallback(() => {
    // This will be called from keyboard shortcut - we need to access ThemeContext
    window.dispatchEvent(new CustomEvent("shortcut-toggle-theme"));
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
    onOpenCommandPalette: () => setCommandPaletteOpen(true),
    onToggleTheme: handleToggleTheme,
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
        toast.error("Wallet connected, but authentication failed.", { duration: Infinity });
      }
    } else if (error) {
      toast.error(error, { duration: Infinity });
    }
  };

  const handleWalletDisconnect = useCallback(() => {
    persistPublicKey(null);
  }, [persistPublicKey]);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-market-500 focus:px-4 focus:py-2 focus:font-semibold focus:text-ink-900 focus:shadow-lg"
      >
        Skip to main content
      </a>
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
              <MobileTabBar publicKey={publicKey} />
              <main id="main-content">
                <Component {...pageProps} publicKey={publicKey} onConnect={handleConnect} />
              </main>
              {publicKey && <FaucetButton publicKey={publicKey} />}
              <ThemeToggle />
              <OnboardingWizard publicKey={publicKey} onConnect={handleConnect} />
              <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
              <KeyboardShortcutsModal
                isOpen={shortcutsModalOpen}
                onClose={() => setShortcutsModalOpen(false)}
                showJobDetailShortcuts={isJobDetailPage}
              />
              <Toaster 
                toastOptions={{
                  duration: 4000,
                  error: {
                    duration: Infinity,
                  },
                }}
              />
            </div>
          </PriceProvider>
        </ToastProvider>
      </ThemeProvider>
    </>
  );
}

export default appWithTranslation(App, nextI18NextConfig);
