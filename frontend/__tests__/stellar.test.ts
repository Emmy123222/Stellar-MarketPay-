/**
 * __tests__/stellar.test.ts
 * Unit tests for lib/stellar.ts with @stellar/freighter-api mocked.
 * Issue #1892 — no real network access or browser extension is required:
 * Freighter is mocked, Soroban RPC / Horizon calls are stubbed on the
 * exported server instances, and `fetch` is stubbed (fee estimation then
 * uses its deterministic offline fallback: medium tier = 200 stroops →
 * inclusion fee 220 stroops).
 */
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Networks,
  Operation,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";
import * as StellarSdk from "@stellar/stellar-sdk";
import * as stellarLib from "@/lib/stellar";

jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  getPublicKey: jest.fn(),
  getNetworkDetails: jest.fn(),
  signTransaction: jest.fn(),
  requestAccess: jest.fn(),
  isAllowed: jest.fn(),
}));

jest.mock("@/lib/contractMock", () => ({
  mockCreateEscrow: jest.fn().mockResolvedValue("MOCKESCROWHASH"),
  mockReleaseEscrow: jest.fn(),
  mockGetEscrow: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const CLIENT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const RECIPIENT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TEST_CONTRACT_ID = Address.contract(Buffer.alloc(32, 1)).toString();

type FreightMock = {
  isConnected: jest.Mock;
  getPublicKey: jest.Mock;
  getNetworkDetails: jest.Mock;
  signTransaction: jest.Mock;
  requestAccess: jest.Mock;
  isAllowed: jest.Mock;
};

/** Fresh reference so mocks keep working after jest.resetModules(). */
const freighter = (): FreightMock => require("@stellar/freighter-api");

function makeSuccessSim(minResourceFee = "5000"): SorobanRpc.Api.SimulateTransactionResponse {
  return {
    latestLedger: 100,
    events: [],
    transactionData: new SorobanDataBuilder().build().toXDR("base64"),
    minResourceFee,
    results: [{ auth: [], xdr: "" }],
  } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
}

function makeErrorSim(message = "boom-from-simulation"): SorobanRpc.Api.SimulateTransactionResponse {
  return {
    latestLedger: 100,
    error: message,
  } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
}

function stubAccountAndSim(
  instance: typeof stellarLib,
  sequence = "4242",
): void {
  jest
    .spyOn(instance.sorobanServer, "getAccount")
    .mockResolvedValue(new Account(CLIENT, sequence) as never);
  jest
    .spyOn(instance.sorobanServer, "simulateTransaction")
    .mockResolvedValue(makeSuccessSim() as never);
  jest
    .spyOn(instance.sorobanServer, "sendTransaction")
    .mockResolvedValue({ status: "PENDING", hash: "DEFAULTHASH" } as never);
  jest
    .spyOn(instance.sorobanServer, "getTransaction")
    .mockResolvedValue({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
    } as never);
}

function decodeInvoke(
  sdk: typeof StellarSdk,
  tx: Transaction,
): {
  fn: string;
  contractAddress: string;
  args: any[];
} {
  const op = tx.operations[0] as any;
  expect(op.type).toBe("invokeHostFunction");
  expect(op.func.switch().name).toBe("hostFunctionTypeInvokeContract");
  const ic = op.func.invokeContract();
  return {
    fn: ic.functionName().toString(),
    contractAddress: sdk.Address.fromScAddress(ic.contractAddress()).toString(),
    args: ic.args(),
  };
}

function scvString(v: any): string {
  expect(v.switch().name).toBe("scvString");
  return v.value().toString();
}

function scvAddress(sdk: typeof StellarSdk, v: any): string {
  expect(v.switch().name).toBe("scvAddress");
  return sdk.Address.fromScAddress(v.value()).toString();
}

function scvI128Equals(v: any, expected: bigint): boolean {
  return v.toXDR("base64") === nativeToScVal(expected, { type: "i128" }).toXDR("base64");
}

function makePreparedXdr(): string {
  const account = new Account(CLIENT, "100");
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: RECIPIENT,
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const realFetch = global.fetch;
const fetchMock = jest.fn();
const originalEnv = {
  CONTRACT_ID: process.env.NEXT_PUBLIC_CONTRACT_ID,
  MOCK: process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK,
  NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: fetch offline → fee estimation takes its deterministic fallback.
  fetchMock.mockRejectedValue(new Error("offline"));
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
  if (realFetch === undefined) {
    delete (global as unknown as { fetch?: unknown }).fetch;
  } else {
    global.fetch = realFetch;
  }
});

// ===========================================================================
// Default instance: testnet env, CONTRACT_ID unset, NEXT_PUBLIC_USE_CONTRACT_MOCK=true
// ===========================================================================

describe("network & helper constants (testnet)", () => {
  it("uses the Testnet passphrase", () => {
    expect(stellarLib.NETWORK_PASSPHRASE).toBe(Networks.TESTNET);
  });

  it("uses the testnet USDC issuer", () => {
    expect(stellarLib.USDC_ISSUER).toBe(
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    );
    expect(stellarLib.USDC.code).toBe("USDC");
  });

  it("builds testnet explorer and account URLs", () => {
    expect(stellarLib.explorerUrl("abc123")).toBe(
      "https://stellar.expert/explorer/testnet/tx/abc123",
    );
    expect(stellarLib.accountUrl(CLIENT)).toBe(
      `https://stellar.expert/explorer/testnet/account/${CLIENT}`,
    );
  });

  it("validates Stellar addresses", () => {
    expect(stellarLib.isValidStellarAddress(CLIENT)).toBe(true);
    expect(stellarLib.isValidStellarAddress("not-an-address")).toBe(false);
  });
});

describe("connectWallet (Freighter)", () => {
  it("throws a friendly error when the extension is not installed", async () => {
    freighter().isConnected.mockResolvedValue(false);
    await expect(stellarLib.connectWallet()).rejects.toThrow(
      "Freighter wallet not found. Please install the Freighter extension.",
    );
  });

  it("throws when Freighter has no account", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().getPublicKey.mockResolvedValue("");
    await expect(stellarLib.connectWallet()).rejects.toThrow(
      "No Stellar account found in Freighter wallet.",
    );
  });

  it("resolves testnet for a testnet-configured Freighter", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().getPublicKey.mockResolvedValue(CLIENT);
    freighter().getNetworkDetails.mockResolvedValue({
      networkPassphrase: Networks.TESTNET,
    });
    await expect(stellarLib.connectWallet()).resolves.toEqual({
      publicKey: CLIENT,
      network: "testnet",
    });
  });

  it("resolves mainnet when Freighter is on the public network", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().getPublicKey.mockResolvedValue(CLIENT);
    freighter().getNetworkDetails.mockResolvedValue({
      networkPassphrase: Networks.PUBLIC,
    });
    await expect(stellarLib.connectWallet()).resolves.toEqual({
      publicKey: CLIENT,
      network: "mainnet",
    });
  });

  it("falls back to testnet when getNetworkDetails fails", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().getPublicKey.mockResolvedValue(CLIENT);
    freighter().getNetworkDetails.mockRejectedValue(new Error("nope"));
    await expect(stellarLib.connectWallet()).resolves.toEqual({
      publicKey: CLIENT,
      network: "testnet",
    });
  });

  it("surfaces a network mismatch (Freighter mainnet vs app testnet)", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().getPublicKey.mockResolvedValue(CLIENT);
    freighter().getNetworkDetails.mockResolvedValue({
      networkPassphrase: Networks.PUBLIC,
    });

    const result = await stellarLib.connectWallet();
    const appNetwork =
      stellarLib.NETWORK_PASSPHRASE === Networks.PUBLIC ? "mainnet" : "testnet";

    // The wallet's network is reported so callers can show a mismatch warning.
    expect(result.network).toBe("mainnet");
    expect(appNetwork).toBe("testnet");
    expect(result.network).not.toBe(appNetwork);
  });
});

describe("signTransactionWithWallet (stellar.ts)", () => {
  it("returns an error when the extension is missing", async () => {
    freighter().isConnected.mockResolvedValue(false);
    const result = await stellarLib.signTransactionWithWallet("XDR");
    expect(result.signedXDR).toBeNull();
    expect(result.error).toBe(
      "Freighter wallet not found. Please install the Freighter extension.",
    );
  });

  it("returns the signed XDR for an object-shaped Freighter response", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockResolvedValue({ signedTransaction: "SIGNED" });
    const result = await stellarLib.signTransactionWithWallet("XDR");
    expect(result).toEqual({ signedXDR: "SIGNED", error: null });
  });

  it("returns the signed XDR for a string-shaped Freighter response", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockResolvedValue("SIGNED");
    const result = await stellarLib.signTransactionWithWallet("XDR");
    expect(result).toEqual({ signedXDR: "SIGNED", error: null });
    expect(freighter().signTransaction).toHaveBeenCalledWith("XDR", {
      network: "TESTNET",
      networkPassphrase: Networks.TESTNET,
    });
  });

  it("propagates a user rejection message", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockRejectedValue(
      new Error("User declined the transaction"),
    );
    const result = await stellarLib.signTransactionWithWallet("XDR");
    expect(result.signedXDR).toBeNull();
    expect(result.error).toBe("User declined the transaction");
  });

  it("normalises non-Error signing failures", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockRejectedValue("weird");
    const result = await stellarLib.signTransactionWithWallet("XDR");
    expect(result.signedXDR).toBeNull();
    expect(result.error).toBe("Signing failed");
  });
});

describe("signAndSubmitEscrowTx", () => {
  beforeEach(() => {
    stubAccountAndSim(stellarLib);
  });

  it("signs, submits and confirms a transaction", async () => {
    const xdr = makePreparedXdr();
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockResolvedValue(xdr);

    jest.spyOn(stellarLib.sorobanServer, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash: "TXHASH1",
    } as never);
    jest.spyOn(stellarLib.sorobanServer, "getTransaction").mockResolvedValue({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
    } as never);

    await expect(stellarLib.signAndSubmitEscrowTx(xdr)).resolves.toEqual({
      txHash: "TXHASH1",
    });
    expect(freighter().signTransaction).toHaveBeenCalledWith(xdr, {
      network: "TESTNET",
      networkPassphrase: Networks.TESTNET,
    });
    const sent = (stellarLib.sorobanServer.sendTransaction as jest.Mock).mock
      .calls[0][0];
    expect(sent).toBeInstanceOf(Transaction);
  });

  it("propagates a user-rejected signature", async () => {
    const xdr = makePreparedXdr();
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockRejectedValue(
      new Error("User declined"),
    );
    await expect(stellarLib.signAndSubmitEscrowTx(xdr)).rejects.toThrow(
      "User declined",
    );
    expect(stellarLib.sorobanServer.sendTransaction).not.toHaveBeenCalled();
  });

  it("throws when the extension is missing", async () => {
    freighter().isConnected.mockResolvedValue(false);
    await expect(stellarLib.signAndSubmitEscrowTx("XDR")).rejects.toThrow(
      "Freighter wallet not found. Please install the Freighter extension.",
    );
  });

  it("throws with the result XDR when submission fails", async () => {
    const xdr = makePreparedXdr();
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockResolvedValue(xdr);
    jest.spyOn(stellarLib.sorobanServer, "sendTransaction").mockResolvedValue({
      status: "ERROR",
      errorResult: { toXDR: () => "AAAARESULT" },
    } as never);

    await expect(stellarLib.signAndSubmitEscrowTx(xdr)).rejects.toThrow(
      "Transaction submission failed. Result XDR: AAAARESULT",
    );
  });

  it("throws when the confirmed transaction did not succeed", async () => {
    const xdr = makePreparedXdr();
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockResolvedValue(xdr);
    jest.spyOn(stellarLib.sorobanServer, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash: "TXHASH2",
    } as never);
    jest.spyOn(stellarLib.sorobanServer, "getTransaction").mockResolvedValue({
      status: SorobanRpc.Api.GetTransactionStatus.FAILED,
    } as never);

    await expect(stellarLib.signAndSubmitEscrowTx(xdr)).rejects.toThrow(
      "Transaction did not succeed. Status: FAILED",
    );
  });

  it("polls through NOT_FOUND until the transaction succeeds", async () => {
    jest.useFakeTimers();
    try {
      const xdr = makePreparedXdr();
      freighter().isConnected.mockResolvedValue(true);
      freighter().signTransaction.mockResolvedValue(xdr);
      jest.spyOn(stellarLib.sorobanServer, "sendTransaction").mockResolvedValue({
        status: "PENDING",
        hash: "TXHASH3",
      } as never);
      jest
        .spyOn(stellarLib.sorobanServer, "getTransaction")
        .mockResolvedValueOnce({
          status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND,
        } as never)
        .mockResolvedValueOnce({
          status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND,
        } as never)
        .mockResolvedValue({
          status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        } as never);

      const promise = stellarLib.signAndSubmitEscrowTx(xdr);
      for (let i = 0; i < 8; i += 1) {
        await jest.advanceTimersByTimeAsync(1000);
      }
      await expect(promise).resolves.toEqual({ txHash: "TXHASH3" });
      expect(
        stellarLib.sorobanServer.getTransaction,
      ).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("signAndSubmitSorobanTx", () => {
  it("returns the hash once the transaction succeeds", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockResolvedValue(makePreparedXdr());
    jest.spyOn(stellarLib.sorobanServer, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash: "SOROBANHASH",
    } as never);
    jest.spyOn(stellarLib.sorobanServer, "getTransaction").mockResolvedValue({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
    } as never);

    await expect(
      stellarLib.signAndSubmitSorobanTx(makePreparedXdr()),
    ).resolves.toBe("SOROBANHASH");
  });

  it("throws when the on-chain transaction fails", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockResolvedValue(makePreparedXdr());
    jest.spyOn(stellarLib.sorobanServer, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash: "SOROBANHASH2",
    } as never);
    jest.spyOn(stellarLib.sorobanServer, "getTransaction").mockResolvedValue({
      status: SorobanRpc.Api.GetTransactionStatus.FAILED,
    } as never);

    await expect(
      stellarLib.signAndSubmitSorobanTx(makePreparedXdr()),
    ).rejects.toThrow("The on-chain transaction failed.");
  });

  it("throws a submission error when the RPC rejects the transaction", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockResolvedValue(makePreparedXdr());
    jest.spyOn(stellarLib.sorobanServer, "sendTransaction").mockResolvedValue({
      status: "ERROR",
      errorResult: { toXDR: () => "ZZZZ" },
    } as never);

    await expect(
      stellarLib.signAndSubmitSorobanTx(makePreparedXdr()),
    ).rejects.toThrow("Transaction submission failed: ZZZZ");
  });

  it("times out after the polling budget is exhausted", async () => {
    jest.useFakeTimers();
    try {
      freighter().isConnected.mockResolvedValue(true);
      freighter().signTransaction.mockResolvedValue(makePreparedXdr());
      jest.spyOn(stellarLib.sorobanServer, "sendTransaction").mockResolvedValue({
        status: "PENDING",
        hash: "NEVERFOUND",
      } as never);
      jest
        .spyOn(stellarLib.sorobanServer, "getTransaction")
        .mockResolvedValue({
          status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND,
        } as never);

      const promise = stellarLib.signAndSubmitSorobanTx(makePreparedXdr());
      const assertion = expect(promise).rejects.toThrow(
        "Transaction timed out after 90 attempts. Hash: NEVERFOUND",
      );
      for (let i = 0; i < 12; i += 1) {
        await jest.advanceTimersByTimeAsync(10_000);
      }
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("contract-call guards (NEXT_PUBLIC_USE_CONTRACT_MOCK=true)", () => {
  it("createEscrowOnChain uses the contract mock", async () => {
    const result = await stellarLib.createEscrowOnChain({
      clientPublicKey: CLIENT,
      jobId: "job-77",
      budgetXlm: 12.5,
    });
    expect(result).toEqual({ txHash: "MOCKESCROWHASH" });
    const { mockCreateEscrow } = require("@/lib/contractMock");
    expect(mockCreateEscrow).toHaveBeenCalledWith({
      jobId: "job-77",
      client: CLIENT,
      freelancer: CLIENT,
      token: "native",
      amount: "125000000",
    });
  });

  it("buildReleaseEscrowTransaction returns the mock prepared XDR", async () => {
    const prepared = await stellarLib.buildReleaseEscrowTransaction(
      TEST_CONTRACT_ID,
      "job-1",
      CLIENT,
    );
    expect(prepared.toXDR()).toBe("mock-prepared-xdr");
  });

  it("buildMintCertificateTx returns the mock prepared XDR", async () => {
    const prepared = await stellarLib.buildMintCertificateTx(
      TEST_CONTRACT_ID,
      "job-1",
      "Title",
      CLIENT,
    );
    expect(prepared.toXDR()).toBe("mock-prepared-xdr");
  });

  it("submitSignedSorobanTransaction returns the mock hash", async () => {
    await expect(
      stellarLib.submitSignedSorobanTransaction("XDR"),
    ).resolves.toEqual({ hash: "mock-release-hash" });
  });

  it("contract views resolve to null in mock mode", async () => {
    await expect(
      stellarLib.getEscrowState(TEST_CONTRACT_ID, "job-1"),
    ).resolves.toBeNull();
    await expect(
      stellarLib.getMilestoneOnChain(TEST_CONTRACT_ID, "job-1", 0),
    ).resolves.toBeNull();
    await expect(
      stellarLib.isContractFrozen(TEST_CONTRACT_ID),
    ).resolves.toBeNull();
  });
});

describe("escrow-related guards on the default instance", () => {
  it("buildCreateEscrowTx throws when CONTRACT_ID is not configured", async () => {
    await expect(
      stellarLib.buildCreateEscrowTx({
        clientPublicKey: CLIENT,
        jobId: "job-1",
        budgetXlm: 1,
      }),
    ).rejects.toThrow(
      "NEXT_PUBLIC_CONTRACT_ID is not set. Add it to your .env.local file.",
    );
  });

  it("buildPublishMessageTx throws when CONTRACT_ID is not configured", async () => {
    await expect(
      stellarLib.buildPublishMessageTx({
        jobId: "job-1",
        senderPublicKey: CLIENT,
        recipientPublicKey: RECIPIENT,
        ipfsCid: "cid",
      }),
    ).rejects.toThrow(
      "NEXT_PUBLIC_CONTRACT_ID is not set. Add it to your .env.local file.",
    );
  });
});

describe("classic transaction XDR assembly", () => {
  beforeEach(() => {
    stubAccountAndSim(stellarLib);
  });

  it("builds an XLM payment with the right operation", async () => {
    const tx = await stellarLib.buildPaymentTransaction({
      fromPublicKey: CLIENT,
      toPublicKey: RECIPIENT,
      amount: "25.5",
    });
    const op = tx.operations[0] as any;
    expect(op.type).toBe("payment");
    expect(op.destination).toBe(RECIPIENT);
    expect(op.asset.isNative()).toBe(true);
    expect(op.amount).toBe("25.5000000");
    expect(tx.source).toBe(CLIENT);
    expect(tx.fee).toBe(BASE_FEE);
  });

  it("builds a USDC payment when asset is USDC", async () => {
    const tx = await stellarLib.buildPaymentTransaction({
      fromPublicKey: CLIENT,
      toPublicKey: RECIPIENT,
      amount: "10",
      asset: "USDC",
    });
    const op = tx.operations[0] as any;
    expect(op.asset.code).toBe("USDC");
    expect(op.asset.issuer).toBe(stellarLib.USDC_ISSUER);
  });

  it("attaches a memo when one is provided", async () => {
    const tx = await stellarLib.buildPaymentTransaction({
      fromPublicKey: CLIENT,
      toPublicKey: RECIPIENT,
      amount: "1",
      memo: "invoice-42",
    });
    expect(tx.memo.type).toBe("text");
    expect(String(tx.memo.value)).toBe("invoice-42");
  });

  it("builds the auto-convert path payment (XLM → USDC)", async () => {
    const tx = await stellarLib.buildAutoConvertPathPayment({
      fromPublicKey: CLIENT,
      sourceAmountXlm: "5",
      destMinUsdc: "0.5",
      path: [
        { type: "native" },
        { type: "credit_alphanum12", code: "USDC", issuer: stellarLib.USDC_ISSUER },
      ],
    });
    const op = tx.operations[0] as any;
    expect(op.type).toBe("pathPaymentStrictSend");
    expect(op.sendAsset.isNative()).toBe(true);
    expect(op.sendAmount).toBe("5.0000000");
    expect(op.destination).toBe(CLIENT);
    expect(op.destAsset.code).toBe("USDC");
    expect(op.destMin).toBe("0.5000000");
    expect(op.path).toHaveLength(2);
    expect(op.path[0].isNative()).toBe(true);
    expect(op.path[1].code).toBe("USDC");
  });

  it("builds the boost payment with a truncated memo", async () => {
    const longJobId = "job-with-a-really-long-identifier-12345";
    jest
      .spyOn(stellarLib.server, "loadAccount")
      .mockResolvedValue(new Account(CLIENT, "7") as never);
    const simulate = jest.spyOn(stellarLib.sorobanServer, "simulateTransaction");

    const promise = stellarLib.buildBoostJobTx({
      jobId: longJobId,
      clientPublicKey: CLIENT,
      amountXlm: 3,
      treasuryAddress: RECIPIENT,
    });

    await expect(promise).rejects.toThrow(/unsupported transaction/);
    expect(simulate).toHaveBeenCalledTimes(1);

    const built = simulate.mock.calls[0][0] as Transaction;
    const op = built.operations[0] as any;
    expect(op.type).toBe("payment");
    expect(op.destination).toBe(RECIPIENT);
    expect(op.amount).toBe("3.0000000");
    expect(built.memo.type).toBe("text");
    expect(String(built.memo.value)).toBe(longJobId.slice(0, 28));
  });

  it("boost payment surfaces Soroban simulation errors", async () => {
    jest
      .spyOn(stellarLib.server, "loadAccount")
      .mockResolvedValue(new Account(CLIENT, "7") as never);
    jest
      .spyOn(stellarLib.sorobanServer, "simulateTransaction")
      .mockResolvedValue(makeErrorSim("boom") as never);

    await expect(
      stellarLib.buildBoostJobTx({
        jobId: "job-1",
        clientPublicKey: CLIENT,
        amountXlm: 1,
        treasuryAddress: RECIPIENT,
      }),
    ).rejects.toThrow(/^Soroban simulation failed: /);
  });
});

describe("submitTransaction result codes", () => {
  function signedXdr(): string {
    const account = new Account(CLIENT, "100");
    return new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: RECIPIENT,
          asset: Asset.native(),
          amount: "1",
        }),
      )
      .setTimeout(300)
      .build()
      .toXDR();
  }

  it("returns the hash for a successful submission", async () => {
    jest.spyOn(stellarLib.server, "submitTransaction").mockResolvedValue({
      successful: true,
      hash: "abcd",
      ledger: 100,
      result_xdr: "AAA",
    } as never);

    await expect(stellarLib.submitTransaction(signedXdr())).resolves.toEqual({
      hash: "abcd",
      successful: true,
      ledger: 100,
      resultXdr: "AAA",
    });
  });

  it("explains an underfunded payment", async () => {
    jest.spyOn(stellarLib.server, "submitTransaction").mockResolvedValue({
      successful: false,
      extras: { result_codes: { operations: ["op_underfunded"] } },
    } as never);

    await expect(stellarLib.submitTransaction(signedXdr())).rejects.toThrow(
      "Insufficient XLM balance.",
    );
  });

  it("explains a bad signature", async () => {
    jest.spyOn(stellarLib.server, "submitTransaction").mockResolvedValue({
      successful: false,
      extras: { result_codes: { transaction: "tx_too_few_signers" } },
    } as never);

    await expect(stellarLib.submitTransaction(signedXdr())).rejects.toThrow(
      "Transaction was not signed correctly.",
    );
  });

  it("explains a missing destination account", async () => {
    jest.spyOn(stellarLib.server, "submitTransaction").mockResolvedValue({
      successful: false,
      extras: { result_codes: { operations: ["op_no_destination"] } },
    } as never);

    await expect(stellarLib.submitTransaction(signedXdr())).rejects.toThrow(
      "Destination account does not exist.",
    );
  });

  it("explains a missing source account", async () => {
    jest.spyOn(stellarLib.server, "submitTransaction").mockResolvedValue({
      successful: false,
      extras: { result_codes: { operations: ["op_src_not_found"] } },
    } as never);

    await expect(stellarLib.submitTransaction(signedXdr())).rejects.toThrow(
      "Source account not found.",
    );
  });

  it("falls back to a generic failure message", async () => {
    jest.spyOn(stellarLib.server, "submitTransaction").mockResolvedValue({
      successful: false,
      extras: { result_codes: { transaction: "tx_bad_seq" } },
    } as never);

    await expect(stellarLib.submitTransaction(signedXdr())).rejects.toThrow(
      "Payment transaction failed.",
    );
  });
});

describe("balance & account helpers (fetch)", () => {
  it("getXLMBalance returns the native balance", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ balances: [{ asset_type: "native", balance: "42.5" }] }),
    );
    await expect(stellarLib.getXLMBalance(CLIENT)).resolves.toBe("42.5");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/accounts/${CLIENT}`),
    );
  });

  it("getXLMBalance returns 0 on HTTP error or thrown error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(stellarLib.getXLMBalance(CLIENT)).resolves.toBe("0");

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(stellarLib.getXLMBalance(CLIENT)).resolves.toBe("0");
  });

  it("getUSDCBalance matches the configured issuer only", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        balances: [
          { asset_type: "native", balance: "1" },
          {
            asset_code: "USDC",
            asset_issuer: stellarLib.USDC_ISSUER,
            balance: "9.25",
          },
        ],
      }),
    );
    await expect(stellarLib.getUSDCBalance(CLIENT)).resolves.toBe("9.25");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        balances: [
          { asset_code: "USDC", asset_issuer: "GOTHER", balance: "5" },
        ],
      }),
    );
    await expect(stellarLib.getUSDCBalance(CLIENT)).resolves.toBe("0");
  });

  it("checkDestinationAccount reports existence and balances", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ balances: [{ asset_type: "native", balance: "10" }], minimum_balance: 10000000 }),
    );
    await expect(stellarLib.checkDestinationAccount(RECIPIENT)).resolves.toEqual({
      exists: true,
      xlmBalance: "10",
      minBalanceXlm: "1.0000000",
    });
  });

  it("checkDestinationAccount reports a 404 as missing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(stellarLib.checkDestinationAccount(RECIPIENT)).resolves.toEqual({
      exists: false,
    });
  });

  it("checkDestinationAccount reports network errors as missing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(stellarLib.checkDestinationAccount(RECIPIENT)).resolves.toEqual({
      exists: false,
    });
  });

  it("verifyFreelancerAccount resolves on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(stellarLib.verifyFreelancerAccount(RECIPIENT)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/escrow/verify-freelancer"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("verifyFreelancerAccount surfaces the 400 backend message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Account does not exist" }, 400),
    );
    await expect(stellarLib.verifyFreelancerAccount(RECIPIENT)).rejects.toThrow(
      "Account does not exist",
    );
  });

  it("verifyFreelancerAccount falls back to the funding hint on 400", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 400));
    await expect(stellarLib.verifyFreelancerAccount(RECIPIENT)).rejects.toThrow(
      "Fund your wallet with at least 1 XLM to activate your account",
    );
  });

  it("verifyFreelancerAccount reports other failures", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(stellarLib.verifyFreelancerAccount(RECIPIENT)).rejects.toThrow(
      "Failed to verify freelancer account",
    );
  });

  it("fetchMarketPayTransactions maps records and passes cursor/limit", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        _embedded: {
          records: [
            { id: "1", transaction_hash: "h1", ledger: 5, created_at: "now", successful: true },
          ],
        },
        _links: { next: { href: "next" } },
      }),
    );
    const result = await stellarLib.fetchMarketPayTransactions(CLIENT, 5, "9");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`?cursor=9&limit=5`),
    );
    expect(result.hasMore).toBe(true);
    expect(result.transactions[0]).toMatchObject({ hash: "h1", successful: true });
  });

  it("fetchMarketPayTransactions returns empty on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(
      stellarLib.fetchMarketPayTransactions(CLIENT),
    ).resolves.toEqual({ transactions: [], hasMore: false });
  });
});

describe("streamAccountTransactions", () => {
  it("forwards Horizon stream messages and returns a closer", () => {
    const close = jest.fn();
    const stream = jest.fn((handlers: any) => {
      handlers.onmessage({ id: "tx-stream-1" });
      return close;
    });
    jest.spyOn(stellarLib.server, "transactions").mockReturnValue({
      forAccount: () => ({ cursor: () => ({ stream }) }),
    } as never);
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    const onTransaction = jest.fn();
    const stop = stellarLib.streamAccountTransactions(CLIENT, onTransaction);

    expect(onTransaction).toHaveBeenCalledWith({ id: "tx-stream-1" });
    stop();
    expect(close).toHaveBeenCalled();

    // onerror logs instead of throwing
    const handlers = stream.mock.calls[0][0] as any;
    handlers.onerror(new Error("stream broke"));
    expect(consoleError).toHaveBeenCalledWith(
      "Horizon transaction stream error",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});

// ===========================================================================
// Configured instance: CONTRACT_ID set, contract mock disabled
// ===========================================================================

describe("contract XDR assembly (NEXT_PUBLIC_CONTRACT_ID configured)", () => {
  let configured: typeof import("@/lib/stellar");
  let sdk: typeof import("@stellar/stellar-sdk");

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_CONTRACT_ID = TEST_CONTRACT_ID;
    delete process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK;
    jest.resetModules();
    configured = require("@/lib/stellar");
    sdk = require("@stellar/stellar-sdk");
  });

  afterAll(() => {
    if (originalEnv.CONTRACT_ID === undefined) {
      delete process.env.NEXT_PUBLIC_CONTRACT_ID;
    } else {
      process.env.NEXT_PUBLIC_CONTRACT_ID = originalEnv.CONTRACT_ID;
    }
    process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK = originalEnv.MOCK ?? "true";
    jest.resetModules();
  });

  beforeEach(() => {
    stubAccountAndSim(configured);
  });

  it("buildCreateEscrowTx assembles the create_escrow invocation", async () => {
    const xdr = await configured.buildCreateEscrowTx({
      clientPublicKey: CLIENT,
      jobId: "job-42",
      budgetXlm: 5,
    });

    const tx = new sdk.Transaction(xdr, configured.NETWORK_PASSPHRASE);
    expect(tx.source).toBe(CLIENT);
    expect(tx.sequence).toBe("4243");
    // 220 (offline gas fallback: 200 * 1.1) + 5000 minResourceFee
    expect(tx.fee).toBe("5220");

    const { fn, contractAddress, args } = decodeInvoke(sdk, tx);
    expect(fn).toBe("create_escrow");
    expect(contractAddress).toBe(TEST_CONTRACT_ID);
    expect(args).toHaveLength(3);
    expect(scvString(args[0])).toBe("job-42");
    expect(scvAddress(sdk, args[1])).toBe(CLIENT);
    expect(scvI128Equals(args[2], BigInt(50_000_000))).toBe(true);
    expect(configured.sorobanServer.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("prefers params.budget over params.budgetXlm", async () => {
    const xdr = await configured.buildCreateEscrowTx({
      clientPublicKey: CLIENT,
      jobId: "job-43",
      budget: 3,
      budgetXlm: 9,
    });
    const { args } = decodeInvoke(sdk, new sdk.Transaction(xdr, configured.NETWORK_PASSPHRASE));
    expect(scvI128Equals(args[2], BigInt(30_000_000))).toBe(true);
  });

  it("throws when simulation fails", async () => {
    jest
      .spyOn(configured.sorobanServer, "simulateTransaction")
      .mockResolvedValue(makeErrorSim("contract exploded") as never);

    await expect(
      configured.buildCreateEscrowTx({
        clientPublicKey: CLIENT,
        jobId: "job-44",
        budgetXlm: 1,
      }),
    ).rejects.toThrow(/^Soroban simulation failed: /);
  });

  it("buildPublishMessageTx assembles the publish_message invocation", async () => {
    const xdr = await configured.buildPublishMessageTx({
      jobId: "job-9",
      senderPublicKey: CLIENT,
      recipientPublicKey: RECIPIENT,
      ipfsCid: "bafy-cid",
    });

    const tx = new sdk.Transaction(xdr, configured.NETWORK_PASSPHRASE);
    const { fn, contractAddress, args } = decodeInvoke(sdk, tx);
    expect(fn).toBe("publish_message");
    expect(contractAddress).toBe(TEST_CONTRACT_ID);
    expect(scvString(args[0])).toBe("job-9");
    expect(scvAddress(sdk, args[1])).toBe(CLIENT);
    expect(scvAddress(sdk, args[2])).toBe(RECIPIENT);
    expect(scvString(args[3])).toBe("bafy-cid");
  });

  it("buildReleaseEscrowTransaction assembles the release_escrow invocation", async () => {
    const prepared = await configured.buildReleaseEscrowTransaction(
      TEST_CONTRACT_ID,
      "job-5",
      CLIENT,
    );
    expect(prepared).toBeInstanceOf(sdk.Transaction);
    const { fn, contractAddress, args } = decodeInvoke(sdk, prepared);
    expect(fn).toBe("release_escrow");
    expect(contractAddress).toBe(TEST_CONTRACT_ID);
    expect(scvString(args[0])).toBe("job-5");
    expect(scvAddress(sdk, args[1])).toBe(CLIENT);
    // BASE_FEE + minResourceFee
    expect(prepared.fee).toBe(String(100 + 5000));
  });

  it("buildReleaseEscrowTransaction throws when simulation fails", async () => {
    jest
      .spyOn(configured.sorobanServer, "simulateTransaction")
      .mockResolvedValue(makeErrorSim() as never);
    await expect(
      configured.buildReleaseEscrowTransaction(TEST_CONTRACT_ID, "job-5", CLIENT),
    ).rejects.toThrow(/^Simulation failed: /);
  });

  it("buildPartialReleaseTransaction assembles the partial_release invocation", async () => {
    const prepared = await configured.buildPartialReleaseTransaction(
      TEST_CONTRACT_ID,
      "job-6",
      CLIENT,
      2,
    );
    const { fn, args } = decodeInvoke(sdk, prepared);
    expect(fn).toBe("partial_release");
    expect(scvString(args[0])).toBe("job-6");
    expect(args[1].switch().name).toBe("scvU32");
    expect(args[1].value()).toBe(2);
    expect(scvAddress(sdk, args[2])).toBe(CLIENT);
  });

  it("buildMintCertificateTx assembles the mint_certificate invocation", async () => {
    const prepared = await configured.buildMintCertificateTx(
      TEST_CONTRACT_ID,
      "job-7",
      "Frontend wizard",
      CLIENT,
    );
    const { fn, contractAddress, args } = decodeInvoke(sdk, prepared);
    expect(fn).toBe("mint_certificate");
    expect(contractAddress).toBe(TEST_CONTRACT_ID);
    expect(scvString(args[0])).toBe("job-7");
    expect(scvString(args[1])).toBe("Frontend wizard");
    expect(scvAddress(sdk, args[2])).toBe(CLIENT);
  });

  it("createEscrowOnChain runs build → sign → submit end to end", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockImplementation(async (xdr: string) => xdr);
    jest
      .spyOn(configured.sorobanServer, "sendTransaction")
      .mockResolvedValue({ status: "PENDING", hash: "CHAINHASH" } as never);
    jest
      .spyOn(configured.sorobanServer, "getTransaction")
      .mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      } as never);

    const result = await configured.createEscrowOnChain({
      clientPublicKey: CLIENT,
      jobId: "job-45",
      budgetXlm: 2,
    });
    expect(result).toEqual({ txHash: "CHAINHASH" });
    expect(freighter().signTransaction).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ networkPassphrase: configured.NETWORK_PASSPHRASE }),
    );
  });

  it("publishMessageOnChain runs build → sign → submit end to end", async () => {
    freighter().isConnected.mockResolvedValue(true);
    freighter().signTransaction.mockImplementation(async (xdr: string) => xdr);
    jest
      .spyOn(configured.sorobanServer, "sendTransaction")
      .mockResolvedValue({ status: "PENDING", hash: "MSGHASH" } as never);
    jest
      .spyOn(configured.sorobanServer, "getTransaction")
      .mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      } as never);

    const hash = await configured.publishMessageOnChain({
      jobId: "job-10",
      senderPublicKey: CLIENT,
      recipientPublicKey: RECIPIENT,
      ipfsCid: "cid-1",
    });
    expect(hash).toBe("MSGHASH");
  });
});

// ===========================================================================
// Mainnet instance: NEXT_PUBLIC_STELLAR_NETWORK=mainnet
// ===========================================================================

describe("mainnet network selection (NEXT_PUBLIC_STELLAR_NETWORK)", () => {
  let mainnet: typeof import("@/lib/stellar");

  beforeAll(() => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = "mainnet";
    jest.resetModules();
    mainnet = require("@/lib/stellar");
  });

  afterAll(() => {
    if (originalEnv.NETWORK === undefined) {
      delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    } else {
      process.env.NEXT_PUBLIC_STELLAR_NETWORK = originalEnv.NETWORK;
    }
    jest.resetModules();
  });

  it("uses the Public network passphrase", () => {
    expect(mainnet.NETWORK_PASSPHRASE).toBe(Networks.PUBLIC);
  });

  it("uses the mainnet USDC issuer", () => {
    expect(mainnet.USDC_ISSUER).toBe(
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    );
  });

  it("builds mainnet explorer URLs", () => {
    expect(mainnet.explorerUrl("deadbeef")).toBe(
      "https://stellar.expert/explorer/public/tx/deadbeef",
    );
  });

  it("passes the Public passphrase to the wallet when signing", async () => {
    const f = freighter();
    f.isConnected.mockResolvedValue(true);
    f.signTransaction.mockResolvedValue("SIGNED");

    const result = await mainnet.signTransactionWithWallet("XDR");

    expect(result).toEqual({ signedXDR: "SIGNED", error: null });
    expect(f.signTransaction).toHaveBeenCalledWith(
      "XDR",
      expect.objectContaining({ networkPassphrase: Networks.PUBLIC }),
    );
  });
});
