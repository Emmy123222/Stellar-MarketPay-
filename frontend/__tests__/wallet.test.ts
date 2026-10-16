/**
 * __tests__/wallet.test.ts
 * Unit tests for lib/wallet.ts with @stellar/freighter-api and the auth API
 * mocked. Issue #1892 — covers the connect flow, connected-key lookup,
 * signing (including contract-mock bypass and rejection propagation),
 * SEP-0010 auth, account-change subscription, and disconnect polling
 * without a real network or browser extension.
 */
jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  getPublicKey: jest.fn(),
  getNetworkDetails: jest.fn(),
  signTransaction: jest.fn(),
  requestAccess: jest.fn(),
  isAllowed: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  fetchAuthChallenge: jest.fn(),
  verifyAuthChallenge: jest.fn(),
  setJwtToken: jest.fn(),
}));

import { Networks } from "@stellar/stellar-sdk";
import {
  connectWallet,
  getConnectedPublicKey,
  performSEP0010Auth,
  signTransactionWithWallet,
  startWalletDisconnectPolling,
  subscribeToAccountChanges,
} from "../lib/wallet";

type JestMock = jest.Mock;
type FreightMock = Record<string, JestMock>;

const freighter = (): FreightMock => require("@stellar/freighter-api");
const api = (): FreightMock => require("@/lib/api");

const CLIENT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const win = window as unknown as { freighter?: unknown };

const originalEnv = {
  MOCK: process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK,
  NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
};

beforeEach(() => {
  for (const mock of Object.values(freighter())) mock.mockReset();
  for (const mock of Object.values(api())) mock.mockReset();
  delete win.freighter;
  localStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalEnv.MOCK === undefined) {
    delete process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK;
  } else {
    process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK = originalEnv.MOCK;
  }
  if (originalEnv.NETWORK === undefined) {
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
  } else {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = originalEnv.NETWORK;
  }
});

// ---------------------------------------------------------------------------
// connectWallet
// ---------------------------------------------------------------------------

describe("connectWallet", () => {
  it("returns an error when the extension is not installed", async () => {
    freighter().isConnected.mockResolvedValue(false);

    const result = await connectWallet();
    expect(result).toEqual({
      publicKey: null,
      error: "Freighter wallet not installed. Visit https://freighter.app",
    });
  });

  it("treats an object-shaped isConnected response as missing", async () => {
    freighter().isConnected.mockResolvedValue({ isConnected: false });

    const result = await connectWallet();
    expect(result.error).toMatch(/not installed/);
  });

  it("connects through window.freighter when present", async () => {
    const windowFreighter = {
      isConnected: jest.fn().mockResolvedValue(true),
      requestAccess: jest.fn().mockResolvedValue(undefined),
      getPublicKey: jest.fn().mockResolvedValue(CLIENT),
    };
    win.freighter = windowFreighter;

    const result = await connectWallet();
    expect(result).toEqual({ publicKey: CLIENT, error: null });
    expect(windowFreighter.requestAccess).toHaveBeenCalledTimes(1);
  });

  it("connects through the Freighter API module", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().requestAccess.mockResolvedValue(undefined);
    freighter().getPublicKey.mockResolvedValue("G_API_KEY");

    const result = await connectWallet();
    expect(result).toEqual({ publicKey: "G_API_KEY", error: null });
  });

  it("normalises an object-shaped public key response", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().requestAccess.mockResolvedValue(undefined);
    freighter().getPublicKey.mockResolvedValue({ publicKey: CLIENT });

    const result = await connectWallet();
    expect(result.publicKey).toBe(CLIENT);
  });

  it("returns null publicKey when the wallet reports an empty key", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().requestAccess.mockResolvedValue(undefined);
    freighter().getPublicKey.mockResolvedValue("");

    const result = await connectWallet();
    expect(result).toEqual({ publicKey: null, error: null });
  });

  it("reports a user-declined connection approval", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().requestAccess.mockRejectedValue(new Error("User declined"));

    const result = await connectWallet();
    expect(result).toEqual({
      publicKey: null,
      error: "Connection rejected. Please approve in Freighter.",
    });
  });

  it("wraps unexpected connection failures", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().requestAccess.mockRejectedValue(new Error("boom"));

    const result = await connectWallet();
    expect(result).toEqual({
      publicKey: null,
      error: "Wallet connection failed: boom",
    });
  });

  it("stringifies non-Error connection failures", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().requestAccess.mockRejectedValue("weird-reason");

    const result = await connectWallet();
    expect(result.error).toBe("Wallet connection failed: weird-reason");
  });
});

// ---------------------------------------------------------------------------
// getConnectedPublicKey
// ---------------------------------------------------------------------------

describe("getConnectedPublicKey", () => {
  it("returns null when the session is not allowed", async () => {
    freighter().isAllowed.mockResolvedValue(false);

    expect(await getConnectedPublicKey()).toBeNull();
    expect(freighter().getPublicKey).not.toHaveBeenCalled();
  });

  it("reads the key back when allowed (object response)", async () => {
    freighter().isAllowed.mockResolvedValue({ isAllowed: true });
    freighter().getPublicKey.mockResolvedValue({ publicKey: CLIENT });

    expect(await getConnectedPublicKey()).toBe(CLIENT);
  });

  it("returns null when the wallet reports an empty key", async () => {
    freighter().isAllowed.mockResolvedValue(true);
    freighter().getPublicKey.mockResolvedValue("");

    expect(await getConnectedPublicKey()).toBeNull();
  });

  it("returns null when the permission check throws", async () => {
    freighter().isAllowed.mockRejectedValue(new Error("locked"));

    expect(await getConnectedPublicKey()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// signTransactionWithWallet
// ---------------------------------------------------------------------------

describe("signTransactionWithWallet", () => {
  it("signs via the API module with testnet options", async () => {
    freighter().signTransaction.mockResolvedValue("SIGNED_XDR");

    const result = await signTransactionWithWallet("UNSIGNED_XDR");
    expect(result).toEqual({ signedXDR: "SIGNED_XDR", error: null });
    expect(freighter().signTransaction).toHaveBeenCalledWith("UNSIGNED_XDR", {
      networkPassphrase: Networks.TESTNET,
      network: "TESTNET",
    });
  });

  it("signs via window.freighter and reads an object response", async () => {
    const signTransaction = jest.fn().mockResolvedValue({
      signedTransaction: "WINDOW_SIGNED",
    });
    win.freighter = { signTransaction };

    const result = await signTransactionWithWallet("UNSIGNED_XDR");
    expect(result).toEqual({ signedXDR: "WINDOW_SIGNED", error: null });
    expect(signTransaction).toHaveBeenCalledWith("UNSIGNED_XDR", {
      networkPassphrase: Networks.TESTNET,
      network: "TESTNET",
    });
  });

  it("propagates a user rejection", async () => {
    freighter().signTransaction.mockRejectedValue(
      new Error("User declined to sign."),
    );

    const result = await signTransactionWithWallet("UNSIGNED_XDR");
    expect(result).toEqual({
      signedXDR: null,
      error: "Transaction signing rejected.",
    });
  });

  it("treats a generic 'rejected' failure as a rejection", async () => {
    freighter().signTransaction.mockRejectedValue(
      new Error("Request was rejected"),
    );

    const result = await signTransactionWithWallet("UNSIGNED_XDR");
    expect(result.error).toBe("Transaction signing rejected.");
  });

  it("wraps unexpected signing failures", async () => {
    freighter().signTransaction.mockRejectedValue(new Error("boom"));

    const result = await signTransactionWithWallet("UNSIGNED_XDR");
    expect(result).toEqual({ signedXDR: null, error: "Signing failed: boom" });
  });

  it("stringifies non-Error signing failures", async () => {
    freighter().signTransaction.mockRejectedValue("weird-reason");

    const result = await signTransactionWithWallet("UNSIGNED_XDR");
    expect(result.error).toBe("Signing failed: weird-reason");
  });

  it("bypasses Freighter for the contract-mock placeholder XDR", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    const result = await signTransactionWithWallet("MOCK_UNSIGNED_XDR", {
      fee: "123",
    });
    expect(result).toEqual({
      signedXDR: "MOCK_SIGNED_XDR",
      error: null,
      mockParams: { fee: "123" },
    });
    expect(freighter().signTransaction).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("signs the placeholder through Freighter when the mock is disabled", async () => {
    process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK = "false";
    freighter().signTransaction.mockResolvedValue("REAL_SIGNED");

    const result = await signTransactionWithWallet("MOCK_UNSIGNED_XDR");
    expect(result).toEqual({ signedXDR: "REAL_SIGNED", error: null });
    expect(freighter().signTransaction).toHaveBeenCalledWith(
      "MOCK_UNSIGNED_XDR",
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// performSEP0010Auth
// ---------------------------------------------------------------------------

describe("performSEP0010Auth", () => {
  it("runs challenge → sign → verify and stores the JWT", async () => {
    api().fetchAuthChallenge.mockResolvedValue("CHALLENGE_XDR");
    freighter().signTransaction.mockResolvedValue("SIGNED_CHALLENGE");
    api().verifyAuthChallenge.mockResolvedValue("jwt-123");

    const result = await performSEP0010Auth(CLIENT);
    expect(result).toEqual({ token: "jwt-123", error: null });
    expect(api().fetchAuthChallenge).toHaveBeenCalledWith(CLIENT);
    expect(api().verifyAuthChallenge).toHaveBeenCalledWith("SIGNED_CHALLENGE");
    expect(api().setJwtToken).toHaveBeenCalledWith("jwt-123");
  });

  it("surfaces a signing rejection without verifying", async () => {
    api().fetchAuthChallenge.mockResolvedValue("CHALLENGE_XDR");
    freighter().signTransaction.mockRejectedValue(
      new Error("User declined"),
    );

    const result = await performSEP0010Auth(CLIENT);
    expect(result).toEqual({
      token: null,
      error: "Transaction signing rejected.",
    });
    expect(api().verifyAuthChallenge).not.toHaveBeenCalled();
    expect(api().setJwtToken).not.toHaveBeenCalled();
  });

  it("reports a missing signature", async () => {
    api().fetchAuthChallenge.mockResolvedValue("CHALLENGE_XDR");
    freighter().signTransaction.mockResolvedValue("");

    const result = await performSEP0010Auth(CLIENT);
    expect(result).toEqual({
      token: null,
      error: "Failed to sign challenge",
    });
    expect(api().verifyAuthChallenge).not.toHaveBeenCalled();
  });

  it("wraps challenge fetch failures", async () => {
    api().fetchAuthChallenge.mockRejectedValue(new Error("network down"));

    const result = await performSEP0010Auth(CLIENT);
    expect(result).toEqual({
      token: null,
      error: "Authentication failed: network down",
    });
  });

  it("wraps verification failures", async () => {
    api().fetchAuthChallenge.mockResolvedValue("CHALLENGE_XDR");
    freighter().signTransaction.mockResolvedValue("SIGNED_CHALLENGE");
    api().verifyAuthChallenge.mockRejectedValue(new Error("verify exploded"));

    const result = await performSEP0010Auth(CLIENT);
    expect(result).toEqual({
      token: null,
      error: "Authentication failed: verify exploded",
    });
    expect(api().setJwtToken).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// subscribeToAccountChanges
// ---------------------------------------------------------------------------

describe("subscribeToAccountChanges", () => {
  it("reports the public key carried on the event detail", () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeToAccountChanges(onChange);

    window.dispatchEvent(
      new CustomEvent("accountChanged", { detail: { publicKey: CLIENT } }),
    );
    expect(onChange).toHaveBeenCalledWith(CLIENT);

    unsubscribe?.();
  });

  it("reports null when the event detail carries a null key", () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeToAccountChanges(onChange);

    window.dispatchEvent(
      new CustomEvent("accountChanged", { detail: { publicKey: null } }),
    );
    expect(onChange).toHaveBeenCalledWith(null);

    unsubscribe?.();
  });

  it("reads the key back when the event has no payload", async () => {
    freighter().isAllowed.mockResolvedValue(true);
    freighter().getPublicKey.mockResolvedValue("G_FALLBACK");
    const onChange = jest.fn();
    const unsubscribe = subscribeToAccountChanges(onChange);

    window.dispatchEvent(new CustomEvent("accountChanged"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onChange).toHaveBeenCalledWith("G_FALLBACK");

    unsubscribe?.();
  });

  it("stops delivering events after unsubscribing", () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeToAccountChanges(onChange);
    unsubscribe?.();

    window.dispatchEvent(
      new CustomEvent("accountChanged", { detail: { publicKey: CLIENT } }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// startWalletDisconnectPolling
// ---------------------------------------------------------------------------

describe("startWalletDisconnectPolling", () => {
  it("detects a disconnected wallet, clears storage, and stops polling", async () => {
    jest.useFakeTimers();
    try {
      freighter().isConnected.mockResolvedValue(false);
      localStorage.setItem("smp_jwt_token", "jwt");
      localStorage.setItem("smp_wallet_public_key", CLIENT);
      const onDisconnect = jest.fn();

      const stop = startWalletDisconnectPolling(onDisconnect);
      await jest.advanceTimersByTimeAsync(30_000);

      expect(onDisconnect).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem("smp_jwt_token")).toBeNull();
      expect(localStorage.getItem("smp_wallet_public_key")).toBeNull();

      await jest.advanceTimersByTimeAsync(90_000);
      expect(onDisconnect).toHaveBeenCalledTimes(1);

      stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps polling while the wallet stays connected", async () => {
    jest.useFakeTimers();
    try {
      freighter().isConnected.mockResolvedValue(true);
      const onDisconnect = jest.fn();

      const stop = startWalletDisconnectPolling(onDisconnect);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(onDisconnect).not.toHaveBeenCalled();

      stop();
      await jest.advanceTimersByTimeAsync(90_000);
      expect(onDisconnect).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Mainnet network selection (NEXT_PUBLIC_STELLAR_NETWORK=mainnet)
// Must run last: it resets the module registry.
// ---------------------------------------------------------------------------

describe("mainnet network selection (NEXT_PUBLIC_STELLAR_NETWORK)", () => {
  let wallet: typeof import("../lib/wallet");

  beforeAll(() => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = "mainnet";
    jest.resetModules();
    wallet = require("../lib/wallet");
  });

  afterAll(() => {
    if (originalEnv.NETWORK === undefined) {
      delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    } else {
      process.env.NEXT_PUBLIC_STELLAR_NETWORK = originalEnv.NETWORK;
    }
    jest.resetModules();
  });

  it("passes MAINNET and the Public passphrase to the wallet", async () => {
    const signTransaction = freighter().signTransaction;
    signTransaction.mockResolvedValue("SIGNED_MAINNET");

    const result = await wallet.signTransactionWithWallet("MAINNET_XDR");
    expect(result).toEqual({ signedXDR: "SIGNED_MAINNET", error: null });
    expect(signTransaction).toHaveBeenCalledWith("MAINNET_XDR", {
      networkPassphrase: Networks.PUBLIC,
      network: "MAINNET",
    });
  });
});
