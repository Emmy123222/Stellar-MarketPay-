import {
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  nativeToScVal,
  xdr,
  Horizon,
  Operation,
  Asset,
  Transaction,
} from "@stellar/stellar-sdk";
import * as SorobanRpc from "@stellar/stellar-sdk/rpc";
import { optionalClientEnv, requireClientEnv } from "./env";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NETWORK_NAME = optionalClientEnv("NEXT_PUBLIC_STELLAR_NETWORK", "testnet").toLowerCase();
if (NETWORK_NAME !== "testnet" && NETWORK_NAME !== "mainnet") {
  throw new Error("NEXT_PUBLIC_STELLAR_NETWORK must be either testnet or mainnet.");
}

export const NETWORK_PASSPHRASE = NETWORK_NAME === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
const HORIZON_URL = optionalClientEnv(
  "NEXT_PUBLIC_HORIZON_URL",
  NETWORK_NAME === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org",
);
const SOROBAN_RPC_URL = optionalClientEnv(
  "NEXT_PUBLIC_SOROBAN_RPC_URL",
  NETWORK_NAME === "mainnet"
    ? "https://soroban-mainnet.stellar.org"
    : "https://soroban-testnet.stellar.org",
);
const USE_CONTRACT_MOCK =
  process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true";

const CONTRACT_ID = USE_CONTRACT_MOCK
  ? ""
  : requireClientEnv("NEXT_PUBLIC_CONTRACT_ID");

export const server = new Horizon.Server(HORIZON_URL, { allowHttp: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EscrowParams {
  clientPublicKey: string;
  jobId: string;
  budgetXlm: number;
}

export interface EscrowResult {
  txHash: string;
}

export interface MarketPayTransaction {
  id: string;
  hash: string;
  ledger: number;
  created_at: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
  memo?: string;
  memo_type?: string;
  successful: boolean;
  marketPayType?: "escrow" | "payment" | "refund" | "other";
}

export interface FetchTransactionsResponse {
  transactions: MarketPayTransaction[];
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Freighter helpers (browser-only)
// ---------------------------------------------------------------------------

async function getFreighter() {
  if (typeof window === "undefined") {
    throw new Error("Freighter is only available in the browser.");
  }
  const { isConnected, getPublicKey, signTransaction } =
    await import("@stellar/freighter-api");

  const connected = await isConnected();
  if (!connected) {
    throw new Error(
      "Freighter wallet not found. Please install the Freighter extension.",
    );
  }
  return { getPublicKey, signTransaction };
}

// ---------------------------------------------------------------------------
// Core: build the Soroban create_escrow transaction
// ---------------------------------------------------------------------------

export async function buildCreateEscrowTx(
  params: EscrowParams,
): Promise<string> {
  const { clientPublicKey, jobId, budgetXlm } = params;

  if (!CONTRACT_ID) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_ID is not set. Add it to your .env.local file.",
    );
  }

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  const account = await server.getAccount(clientPublicKey);

  const amountStroops = BigInt(Math.round(budgetXlm * 10_000_000));

  const contract = new Contract(CONTRACT_ID);
  const callArgs = [
    nativeToScVal(jobId, { type: "string" }),
    Address.fromString(clientPublicKey).toScVal(),
    nativeToScVal(amountStroops, { type: "i128" }),
  ];

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("create_escrow", ...callArgs))
    .setTimeout(300)
    .build();

  const simResponse = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Soroban simulation failed: ${simResponse.error}`);
  }

  const assembledTx = SorobanRpc.assembleTransaction(tx, simResponse).build();

  return assembledTx.toXDR();
}

// ---------------------------------------------------------------------------
// Core: sign with Freighter and submit
// ---------------------------------------------------------------------------

export async function signAndSubmitEscrowTx(
  preparedXdr: string,
): Promise<EscrowResult> {
  const { signTransaction } = await getFreighter();

  const signedTransaction = await signTransaction(preparedXdr, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  const sendResponse = await server.sendTransaction(
    (() => {
      const { Transaction } = require("@stellar/stellar-sdk");
      return new Transaction(signedTransaction, NETWORK_PASSPHRASE);
    })(),
  );

  if (sendResponse.status === "ERROR") {
    const resultXdr = sendResponse.errorResult?.toXDR("base64") ?? "unknown";
    throw new Error(`Transaction submission failed. Result XDR: ${resultXdr}`);
  }

  const txHash = sendResponse.hash;

  let getResponse = await server.getTransaction(txHash);
  const MAX_POLLS = 20;
  let polls = 0;

  while (
    getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    polls < MAX_POLLS
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    getResponse = await server.getTransaction(txHash);
    polls++;
  }

  if (getResponse.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `Transaction did not succeed. Status: ${getResponse.status}`,
    );
  }

  return { txHash };
}

// ---------------------------------------------------------------------------
// Convenience: build → sign → submit in one call
// ---------------------------------------------------------------------------

export async function createEscrowOnChain(
  params: EscrowParams,
): Promise<EscrowResult> {
  if (USE_CONTRACT_MOCK) {
    const { mockCreateEscrow } = await import("./contractMock");
    const txHash = await mockCreateEscrow({
      jobId: params.jobId,
      client: params.clientPublicKey,
      freelancer: params.clientPublicKey,
      token: "native",
      amount: String(BigInt(Math.round(params.budgetXlm * 10_000_000))),
    });
    return { txHash };
  }

  const preparedXdr = await buildCreateEscrowTx(params);
  return signAndSubmitEscrowTx(preparedXdr);
}

// ---------------------------------------------------------------------------
// On-chain Message Notarization
// ---------------------------------------------------------------------------

export interface MessageTxParams {
  jobId: string;
  senderPublicKey: string;
  recipientPublicKey: string;
  ipfsCid: string;
}

export async function buildPublishMessageTx(
  params: MessageTxParams,
): Promise<string> {
  if (!CONTRACT_ID) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_ID is not set. Add it to your .env.local file.",
    );
  }

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  const { jobId, senderPublicKey, recipientPublicKey, ipfsCid } = params;
  const account = await server.getAccount(senderPublicKey);

  const contract = new Contract(CONTRACT_ID);
  const callArgs = [
    nativeToScVal(jobId, { type: "string" }),
    Address.fromString(senderPublicKey).toScVal(),
    Address.fromString(recipientPublicKey).toScVal(),
    nativeToScVal(ipfsCid, { type: "string" }),
  ];

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("publish_message", ...callArgs))
    .setTimeout(300)
    .build();

  const simResponse = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Soroban simulation failed: ${simResponse.error}`);
  }

  const assembledTx = SorobanRpc.assembleTransaction(tx, simResponse).build();
  return assembledTx.toXDR();
}

async function signAndSubmitToSoroban(
  preparedXdr: string,
): Promise<string> {
  const { signTransaction } = await getFreighter();

  const signedTransaction = await signTransaction(preparedXdr, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  const sendResponse = await server.sendTransaction(
    (() => {
      const { Transaction } = require("@stellar/stellar-sdk");
      return new Transaction(signedTransaction, NETWORK_PASSPHRASE);
    })(),
  );

  if (sendResponse.status === "ERROR") {
    const resultXdr = sendResponse.errorResult?.toXDR("base64") ?? "unknown";
    throw new Error(`Transaction submission failed. Result XDR: ${resultXdr}`);
  }

  const txHash = sendResponse.hash;

  let getResponse = await server.getTransaction(txHash);
  const MAX_POLLS = 20;
  let polls = 0;

  while (
    getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    polls < MAX_POLLS
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    getResponse = await server.getTransaction(txHash);
    polls++;
  }

  if (getResponse.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `Transaction did not succeed. Status: ${getResponse.status}`,
    );
  }

  return txHash;
}

export async function publishMessageOnChain(
  params: MessageTxParams,
): Promise<string> {
  const preparedXdr = await buildPublishMessageTx(params);
  return signAndSubmitToSoroban(preparedXdr);
}

// ---------------------------------------------------------------------------
// Shared Soroban RPC server instance (used by sorobanFees.ts)
// ---------------------------------------------------------------------------

export const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL, {
  allowHttp: false,
});

// ---------------------------------------------------------------------------
// XLM balance helper
// ---------------------------------------------------------------------------

export async function getXLMBalance(publicKey: string): Promise<string> {
  try {
    const res = await fetch(
      `${HORIZON_URL}/accounts/${encodeURIComponent(publicKey)}`
    );
    if (!res.ok) return "0";
    const data = await res.json();
    const native = (data.balances ?? []).find(
      (b: { asset_type: string; balance: string }) => b.asset_type === "native"
    );
    return native?.balance ?? "0";
  } catch {
    return "0";
  }
}

// ---------------------------------------------------------------------------
// Build a boost_job Soroban transaction (Issue #344)
// ---------------------------------------------------------------------------

export interface BoostParams {
  clientPublicKey: string;
  jobId: string;
  amountXlm: number;
  treasuryAddress: string;
}

export async function buildBoostJobTx(params: BoostParams): Promise<string> {
  const { clientPublicKey, jobId, amountXlm, treasuryAddress } = params;

  if (!CONTRACT_ID) {
    throw new Error("NEXT_PUBLIC_CONTRACT_ID is not set.");
  }

  const server = sorobanServer;
  const account = await server.getAccount(clientPublicKey);
  const amountStroops = BigInt(Math.round(amountXlm * 10_000_000));

  const contract = new Contract(CONTRACT_ID);
  const callArgs = [
    nativeToScVal(jobId, { type: "string" }),
    Address.fromString(clientPublicKey).toScVal(),
    Address.fromString(treasuryAddress).toScVal(),
    nativeToScVal(amountStroops, { type: "i128" }),
  ];

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("boost_job", ...callArgs))
    .setTimeout(300)
    .build();

  const simResponse = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Soroban simulation failed: ${simResponse.error}`);
  }

  return SorobanRpc.assembleTransaction(tx, simResponse).build().toXDR();
}

// ---------------------------------------------------------------------------
// Build + sign + submit helpers for generic Soroban transactions
// ---------------------------------------------------------------------------

export async function signAndSubmitSorobanTx(xdrString: string): Promise<string> {
  const { signTransaction } = await getFreighter();

  const signedTransaction = await signTransaction(xdrString, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const server = sorobanServer;
  const { Transaction } = await import("@stellar/stellar-sdk");
  const sendResponse = await server.sendTransaction(
    new Transaction(signedTransaction, NETWORK_PASSPHRASE)
  );

  if (sendResponse.status === "ERROR") {
    throw new Error(
      `Transaction submission failed: ${sendResponse.errorResult?.toXDR("base64") ?? "unknown"}`
    );
  }

  const txHash = sendResponse.hash;
  let getResponse = await server.getTransaction(txHash);
  let polls = 0;

  while (
    getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    polls < 20
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    getResponse = await server.getTransaction(txHash);
    polls++;
  }

  if (getResponse.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction did not succeed. Status: ${getResponse.status}`);
  }

  return txHash;
}

// ---------------------------------------------------------------------------
// Release escrow helpers (used by jobs/[id].tsx)
// ---------------------------------------------------------------------------

export async function buildReleaseEscrowTransaction(
  contractId: string,
  jobId: string,
  clientPublicKey: string
) {
  const server = sorobanServer;
  const account = await server.getAccount(clientPublicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "release_escrow",
        nativeToScVal(jobId, { type: "string" }),
        Address.fromString(clientPublicKey).toScVal()
      )
    )
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build();
}

export async function buildPartialReleaseTransaction(
  contractId: string,
  jobId: string,
  clientPublicKey: string,
  milestoneIndex: number
) {
  const server = sorobanServer;
  const account = await server.getAccount(clientPublicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "partial_release",
        nativeToScVal(jobId, { type: "string" }),
        nativeToScVal(milestoneIndex, { type: "u32" }),
        Address.fromString(clientPublicKey).toScVal()
      )
    )
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build();
}

export async function submitSignedSorobanTransaction(
  signedXDR: string
): Promise<{ hash: string }> {
  const hash = await signAndSubmitSorobanTx(signedXDR);
  return { hash };
}

export async function getEscrowState(contractId: string, jobId: string) {
  const server = sorobanServer;
  const contract = new Contract(contractId);
  const account = await server.getAccount(contractId).catch(() => null);
  if (!account) return null;
  return null;
}

export async function subscribeToContractEvents(
  contractId: string,
  onEvent: (event: unknown) => void
) {
  return () => {};
}

export const XLM_SAC_ADDRESS = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const USDC_SAC_ADDRESS = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export function accountUrl(publicKey: string): string {
  return `https://stellar.expert/explorer/testnet/account/${publicKey}`;
}

export function isValidStellarAddress(address: string): boolean {
  try {
    Address.fromString(address);
    return true;
  } catch {
    return false;
  }
}

export function explorerUrl(txHash: string): string {
  const explorer = NETWORK_NAME === "mainnet"
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet";
  return `${explorer}/tx/${txHash}`;
}

export async function buildPaymentTransaction(params: {
  fromPublicKey: string;
  toPublicKey: string;
  amount: string;
  memo?: string;
  asset?: string;
}) {
  const server = sorobanServer;
  const account = await server.getAccount(params.fromPublicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: params.toPublicKey,
        asset: Asset.native(),
        amount: params.amount,
      })
    )
    .setTimeout(300)
    .build();

  return tx;
}

export async function submitTransaction(_xdr: string): Promise<string> {
  throw new Error("Transaction submission not yet implemented");
}

export async function fetchMarketPayTransactions(
  _publicKey: string,
  _limit?: number,
  _cursor?: string,
): Promise<{ transactions: MarketPayTransaction[]; hasMore: boolean }> {
  return { transactions: [], hasMore: false };
}

export async function signTransactionWithWallet(
  xdrString: string
): Promise<{ signedXDR: string | null; error: string | null }> {
  try {
    const { signTransaction } = await getFreighter();
    const signedTransaction = await signTransaction(xdrString, {
      network: "TESTNET",
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    return { signedXDR: signedTransaction, error: null };
  } catch (e) {
    return { signedXDR: null, error: e instanceof Error ? e.message : "Signing failed" };
  }
}
