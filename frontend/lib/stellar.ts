import {
  Horizon, Networks, Asset, Operation, TransactionBuilder, Transaction,
  Contract, nativeToScVal, Address, BASE_FEE, Memo,
} from "@stellar/stellar-sdk";
import { SorobanRpc } from "@stellar/stellar-sdk";
import { fetchGasEstimateSafe, tierToTransactionFee } from "./sorobanFees";

const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as "testnet" | "mainnet";
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
  (NETWORK === "mainnet"
    ? "https://soroban-mainnet.stellar.org"
    : "https://soroban-testnet.stellar.org");
const USE_CONTRACT_MOCK =
  process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "";
const NETWORK_NAME = NETWORK;

export const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
export const server = new Horizon.Server(HORIZON_URL, {
  allowHttp: SOROBAN_RPC_URL.startsWith("http://"),
});
export const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL, {
  allowHttp: SOROBAN_RPC_URL.startsWith("http://"),
});

// USDC asset issued by Circle
export const USDC_ISSUER =
  NETWORK === "mainnet"
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const USDC = new Asset("USDC", USDC_ISSUER);

export interface EscrowParams {
  clientPublicKey: string;
  jobId: string;
  budget?: number;
  budgetXlm?: number;
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

export type StreamedTransaction = { id: string };

export function streamAccountTransactions(
  publicKey: string,
  onTransaction: (transaction: StreamedTransaction) => void
): () => void {
  const closeStream = server
    .transactions()
    .forAccount(publicKey)
    .cursor("now")
    .stream({
      onmessage: (transaction) => {
        onTransaction(transaction as unknown as StreamedTransaction);
      },
      onerror: (error: unknown) => {
        console.error("Horizon transaction stream error", error);
      },
    });

  return () => {
    closeStream();
  };
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function buildCreateEscrowTx(
  params: EscrowParams,
): Promise<string> {
  const { clientPublicKey, jobId } = params;
  const budgetXlm = params.budget ?? params.budgetXlm ?? 0;

  if (!CONTRACT_ID) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_ID is not set. Add it to your .env.local file.",
    );
  }

  // Fetch the source account and dynamic fee estimate in parallel
  const [account, gasEstimate] = await Promise.all([
    sorobanServer.getAccount(clientPublicKey),
    fetchGasEstimateSafe(),
  ]);

  // Use the "medium" tier as the default inclusion fee for escrow creation
  const inclusionFee = tierToTransactionFee(gasEstimate.medium);

  const amountStroops = BigInt(Math.round(budgetXlm * 10_000_000));

  const contract = new Contract(CONTRACT_ID);
  const callArgs = [
    nativeToScVal(jobId, { type: "string" }),
    Address.fromString(clientPublicKey).toScVal(),
    nativeToScVal(amountStroops, { type: "i128" }),
  ];

  const tx = new TransactionBuilder(account, {
    fee: inclusionFee,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("create_escrow", ...callArgs))
    .setTimeout(300)
    .build();

  // Simulate to populate the soroban data / auth entries
  const simResponse = await sorobanServer.simulateTransaction(tx);

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

  // Ask the user to sign
  const signResult = await signTransaction(preparedXdr, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const signedTransaction =
    typeof signResult === "object" && signResult !== null && "signedTransaction" in signResult
      ? (signResult as unknown as { signedTransaction: string }).signedTransaction
      : signResult as unknown as string;

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  // Submit the signed transaction
  const sendResponse = await sorobanServer.sendTransaction(
    // Re-parse from the signed XDR
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

  // Poll for confirmation
  let getResponse = await sorobanServer.getTransaction(txHash);
  const MAX_POLLS = 20;
  let polls = 0;

  while (
    getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    polls < MAX_POLLS
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    getResponse = await sorobanServer.getTransaction(txHash);
    polls++;
  }

  if (getResponse.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `Transaction did not succeed. Status: ${getResponse.status}`,
    );
  }

  return { txHash };
}

// Convenience: build → sign → submit in one call
// ---------------------------------------------------------------------------

export async function createEscrowOnChain(
  params: EscrowParams,
): Promise<EscrowResult> {
  if (USE_CONTRACT_MOCK) {
    const { mockCreateEscrow } = await import("./contractMock");
    const budgetXlm = params.budget ?? params.budgetXlm ?? 0;
    const txHash = await mockCreateEscrow({
      jobId: params.jobId,
      client: params.clientPublicKey,
      freelancer: params.clientPublicKey,
      token: "native",
      amount: String(BigInt(Math.round(budgetXlm * 10_000_000))),
    });
    return { txHash };
  }

  const preparedXdr = await buildCreateEscrowTx(params);
  return signAndSubmitEscrowTx(preparedXdr);
}

export { getUsdcContractId, USDC_CONTRACT_BY_NETWORK } from "./config/tokens";


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

  const { jobId, senderPublicKey, recipientPublicKey, ipfsCid } = params;
  const [account, gasEstimate] = await Promise.all([
    sorobanServer.getAccount(senderPublicKey),
    fetchGasEstimateSafe(),
  ]);

  const inclusionFee = tierToTransactionFee(gasEstimate.medium);
  const contract = new Contract(CONTRACT_ID);
  const callArgs = [
    nativeToScVal(jobId, { type: "string" }),
    Address.fromString(senderPublicKey).toScVal(),
    Address.fromString(recipientPublicKey).toScVal(),
    nativeToScVal(ipfsCid, { type: "string" }),
  ];

  const tx = new TransactionBuilder(account, {
    fee: inclusionFee,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("publish_message", ...callArgs))
    .setTimeout(300)
    .build();

  const simResponse = await sorobanServer.simulateTransaction(tx);

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

  const signResult = await signTransaction(preparedXdr, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const signedTransaction = typeof signResult === "string" ? signResult : (signResult as any).signedTransaction;

  const sendResponse = await sorobanServer.sendTransaction(
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

  let getResponse = await sorobanServer.getTransaction(txHash);
  const MAX_POLLS = 20;
  let polls = 0;

  while (
    getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    polls < MAX_POLLS
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    getResponse = await sorobanServer.getTransaction(txHash);
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

export async function buildBoostJobTx({
  jobId,
  clientPublicKey,
  amountXlm,
  treasuryAddress,
}: {
  jobId: string;
  clientPublicKey: string;
  amountXlm: number;
  treasuryAddress: string;
}): Promise<string> {
  const [account, gasEstimate] = await Promise.all([
    sorobanServer.getAccount(clientPublicKey),
    fetchGasEstimateSafe(),
  ]);

  const inclusionFee = tierToTransactionFee(gasEstimate.fast);
  const amountStroops = BigInt(Math.round(amountXlm * 10_000_000));

  const contract = new Contract(CONTRACT_ID);
  const callArgs = [
    nativeToScVal(jobId, { type: "string" }),
    Address.fromString(clientPublicKey).toScVal(),
    Address.fromString(treasuryAddress).toScVal(),
    nativeToScVal(amountStroops, { type: "i128" }),
  ];

  const tx = new TransactionBuilder(account, {
    fee: inclusionFee,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("boost_job", ...callArgs))
    .setTimeout(300)
    .build();

  const simResponse = await sorobanServer.simulateTransaction(tx);
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

  const signResult = await signTransaction(xdrString, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const signedTransaction = typeof signResult === "string" ? signResult : (signResult as any).signedTransaction;

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

  const hash = sendResponse.hash;
  const maxAttempts = 90;
  for (let i = 0; i < maxAttempts; i += 1) {
    const info = await sorobanServer.getTransaction(hash);
    if (info.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (info.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(
        "The on-chain transaction failed. Open the explorer link to see details, or verify the escrow state matches this job."
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(`Transaction timed out after ${maxAttempts} attempts. Hash: ${hash}`);
}

// ---------------------------------------------------------------------------
// Release escrow helpers (used by jobs/[id].tsx)
// ---------------------------------------------------------------------------

export async function buildReleaseEscrowTransaction(
  contractId: string,
  jobId: string,
  clientPublicKey: string
) {
  if (USE_CONTRACT_MOCK) {
    return { toXDR: () => "mock-prepared-xdr" };
  }
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

  const sim = await sorobanServer.simulateTransaction(tx);
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

  const sim = await sorobanServer.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  return SorobanRpc.assembleTransaction(tx, sim).build();
}

export async function submitSignedSorobanTransaction(
  signedXDR: string
): Promise<{ hash: string }> {
  if (USE_CONTRACT_MOCK) {
    return { hash: "mock-release-hash" };
  }
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
export const USDC_SAC_ADDRESS = getUsdcContractId();

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

export async function signTransactionWithWallet(
  xdrString: string
): Promise<{ signedXDR: string | null; error: string | null }> {
  try {
    const { signTransaction } = await getFreighter();
    const signResult = await signTransaction(xdrString, {
      network: "TESTNET",
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    const signedTransaction = typeof signResult === "string" ? signResult : (signResult as any).signedTransaction;
    return { signedXDR: signedTransaction, error: null };
  } catch (e) {
    return { signedXDR: null, error: e instanceof Error ? e.message : "Signing failed" };
  }
}

export interface BuildPaymentParams {
  fromPublicKey: string;
  toPublicKey: string;
  amount: string;
  memo?: string;
  asset?: string;
}

export async function buildPaymentTransaction(params: BuildPaymentParams) {
  const { fromPublicKey, toPublicKey, amount, memo, asset } = params;
  const account = await sorobanServer.getAccount(fromPublicKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      asset && asset !== "XLM"
        ? Operation.payment({ destination: toPublicKey, asset: new Asset(asset, CONTRACT_ID), amount })
        : Operation.payment({ destination: toPublicKey, asset: Asset.native(), amount })
    );
  if (memo) {
    tx.addMemo(Memo.text(memo));
  }
  return tx.setTimeout(300).build();
}

export async function submitTransaction(signedXDR: string) {
  const { Transaction } = await import("@stellar/stellar-sdk");
  const tx = new Transaction(signedXDR, NETWORK_PASSPHRASE);
  return sorobanServer.sendTransaction(tx);
}

export async function fetchMarketPayTransactions(
  publicKey: string,
  limit?: number,
  cursor?: string
): Promise<FetchTransactionsResponse> {
  const url = `${HORIZON_URL}/accounts/${publicKey}/transactions${cursor ? `?cursor=${cursor}` : ""}${limit ? `${cursor ? "&" : "?"}limit=${limit}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) return { transactions: [], hasMore: false };
  const data = await res.json();
  return {
    transactions: (data._embedded?.records || []).map((r: any) => ({
      id: r.id,
      hash: r.transaction_hash,
      ledger: r.ledger,
      created_at: r.created_at,
      from: "",
      to: "",
      amount: "",
      asset: "XLM",
      successful: r.successful,
    })),
    hasMore: !!data._links?.next,
  };
}
