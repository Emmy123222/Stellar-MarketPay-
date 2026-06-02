import { useState } from "react";
import { setupAdmin2FA, verifyAdmin2FA } from "@/lib/api";
import { setJwtToken } from "@/lib/api";

interface Admin2FAModalProps {
  mode: "setup" | "verify";
  onComplete: () => void;
}

export default function Admin2FAModal({ mode, onComplete }: Admin2FAModalProps) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupStarted, setSetupStarted] = useState(mode === "verify");

  const startSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await setupAdmin2FA();
      setQrCode(data.qrCode);
      setManualKey(data.manualEntryKey);
      setSetupStarted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start 2FA setup");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await verifyAdmin2FA(token, mode === "setup");
      if (result.token) setJwtToken(result.token);
      if (result.backupCodes?.length) {
        setBackupCodes(result.backupCodes);
        return;
      }
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  if (backupCodes) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-ink-950/90 backdrop-blur-sm" />
        <div className="relative w-full max-w-md rounded-2xl border border-market-500/20 bg-ink-900 p-6 shadow-2xl">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-2">Save your backup codes</h2>
          <p className="text-sm text-amber-800 mb-4">
            These codes are shown once. Store them securely — each code works only once.
          </p>
          <ul className="grid grid-cols-2 gap-2 mb-6 font-mono text-sm text-amber-200">
            {backupCodes.map((code) => (
              <li key={code} className="rounded-lg bg-ink-800 px-3 py-2 border border-market-500/10">
                {code}
              </li>
            ))}
          </ul>
          <button type="button" onClick={onComplete} className="btn-primary w-full">
            I have saved my backup codes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-950/90 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl border border-market-500/20 bg-ink-900 p-6 shadow-2xl">
        <h2 className="font-display text-xl font-bold text-amber-100 mb-2">
          {mode === "setup" ? "Set up two-factor authentication" : "Admin 2FA required"}
        </h2>
        <p className="text-sm text-amber-800 mb-4">
          {mode === "setup"
            ? "Scan the QR code with Google Authenticator (or similar), then enter the 6-digit code."
            : "Enter the 6-digit code from your authenticator app to continue."}
        </p>

        {mode === "setup" && !setupStarted && (
          <button type="button" onClick={startSetup} disabled={loading} className="btn-primary w-full mb-4">
            {loading ? "Generating…" : "Generate QR code"}
          </button>
        )}

        {qrCode && (
          <div className="flex flex-col items-center gap-3 mb-4">
            <img src={qrCode} alt="TOTP QR code" className="w-48 h-48 rounded-lg bg-white p-2" />
            {manualKey && (
              <p className="text-xs text-amber-700 font-mono break-all text-center">
                Manual key: {manualKey}
              </p>
            )}
          </div>
        )}

        {(setupStarted || mode === "verify") && (
          <form onSubmit={handleVerify} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="input w-full text-center text-lg tracking-widest font-mono"
              autoFocus
              required
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading || token.length !== 6} className="btn-primary w-full">
              {loading ? "Verifying…" : "Verify"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
