/**
 * components/FaucetButton.tsx
 * Stellar testnet faucet button component
 */
import { useState, useEffect } from "react";
import { fundTestnetWallet, checkAccountNeedsFunding, getFaucetStatus } from "@/lib/api";

interface Props {
  publicKey: string;
  currentBalance?: string;
  onBalanceUpdate?: (newBalance: string) => void;
}

export default function FaucetButton({ publicKey, currentBalance, onBalanceUpdate }: Props) {
  const [needsFunding, setNeedsFunding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [faucetEnabled, setFaucetEnabled] = useState(false);

  useEffect(() => {
    checkFaucetStatus();
    if (currentBalance !== undefined) {
      setNeedsFunding(parseFloat(currentBalance) === 0);
    }
  }, [currentBalance]);

  const checkFaucetStatus = async () => {
    try {
      const status = await getFaucetStatus();
      setFaucetEnabled(status.enabled);
    } catch (err) {
      console.error("Failed to check faucet status:", err);
      setFaucetEnabled(false);
    }
  };

  const handleFundWallet = async () => {
    if (!publicKey) return;

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const result = await fundTestnetWallet(publicKey);
      
      if (result.success) {
        setSuccessMsg(`Successfully funded with ${result.fundedAmount} XLM!`);
        setNeedsFunding(false);
        
        // Update parent component with new balance
        if (onBalanceUpdate && result.newBalance) {
          onBalanceUpdate(result.newBalance);
        }

        // Clear success message after 5 seconds
        setTimeout(() => setSuccessMsg(""), 5000);
      } else {
        setErrorMsg(result.message);
      }
    } catch (err: any) {
      console.error("Faucet funding error:", err);
      setErrorMsg(err.response?.data?.error || "Failed to fund wallet");
    } finally {
      setLoading(false);
    }
  };

  if (!faucetEnabled || !needsFunding) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <div className="card bg-gradient-to-br from-blue-500/10 to-blue-600/10 border-blue-500/30 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
            <span className="text-blue-400 text-sm">💧</span>
          </div>
          <div>
            <h3 className="font-semibold text-blue-100 text-sm">Fund Testnet Wallet</h3>
            <p className="text-xs text-blue-300">Get 10,000 XLM for testing</p>
          </div>
        </div>

        {successMsg && (
          <div className="mb-3 p-2 bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs">
            ✅ {successMsg}
          </div>
        )}

        {errorMsg && (
          <div className="mb-3 p-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-xs">
            ❌ {errorMsg}
          </div>
        )}

        <button
          onClick={handleFundWallet}
          disabled={loading}
          className="w-full btn-primary text-sm bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin mr-2 inline-block" />
              Funding...
            </>
          ) : (
            "Fund Testnet Wallet"
          )}
        </button>

        <p className="text-xs text-blue-300/60 mt-2 text-center">
          Only available on Stellar testnet
        </p>
      </div>
    </div>
  );
}
