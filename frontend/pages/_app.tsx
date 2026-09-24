import type { AppProps } from "next/app";
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Navbar from "@/components/Navbar";
import { connectWallet, getConnectedPublicKey, signTransactionWithWallet } from "@/lib/wallet";
import { fetchAuthChallenge, verifyAuthChallenge, setJwtToken } from "@/lib/api";
import "@/styles/globals.css";
import { ToastProvider, toast } from "@/components/Toast";
import { PriceProvider } from "@/contexts/PriceContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import CommandPalette from "@/components/CommandPalette";
import OfflineBanner from "@/components/OfflineBanner";
import RateLimitWatcher from "@/components/RateLimitWatcher";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTranslation } from "../lib/i18n";

const LOCALE_STORAGE_KEY = "stellar-marketpay:locale";
const SUPPORTED_LOCALES = new Set(["en", "es", "fr", "pt"]);

function getInitialLocale(): string {
  if (typeof window === "undefined") return "en";

  const savedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  const browserLocale = window.navigator.language?.split("-")[0];
  return [savedLocale, browserLocale, "en"].find(
    (locale): locale is string => Boolean(locale && SUPPORTED_LOCALES.has(locale)),
  ) || "en";
}

function App({ Component, pageProps }: AppProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const router = useRouter();
  const { i18n } = useTranslation("common");
  const initialLocale = getInitialLocale();

  // Resolve the persisted/browser locale during render so the first client
  // render uses the same locale preference instead of briefly showing English.
  if (i18n.language !== initialLocale) {
    void i18n.changeLanguage(initialLocale);
  }

  const isJobDetailPage = router.pathname === "/jobs/[id]";

  const handleToggleShortcutsModal = useCallback(() => {
    setShortcutsModalOpen((current) => !current);
  }, []);

  const handleCloseCommandPalette = useCallback(() => setCommandPaletteOpen(false), []);

  // Every callback below has to match UseKeyboardShortcutsOptions: the hook
  // invokes each one from a key handler, so a name it does not declare is dead
  // (this call used to pass `isJobDetailPage`, `onNewJobPost`, `onJobApply` and
  // `onJobBackToListing`, none of which the hook accepts) while a required one
  // that is missing throws as soon as that key is pressed — `p`, `/`, `b` and
  // Cmd/Ctrl+K were unreachable for exactly that reason. `/` and `b` are
  // forwarded as events because the jobs page already listens for them
  // (pages/jobs/index.tsx).
  useKeyboardShortcuts({
    onGoToJobs: () => router.push("/jobs"),
    onGoToDashboard: () => router.push("/dashboard"),
    onPostJob: () => router.push("/post-job"),
    onFocusSearch: () => window.dispatchEvent(new CustomEvent("shortcut-focus-search")),
    onToggleBookmark: () => window.dispatchEvent(new CustomEvent("shortcut-toggle-bookmark")),
    onOpenCommandPalette: () => setCommandPaletteOpen(true),
    onToggleShortcutsModal: handleToggleShortcutsModal,
    shortcutsModalOpen,
  });

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
        if (authenticated) setPublicKey(pk);
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

  const handleConnect = async () => {
    const { publicKey: pk, error } = await connectWallet();
    if (pk) {
      const authenticated = await handleAuthAndConnect(pk);
      if (authenticated) {
        setPublicKey(pk);
      } else {
        toast.error("Wallet connected, but authentication failed.");
      }
    } else if (error) {
      toast.error(error);
    }
  };

  return (
    <>
      <ThemeProvider>
      <ToastProvider>
        <PriceProvider>
        <Head>
          <title>Stellar MarketPay — Decentralised Freelance Marketplace</title>
          <meta name="description" content="Post jobs, hire freelancers, and pay with XLM — secured by Soroban smart contracts." />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="manifest" href="/manifest.json" />
          <link rel="apple-touch-icon" href="/icon-192x192.png" />
          <link rel="alternate" type="application/rss+xml" title="Stellar MarketPay — Job Listings (RSS)" href="/api/jobs/feed.rss" />
          <link rel="alternate" type="application/atom+xml" title="Stellar MarketPay — Job Listings (Atom)" href="/api/jobs/feed.atom" />
        </Head>
        <OfflineBanner />
        <div className="min-h-screen bg-ink-900 bg-lines">
          <Navbar publicKey={publicKey} onConnect={handleConnect} onDisconnect={() => setPublicKey(null)} />
          <main>
            <Component {...pageProps} publicKey={publicKey} onConnect={handleConnect} />
          </main>
          <KeyboardShortcutsModal
            isOpen={shortcutsModalOpen}
            onClose={() => setShortcutsModalOpen(false)}
            showJobDetailShortcuts={isJobDetailPage}
          />
          <CommandPalette isOpen={commandPaletteOpen} onClose={handleCloseCommandPalette} />
        </div>
        <RateLimitWatcher />
        </PriceProvider>
      </ToastProvider>
      </ThemeProvider>
    </>
  );
}

export default App;
