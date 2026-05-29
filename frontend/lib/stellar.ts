import {
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  nativeToScVal,
  xdr,
  Horizon,
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

const NETWORK_PASSPHRASE = NETWORK_NAME === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
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
  /** Stellar public key of the client funding the escrow */
  clientPublicKey: string;
  /** Unique job identifier (stored in your backend) */
  jobId: string;
  /** Budget in XLM (e.g. 50 for 50 XLM) */
  budgetXlm: number;
}

export interface EscrowResult {
  /** The transaction hash returned after submission */
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
  // Freighter injects window.freighter; fall back to @stellar/freighter-api
  // when the extension is installed it patches the global.
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

/**
 * Builds, simulates, and returns a base64-encoded XDR transaction that invokes
 * `create_escrow(job_id: String, client: Address, freelancer: Address, token: Address, amount: i128, ...)` on the
 * deployed Soroban contract.
 *
 * The returned XDR is ready to be signed by Freighter and submitted.
 */
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

  // Fetch the source account
  const account = await server.getAccount(clientPublicKey);

  // Convert XLM to stroops (1 XLM = 10_000_000 stroops)
  const amountStroops = BigInt(Math.round(budgetXlm * 10_000_000));

  // Build the contract call arguments
  const contract = new Contract(CONTRACT_ID);
  const callArgs = [
    nativeToScVal(jobId, { type: "string" }), // job_id: String
    Address.fromString(clientPublicKey).toScVal(), // client: Address
    nativeToScVal(amountStroops, { type: "i128" }), // amount: i128 (stroops)
  ];

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("create_escrow", ...callArgs))
    .setTimeout(300)
    .build();

  // Simulate to populate the soroban data / auth entries
  const simResponse = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Soroban simulation failed: ${simResponse.error}`);
  }

  // Assemble the transaction (adds footprint, resource fees, etc.)
  const assembledTx = SorobanRpc.assembleTransaction(tx, simResponse).build();

  return assembledTx.toXDR();
}

// ---------------------------------------------------------------------------
// Core: sign with Freighter and submit
// ---------------------------------------------------------------------------

/**
 * Signs the prepared XDR transaction via Freighter, submits it to the
 * Soroban RPC, and polls until the transaction is finalised.
 *
 * Returns the confirmed transaction hash.
 */
export async function signAndSubmitEscrowTx(
  preparedXdr: string,
): Promise<EscrowResult> {
  const { signTransaction } = await getFreighter();

  // Ask the user to sign
  const { signedTransaction } = await signTransaction(preparedXdr, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
    allowHttp: false,
  });

  // Submit the signed transaction
  const sendResponse = await server.sendTransaction(
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

export async function buildReleaseEscrowTransaction(
  _escrowContractId: string,
  jobId: string,
  clientPublicKey: string,
): Promise<{ toXDR: () => string }> {
  if (USE_CONTRACT_MOCK) {
    const { mockReleaseEscrow } = await import("./contractMock");
    await mockReleaseEscrow({ jobId, client: clientPublicKey });
    return { toXDR: () => "MOCK_UNSIGNED_XDR" };
  }

  throw new Error(
    "Release escrow requires NEXT_PUBLIC_USE_CONTRACT_MOCK=true or a deployed contract integration.",
  );
}

export async function submitSignedSorobanTransaction(
  _signedXDR: string,
): Promise<{ hash: string }> {
  if (USE_CONTRACT_MOCK) {
    return { hash: `mock-${Date.now().toString(16)}` };
  }

  throw new Error(
    "Soroban submission requires NEXT_PUBLIC_USE_CONTRACT_MOCK=true or RPC configuration.",
  );
}

export const USDC_SAC_ADDRESS = "";
export const XLM_SAC_ADDRESS = "";

export async function getEscrowState(_jobId: string) {
  return null;
}

export function subscribeToContractEvents(
  _jobId: string,
  _handler: (event: unknown) => void,
) {
  return () => {};
}

export async function buildPartialReleaseTransaction(
  _contractId: string,
  _jobId: string,
  _clientPublicKey: string,
  _index: number,
) {
  throw new Error("Partial release is not available in mock mode.");
}

// ---------------------------------------------------------------------------
// Transaction History & Explorer URLs
// ---------------------------------------------------------------------------

/**
 * Generate a Stellar Expert URL for viewing a transaction
 */
export function explorerUrl(txHash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}

/**
 * Generate a Stellar Expert URL for viewing an account
 */
export function accountUrl(publicKey: string): string {
  return `https://stellar.expert/explorer/testnet/account/${publicKey}`;
}

/**
 * Fetch MarketPay transactions for a given account
 * Includes payments, escrow operations, and contract interactions
 */
export async function fetchMarketPayTransactions(
  publicKey: string,
  limit: number = 20,
  cursor?: string,
): Promise<FetchTransactionsResponse> {
  try {
    // Fetch transactions from Horizon API
    let query = server
      .transactions()
      .forAccount(publicKey)
      .limit(limit + 1) // Fetch one extra to determine if there are more
      .order("desc");

    if (cursor) {
      query = query.cursor(cursor);
    }

    const response = await query.call();
    const records = response.records || [];

    // Check if there are more records
    const hasMore = records.length > limit;
    const transactions = records.slice(0, limit);

    // Transform Horizon transactions to MarketPayTransaction format
    const marketPayTransactions: MarketPayTransaction[] = transactions.map(
      (tx: any) => {
        // Extract payment operations
        let from = "";
        let to = "";
        let amount = "0";
        let asset = "XLM";
        let marketPayType: "escrow" | "payment" | "refund" | "other" = "other";

        // Look for payment operations
        if (tx.operations && tx.operations.length > 0) {
          const paymentOp = tx.operations.find(
            (op: any) =>
              op.type === "payment" ||
              op.type === "path_payment_strict_receive",
          );

          if (paymentOp) {
            from = paymentOp.from;
            to = paymentOp.to;
            amount = paymentOp.amount;
            asset = paymentOp.asset_code || "XLM";
            marketPayType = "payment";

            // Detect escrow operations by memo or operation type
            if (tx.memo && tx.memo.includes("escrow")) {
              marketPayType = "escrow";
            }
          }
        }

        return {
          id: tx.id,
          hash: tx.hash,
          ledger: tx.ledger_attr,
          created_at: tx.created_at,
          from,
          to,
          amount,
          asset,
          memo: tx.memo,
          memo_type: tx.memo_type,
          successful: tx.successful,
          marketPayType,
        };
      },
    );

    return {
      transactions: marketPayTransactions,
      hasMore,
    };
  } catch (error) {
    console.error("Error fetching transactions:", error);
    throw new Error("Failed to fetch transaction history");
  }
}
