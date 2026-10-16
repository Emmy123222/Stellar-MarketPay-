/**
 * __tests__/ssr-guards.test.ts
 * Issue #1892 — server-environment guards for lib/stellar.ts and lib/wallet.ts.
 * These run in the node environment (no `window`), asserting that wallet
 * entry points fail gracefully during SSR instead of crashing.
 * @jest-environment node
 */
jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn().mockResolvedValue(true),
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

import * as stellarLib from "@/lib/stellar";
import {
  startWalletDisconnectPolling,
  subscribeToAccountChanges,
} from "../lib/wallet";

describe("stellar.ts in a server environment", () => {
  it("rejects connectWallet outside the browser", async () => {
    await expect(stellarLib.connectWallet()).rejects.toThrow(
      "connectWallet is only available in the browser.",
    );
  });

  it("rejects signAndSubmitEscrowTx outside the browser", async () => {
    await expect(stellarLib.signAndSubmitEscrowTx("SOME_XDR")).rejects.toThrow(
      "Freighter is only available in the browser.",
    );
  });

  it("returns an error from signTransactionWithWallet outside the browser", async () => {
    await expect(
      stellarLib.signTransactionWithWallet("SOME_XDR"),
    ).resolves.toEqual({
      signedXDR: null,
      error: "Freighter is only available in the browser.",
    });
  });
});

describe("wallet.ts in a server environment", () => {
  it("returns null from subscribeToAccountChanges when window is undefined", () => {
    expect(subscribeToAccountChanges(jest.fn())).toBeNull();
  });

  it("returns a no-op stop function from startWalletDisconnectPolling", () => {
    const onDisconnect = jest.fn();
    const stop = startWalletDisconnectPolling(onDisconnect);
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
    expect(onDisconnect).not.toHaveBeenCalled();
  });
});
