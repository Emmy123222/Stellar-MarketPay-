/**
 * components/PasskeyManager.tsx
 * Passkey (WebAuthn) registration and management UI (Issue #218)
 */
import { useEffect, useState } from "react";
import {
  fetchPasskeyCredentials,
  fetchPasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  deletePasskeyCredential,
  PasskeyCredential,
} from "@/lib/api";
import { useToast } from "@/components/Toast";
import clsx from "clsx";

interface Props {
  publicKey: string;
}

export default function PasskeyManager({ publicKey }: Props) {
  const [passkeys, setPasskeys]       = useState<PasskeyCredential[]>([]);
  const [loading, setLoading]         = useState(true);
  const [registering, setRegistering] = useState(false);
  const [newKeyName, setNewKeyName]   = useState("");
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const { success, info } = useToast();

  useEffect(() => {
    fetchPasskeyCredentials()
      .then(setPasskeys)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [publicKey]);

  const handleRegister = async () => {
    if (!window.PublicKeyCredential) {
      info("Your browser does not support passkeys.");
      return;
    }
    setRegistering(true);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const options    = await fetchPasskeyRegistrationOptions(publicKey);
      const credential = await startRegistration(options);
      await verifyPasskeyRegistration(credential, newKeyName.trim() || "Passkey");
      success("Passkey registered successfully!");
      setNewKeyName("");
      const updated = await fetchPasskeyCredentials();
      setPasskeys(updated);
    } catch (e: any) {
      info(e?.message || "Passkey registration failed. Please try again.");
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deletePasskeyCredential(id);
      setPasskeys((prev) => prev.filter((p) => p.id !== id));
      success("Passkey removed.");
    } catch (e: any) {
      info(e?.message || "Failed to remove passkey.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-xl text-amber-100 mb-1">Passkeys</h3>
        <p className="text-sm text-amber-800">
          Register your fingerprint, Face ID, or a hardware security key to sign in without
          your wallet. Works on Chrome, Safari, Firefox, and Edge.
        </p>
      </div>

      <div className="card space-y-3 max-w-lg">
        <p className="text-sm font-medium text-amber-200">Add a new passkey</p>
        <input
          type="text"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          className="input-field"
          placeholder="Name (e.g. iPhone, YubiKey)"
          maxLength={64}
          disabled={registering}
        />
        <button
          className="btn-primary text-sm"
          onClick={handleRegister}
          disabled={registering}
        >
          {registering ? "Waiting for device…" : "Register passkey"}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-amber-800/70">
          Registered passkeys ({passkeys.length}/5)
        </p>
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="card animate-pulse h-14" />)}
          </div>
        ) : passkeys.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-amber-800 text-sm">No passkeys registered yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {passkeys.map((pk) => (
              <div key={pk.id} className="card flex items-center justify-between gap-4">
                <div>
                  <p className="text-amber-100 font-medium text-sm">{pk.credential_name}</p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Added {new Date(pk.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  className={clsx(
                    "btn-secondary text-xs px-3 py-1.5",
                    deletingId === pk.id && "opacity-50 pointer-events-none"
                  )}
                  onClick={() => handleDelete(pk.id)}
                  disabled={deletingId === pk.id}
                >
                  {deletingId === pk.id ? "Removing…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
