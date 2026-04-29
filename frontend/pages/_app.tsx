import type { AppProps } from "next/app";
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import Navbar from "@/components/Navbar";
import FaucetButton from "@/components/FaucetButton";
import { connectWallet, getConnectedPublicKey, signTransactionWithWallet } from "@/lib/wallet";
import { fetchAuthChallenge, verifyAuthChallenge, setJwtToken } from "@/lib/api";
import "@/styles/globals.css";
import { ToastProvider } from "@/components/Toast";
import { PriceProvider } from "@/contexts/PriceContext";
import ShortcutsModal from "@/components/ShortcutsModal";
import OfflineBanner from "@/components/OfflineBanner";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import "../lib/i18n";

function App({ Component, pageProps }: AppProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const router = useRouter();

  const isJobDetailPage = router.pathname === "/jobs/[id]";

  const handleToggleShortcutsModal = useCallback(() => {
    setShortcutsModalOpen((current) => !current);
  }, []);

  useKeyboardShortcuts({
    isJobDetailPage,
    onGoToJobs: () => router.push("/jobs"),
    onGoToDashboard: () => router.push("/dashboard"),
    onNewJobPost: () => router.push("/post-job"),
    onToggleShortcutsModal: handleToggleShortcutsModal,
    onJobApply: () => window.dispatchEvent(new CustomEvent("shortcut-apply-job")),
    onJobBackToListing: () => router.push("/jobs"),
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
        alert("Wallet connected, but authentication failed.");
      }
    } else if (error) {
      alert(error);
    }
  };

  return (
    <>
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
          {publicKey && <FaucetButton publicKey={publicKey} />}
          <ShortcutsModal
            isOpen={shortcutsModalOpen}
            onClose={() => setShortcutsModalOpen(false)}
            showJobDetailShortcuts={isJobDetailPage}
          />
        </div>
        </PriceProvider>
      </ToastProvider>
    </>
  );
}

export default App;
