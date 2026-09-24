/**
 * lib/wallet.ts
 * Freighter wallet integration for Stellar MarketPay.
 */

import { isConnected, getPublicKey, signTransaction, requestAccess, isAllowed } from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "./stellar";
import { fetchAuthChallenge, verifyAuthChallenge, setJwtToken } from "./api";

type FreighterWindowApi = {
  isConnected?: () => Promise<boolean | { isConnected?: boolean }>;
  isAllowed?: () => Promise<boolean | { isAllowed?: boolean }>;
  requestAccess?: () => Promise<unknown>;
  getPublicKey?: () => Promise<string | { publicKey?: string }>;
  signTransaction?: (transactionXDR: string, opts: Record<string, unknown>) => Promise<string | { signedTransaction?: string }>;
  getVersion?: () => Promise<string>;
  requestBuy?: (opts: { assetCode: string }) => Promise<{ success: boolean } | void>;
};

function getWindowFreighter(): FreighterWindowApi | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { freighter?: FreighterWindowApi };
  return w.freighter ?? null;
}

export async function isFreighterInstalled(): Promise<boolean> {
  const freighter = getWindowFreighter();
  if (freighter?.isConnected) {
    try {
      const result = await freighter.isConnected();
      if (typeof result === "object" && result !== null && "isConnected" in result) {
        return Boolean((result as { isConnected?: boolean }).isConnected);
      }
      return Boolean(result);
    } catch {
      return false;
    }
  }

  try {
    const result = await isConnected();
    // Handle both object and boolean return types from Freighter API
    if (typeof result === "object" && result !== null && "isConnected" in result) {
      return Boolean((result as any).isConnected);
    }
    return Boolean(result);
  } catch {
    return false;
  }
}

/**
 * Minimum Freighter extension version required for `requestBuy()`.
 * See docs/auth-flow.md § Freighter On-Ramp (requestBuy).
 */
export const FREIGHTER_REQUEST_BUY_MIN_VERSION = "5.0.0";

/**
 * Parse a semver-like version string into a numeric tuple for comparison.
 * Handles "5.2.1", "5.2", "5" and ignores pre-release suffixes.
 */
export function parseVersion(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version
    .split("-")[0]
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  return [major, minor, patch];
}

/**
 * Returns true if `version` >= `minimum` (semver-style comparison).
 */
export function isVersionAtLeast(version: string, minimum: string): boolean {
  const [mMaj, mMin, mPat] = parseVersion(minimum);
  const [vMaj, vMin, vPat] = parseVersion(version);
  if (vMaj !== mMaj) return vMaj > mMaj;
  if (vMin !== mMin) return vMin > mMin;
  return vPat >= mPat;
}

/**
 * Get the installed Freighter extension version string.
 * Returns null if Freighter is not installed or does not expose getVersion().
 */
export async function getFreighterVersion(): Promise<string | null> {
  const freighter = getWindowFreighter();
  if (!freighter?.getVersion) return null;
  try {
    const v = await freighter.getVersion();
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the installed Freighter extension supports requestBuy().
 * Requires Freighter >= FREIGHTER_REQUEST_BUY_MIN_VERSION and the method present.
 */
export async function supportsRequestBuy(): Promise<boolean> {
  const freighter = getWindowFreighter();
  if (!freighter?.requestBuy) return false;
  const version = await getFreighterVersion();
  if (!version) return false;
  return isVersionAtLeast(version, FREIGHTER_REQUEST_BUY_MIN_VERSION);
}

/**
 * Invoke Freighter's native on-ramp flow for the given asset.
 * Resolves on success, throws on user cancellation or API error.
 */
export async function freighterRequestBuy(assetCode: string): Promise<void> {
  const freighter = getWindowFreighter();
  if (!freighter?.requestBuy) {
    throw new Error("Freighter requestBuy() is not available in this version.");
  }
  await freighter.requestBuy({ assetCode });
}

export async function connectWallet(): Promise<{ publicKey: string | null; error: string | null }> {
  const installed = await isFreighterInstalled();
  if (!installed) return { publicKey: null, error: "Freighter wallet not installed. Visit https://freighter.app" };

  const freighter = getWindowFreighter();
  try {
    if (freighter?.requestAccess) {
      await freighter.requestAccess();
    } else {
      await requestAccess();
    }
    const result = freighter?.getPublicKey ? await freighter.getPublicKey() : await getPublicKey();
    const publicKey = typeof result === "object" && result !== null && "publicKey" in result
      ? (result as any).publicKey
      : result as string;
    return { publicKey: publicKey || null, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("User declined")) return { publicKey: null, error: "Connection rejected. Please approve in Freighter." };
    return { publicKey: null, error: `Wallet connection failed: ${msg}` };
  }
}

export async function getConnectedPublicKey(): Promise<string | null> {
  const freighter = getWindowFreighter();
  try {
    const allowed = freighter?.isAllowed ? await freighter.isAllowed() : await isAllowed();
    const isAllowedBool = typeof allowed === "object" && allowed !== null && "isAllowed" in allowed
      ? (allowed as any).isAllowed
      : Boolean(allowed);
    if (!isAllowedBool) return null;
    const result = freighter?.getPublicKey ? await freighter.getPublicKey() : await getPublicKey();
    const pk = typeof result === "object" && result !== null && "publicKey" in result
      ? (result as any).publicKey
      : result as string;
    return pk || null;
  } catch {
    return null;
  }
}

/**
 * Run the full SEP-0010 auth flow after wallet connection.
 * Returns the JWT on success, or an error string.
 */
export async function performSEP0010Auth(
  publicKey: string
): Promise<{ token: string | null; error: string | null }> {
  try {
    const challengeXDR = await fetchAuthChallenge(publicKey);
    const { signedXDR, error: signError } = await signTransactionWithWallet(challengeXDR);
    if (signError || !signedXDR) {
      return { token: null, error: signError || "Failed to sign challenge" };
    }
    const token = await verifyAuthChallenge(signedXDR);
    setJwtToken(token);
    return { token, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { token: null, error: `Authentication failed: ${msg}` };
  }
}

export async function signTransactionWithWallet(transactionXDR: string, mockParams?: any): Promise<{ signedXDR: string | null; error: string | null; mockParams?: any }> {
  // Mock mode: bypass Freighter entirely
  if (process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true" && transactionXDR === "MOCK_UNSIGNED_XDR") {
    console.log("[WALLET] Mock mode: skipping Freighter signature");
    return { signedXDR: "MOCK_SIGNED_XDR", error: null, mockParams };
  }

  const freighter = getWindowFreighter();
  try {
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "MAINNET" : "TESTNET";
    const result = freighter?.signTransaction
      ? await freighter.signTransaction(transactionXDR, { networkPassphrase: NETWORK_PASSPHRASE, network })
      : await signTransaction(transactionXDR, { networkPassphrase: NETWORK_PASSPHRASE, network });
    const signedXDR = typeof result === "object" && result !== null && "signedTransaction" in result
      ? (result as any).signedTransaction
      : result as string;
    return { signedXDR, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("User declined") || msg.includes("rejected")) return { signedXDR: null, error: "Transaction signing rejected." };
    return { signedXDR: null, error: `Signing failed: ${msg}` };
  }
}

/**
 * Issue #499 — Subscribe to Freighter account changes.
 *
 * Freighter exposes `window.freighter.on('accountChanged', callback)` in newer
 * versions. This helper wraps that API with a polling fallback for older builds.
 *
 * @returns Unsubscribe function, or null if not supported (caller should poll).
 */
export function subscribeToAccountChanges(
  callback: (publicKey: string | null) => void
): (() => void) | null {
  if (typeof window === "undefined") return null;

  const w = window as Window & {
    freighter?: {
      on?: (event: string, cb: (data: unknown) => void) => void;
      off?: (event: string, cb: (data: unknown) => void) => void;
    };
  };

  if (w.freighter?.on && w.freighter?.off) {
    const handler = (data: unknown) => {
      // Freighter passes the new public key (string) or undefined on disconnect
      const pk = typeof data === "string" && data.length > 0 ? data : null;
      callback(pk);
    };
    w.freighter.on("accountChanged", handler);
    return () => w.freighter?.off?.("accountChanged", handler);
  }

  // No native event support — return null so caller can poll
  return null;
}
