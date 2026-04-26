import {
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import * as SorobanRpc from "@stellar/stellar-sdk/rpc";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NETWORK_PASSPHRASE = Networks.TESTNET;
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";

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

// ---------------------------------------------------------------------------
// Freighter helpers (browser-only)
// ---------------------------------------------------------------------------

async function getFreighter() {
  if (typeof window === "undefined") {
    throw new Error("Freighter is only available in the browser.");
  }
  // Freighter injects window.freighter; fall back to @stellar/freighter-api
  // when the extension is installed it patches the global.
  const { isConnected, getPublicKey, signTransaction } = await import(
    "@stellar/freighter-api"
  );

  const connected = await isConnected();
  if (!connected) {
    throw new Error(
      "Freighter wallet not found. Please install the Freighter extension."
    );
  }
  return { getPublicKey, signTransaction };
}

// ---------------------------------------------------------------------------
// Core: build the Soroban create_escrow transaction
// ---------------------------------------------------------------------------

/**
 * Builds, simulates, and returns a base64-encoded XDR transaction that invokes
 * `create_escrow(job_id: String, client: Address, amount: i128)` on the
 * deployed Soroban contract.
 *
 * The returned XDR is ready to be signed by Freighter and submitted.
 */
export async function buildCreateEscrowTx(
  params: EscrowParams
): Promise<string> {
  const { clientPublicKey, jobId, budgetXlm } = params;

  if (!CONTRACT_ID) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_ID is not set. Add it to your .env.local file."
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
    throw new Error(
      `Soroban simulation failed: ${simResponse.error}`
    );
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
  preparedXdr: string
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
    })()
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
      `Transaction did not succeed. Status: ${getResponse.status}`
    );
  }

  return { txHash };
}

// ---------------------------------------------------------------------------
// Convenience: build → sign → submit in one call
// ---------------------------------------------------------------------------

export async function createEscrowOnChain(
  params: EscrowParams
): Promise<EscrowResult> {
  const preparedXdr = await buildCreateEscrowTx(params);
  return signAndSubmitEscrowTx(preparedXdr);
}