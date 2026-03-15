/**
 * lib/wallet.ts
 * Freighter wallet integration for Stellar MarketPay.
 */

import { isConnected, getPublicKey, signTransaction, requestAccess, isAllowed } from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "./stellar";

export async function isFreighterInstalled(): Promise<boolean> {
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

export async function connectWallet(): Promise<{ publicKey: string | null; error: string | null }> {
  const installed = await isFreighterInstalled();
  if (!installed) return { publicKey: null, error: "Freighter wallet not installed. Visit https://freighter.app" };

  try {
    await requestAccess();
    const result = await getPublicKey();
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
  try {
    const allowed = await isAllowed();
    const isAllowedBool = typeof allowed === "object" && allowed !== null && "isAllowed" in allowed
      ? (allowed as any).isAllowed
      : Boolean(allowed);
    if (!isAllowedBool) return null;
    const result = await getPublicKey();
    const pk = typeof result === "object" && result !== null && "publicKey" in result
      ? (result as any).publicKey
      : result as string;
    return pk || null;
  } catch {
    return null;
  }
}

export async function signTransactionWithWallet(transactionXDR: string): Promise<{ signedXDR: string | null; error: string | null }> {
  try {
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "MAINNET" : "TESTNET";
    const result = await signTransaction(transactionXDR, { networkPassphrase: NETWORK_PASSPHRASE, network });
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
