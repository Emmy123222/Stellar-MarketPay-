import type { AppProps } from "next/app";
import { useState, useEffect } from "react";
import Head from "next/head";
import Navbar from "@/components/Navbar";
import { connectWallet, getConnectedPublicKey } from "@/lib/wallet";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    getConnectedPublicKey().then((pk) => { if (pk) setPublicKey(pk); });
  }, []);

  const handleConnect = async () => {
    const { publicKey: pk } = await connectWallet();
    if (pk) setPublicKey(pk);
  };

  return (
    <>
      <Head>
        <title>Stellar MarketPay — Decentralised Freelance Marketplace</title>
        <meta name="description" content="Post jobs, hire freelancers, and pay with XLM — secured by Soroban smart contracts." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-ink-900 bg-lines">
        <Navbar publicKey={publicKey} onConnect={handleConnect} onDisconnect={() => setPublicKey(null)} />
        <main>
          <Component {...pageProps} publicKey={publicKey} onConnect={handleConnect} />
        </main>
      </div>
    </>
  );
}
