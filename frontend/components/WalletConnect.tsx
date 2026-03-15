/**
 * components/WalletConnect.tsx
 */
import { useState } from "react";
import { connectWallet, isFreighterInstalled } from "@/lib/wallet";

interface WalletConnectProps { onConnect: (pk: string) => void; }

export default function WalletConnect({ onConnect }: WalletConnectProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    const installed = await isFreighterInstalled();
    if (!installed) {
      window.open("https://freighter.app", "_blank");
      setLoading(false);
      return;
    }
    const { publicKey, error: e } = await connectWallet();
    setLoading(false);
    if (e) { setError(e); return; }
    if (publicKey) onConnect(publicKey);
  };

  return (
    <div className="card max-w-sm mx-auto text-center animate-slide-up">
      <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-market-500/10 border border-market-500/20 flex items-center justify-center">
        <svg className="w-7 h-7 text-market-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
        </svg>
      </div>
      <h3 className="font-display text-lg font-bold text-amber-100 mb-2">Connect Wallet</h3>
      <p className="text-amber-800 text-sm mb-5">
        Connect your <a href="https://freighter.app" target="_blank" rel="noopener noreferrer" className="text-market-400 hover:underline">Freighter</a> wallet to post jobs, apply for work, and manage payments.
      </p>
      {error && <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}
      <button onClick={handleConnect} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
        {loading ? <><Spinner />Connecting...</> : "Connect Freighter Wallet"}
      </button>
      <p className="mt-3 text-xs text-amber-900">
        No wallet? <a href="https://freighter.app" target="_blank" rel="noopener noreferrer" className="text-market-400 hover:underline">Install Freighter →</a>
      </p>
    </div>
  );
}

function Spinner() {
  return <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;
}
