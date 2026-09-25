import type { AppProps } from "next/app";
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Navbar from "@/components/Navbar";
import { connectWallet, getConnectedPublicKey, signTransactionWithWallet } from "@/lib/wallet";
import { fetchAuthChallenge, verifyAuthChallenge, setJwtToken } from "@/lib/api";
import "@/styles/globals.css";
import { ToastProvider, useToast } from "@/components/Toast";
import { PriceProvider } from "@/contexts/PriceContext";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import CommandPalette from "@/components/CommandPalette";
import OfflineBanner from "@/components/OfflineBanner";
import RateLimitWatcher from "@/components/RateLimitWatcher";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import "../lib/i18n";

function AppContent({ Component, pageProps }: AppProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const isJobDetailPage = router.pathname === "/jobs/[id]";

  const handleToggleShortcutsModal = useCallback(() => {
    setShortcutsModalOpen((current) => !current);
  }, []);

  useKeyboardShortcuts({
    onGoToJobs: () => router.push("/jobs"),
    onGoToDashboard: () => router.push("/dashboard"),
    onPostJob: () => router.push("/post-job"),
    onToggleShortcutsModal: handleToggleShortcutsModal,
    onFocusSearch: () => window.dispatchEvent(new CustomEvent("shortcut-focus-search")),
    onToggleBookmark: () => window.dispatchEvent(new CustomEvent("shortcut-toggle-bookmark")),
    onToggleTheme: () => window.dispatchEvent(new CustomEvent("shortcut-toggle-theme")),
    onOpenCommandPalette: () => setCommandPaletteOpen(true),
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
          <CommandPalette
            isOpen={commandPaletteOpen}
            onClose={() => setCommandPaletteOpen(false)}
          />
        </div>
        <RateLimitWatcher />
      </PriceProvider>
    </>
  );
}

function App(props: AppProps) {
  return (
    <ToastProvider>
      <AppContent {...props} />
    </ToastProvider>
  );
}

export default App;
