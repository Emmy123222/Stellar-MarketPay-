import {
  Horizon, Networks, Asset, Operation, TransactionBuilder, Transaction,
  Contract, nativeToScVal, Address, scValToNative,
} from "@stellar/stellar-sdk";
import * as SorobanRpc from "@stellar/stellar-sdk/rpc";

import {
  Horizon, Networks, Asset, Operation, TransactionBuilder, Transaction,
  Contract, nativeToScVal, scValToNative, Address,
} from "@stellar/stellar-sdk";
import { SorobanRpc } from "@stellar/stellar-sdk";
import {
  mockCreateEscrow,
  mockStartWork,
  mockReleaseEscrow,
  mockRefundEscrow,
  mockGetEscrow,
  mockGetStatus,
  mockGetEscrowCount,
} from "./contractMock";

const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as "testnet" | "mainnet";
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const USE_MOCK = process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true";

export const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
export const server = new Horizon.Server(HORIZON_URL);
export const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL);

// XLM SAC (Stellar Asset Contract) address on testnet
export const XLM_SAC_ADDRESS =
  NETWORK === "mainnet"
    ? "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"
    : "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export type MarketPayContractEventType = "created" | "released" | "refunded" | "timeout_refunded";

export interface MarketPayContractEvent {
  type: MarketPayContractEventType;
  jobId: string | null;
  raw: SorobanRpc.Api.GetEventsResponse["events"][number];
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

/**
 * Issue #175 — Read the timeout_ledger for a job directly from the contract.
 * Uses simulation (no transaction submission or fees).
 * @returns timeout_ledger as a number, or null if the call fails.
 */
export async function getEscrowTimeoutLedger(contractId: string, jobId: string): Promise<number | null> {
  if (!CONTRACT_ID_RE.test(contractId)) return null;
  try {
    // Use a dummy source account for simulation
    const account = await sorobanServer.getAccount("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    const contract = new Contract(contractId);
    const op = contract.call("get_timeout_ledger", nativeToScVal(jobId));
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const sim = await sorobanServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationSuccess(sim) && sim.result?.retval) {
      const raw = scValToNative(sim.result.retval);
      if (typeof raw === "number") return raw;
      if (typeof raw === "bigint") return Number(raw);
      if (typeof raw === "string") return parseInt(raw, 10);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch the latest closed ledger sequence from Soroban RPC.
 * Used for timeout countdown calculations.
 */
export async function getCurrentLedgerSequence(): Promise<number> {
  try {
    const latest = await sorobanServer.getLatestLedger();
    return latest.sequence;
  } catch {
    return 0;
  }
}

/**
 * Builds a prepared Soroban transaction that invokes `timeout_refund(job_id, client)` on the escrow contract.
 * Issue #175 — Client claims refund after freelancer inactivity timeout.
 */
export async function buildTimeoutRefundTransaction(
  contractId: string,
  jobId: string,
  clientAddress: string
): Promise<Transaction> {
  if (!CONTRACT_ID_RE.test(contractId)) {
    throw new Error("Invalid escrow contract ID. Expected a Soroban contract address (C…).");
  }
  if (!jobId.trim()) throw new Error("Job ID is required.");
  if (!/^G[A-Z0-9]{55}$/.test(clientAddress)) {
    throw new Error("Invalid client account.");
  }

  try {
    const account = await sorobanServer.getAccount(clientAddress);
    const contract = new Contract(contractId);
    const op = contract.call(
      "timeout_refund",
      nativeToScVal(jobId),
      Address.fromString(clientAddress).toScVal()
    );

    const built = new TransactionBuilder(account, {
      fee: "1000000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();

    return await sorobanServer.prepareTransaction(built);
  } catch (err: unknown) {
    throw new Error(friendlySorobanError(err));
  }
}
export async function buildReleaseWithConversionTransaction(
  contractId: string,
  jobId: string,
  clientAddress: string,
  targetTokenAddress: string,
  minAmountOut: bigint
): Promise<Transaction> {
  try {
    const account = await sorobanServer.getAccount(clientAddress);
    const contract = new Contract(contractId);
    const op = contract.call(
      "release_with_conversion",
      nativeToScVal(jobId),
      Address.fromString(clientAddress).toScVal(),
      Address.fromString(targetTokenAddress).toScVal(),
      nativeToScVal(minAmountOut, { type: "i128" })
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
 * Builds a prepared Soroban transaction that invokes `partial_release(job_id, milestone_index, client)` on the escrow contract.
 */
export async function buildPartialReleaseTransaction(
  contractId: string,
  jobId: string,
  clientAddress: string,
  milestoneIndex: number
): Promise<Transaction> {
  if (!CONTRACT_ID_RE.test(contractId)) {
    throw new Error("Invalid escrow contract ID. Expected a Soroban contract address (C…).");
  }
  if (!jobId.trim()) throw new Error("Job ID is required.");
  if (!/^G[A-Z0-9]{55}$/.test(clientAddress)) {
    throw new Error("Invalid client account.");
  }

  try {
    const account = await sorobanServer.getAccount(clientAddress);
    const contract = new Contract(contractId);
    const op = contract.call(
      "partial_release",
      nativeToScVal(jobId),
      nativeToScVal(milestoneIndex, { type: "u32" }),
      Address.fromString(clientAddress).toScVal()
    );

    const built = new TransactionBuilder(account, {
      fee: "1000000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();

    return await sorobanServer.prepareTransaction(built);
  } catch (err: unknown) {
    throw new Error(friendlySorobanError(err));
  }
}

/**
 * Reads the on-chain Escrow state for a job.
 */
export async function getEscrowState(contractId: string, jobId: string, clientAddress: string): Promise<any> {
  try {
    const account = await sorobanServer.getAccount(clientAddress).catch(() => null);
    if (!account) return null;
    const contract = new Contract(contractId);
    const op = contract.call("get_escrow", nativeToScVal(jobId));
    const tx = new TransactionBuilder(account, { fee: "100000", networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(op)
      .setTimeout(30).build();
      
    const simResult = await sorobanServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationSuccess(simResult) && simResult.result?.retval) {
      return scValToNative(simResult.result.retval);
    }
    return null;
  } catch (err) {
    console.error("Failed to read escrow state", err);
    return null;
  }
}

/**
 * Submits a signed Soroban transaction via RPC and polls until success or failure.
 * @returns Confirmed transaction hash (ledger close).
 */
export async function signAndSubmitEscrowTx(
  preparedXdr: string
): Promise<EscrowResult> {
  const { signTransaction } = await getFreighter();

  // Ask the user to sign
  const { signedTransaction } = await signTransaction(preparedXdr, {
    network: "TESTNET",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "create_escrow",
        nativeToScVal(jobId, { type: "string" }),
        new Address(clientPublicKey).toScVal(),
        new Address(freelancerAddress).toScVal(),
        new Address(tokenAddress).toScVal(),
        nativeToScVal(amountUnits, { type: "i128" }),
        nativeToScVal(null), // milestones: None
        nativeToScVal(null), // timeout_ledgers: None (use contract default)
      )
    )
    .setTimeout(60)
    .build();

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

export function subscribeToContractEvents(
  contractId: string,
  onEvent: (event: MarketPayContractEvent) => void
): () => void {
  let isClosed = false;
  let timeoutRef: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let cursor: string | undefined;
  const maxAttempts = 3;
  const supported = new Set<MarketPayContractEventType>(["created", "released", "refunded", "timeout_refunded"]);

  const parseEvent = (
    event: SorobanRpc.Api.GetEventsResponse["events"][number]
  ): MarketPayContractEvent | null => {
    const value = event.value as unknown as { _attributes?: Record<string, unknown>; _value?: unknown };
    const attrs = value?._attributes || {};
    const topics = Array.isArray(attrs.topic) ? attrs.topic : [];
    const first = topics[0] as unknown as { _value?: string } | undefined;
    const rawType = first?._value;
    if (!rawType) return null;

    // Map contract symbols to frontend event types
    const typeMap: Record<string, MarketPayContractEventType> = {
      "created": "created",
      "released": "released",
      "refunded": "refunded",
      "torefnd": "timeout_refunded",
    };
    const eventType = typeMap[rawType];
    if (!eventType || !supported.has(eventType)) return null;

    let jobId: string | null = null;
    const payload = value?._value;
    if (Array.isArray(payload) && payload.length > 0 && payload[0]?._value) {
      jobId = String(payload[0]._value);
    }

    return { type: eventType, jobId, raw: event };
  };

  const scheduleRetry = () => {
    if (isClosed || attempts >= maxAttempts) return;
    const delay = 1000 * (2 ** attempts);
    attempts += 1;
    timeoutRef = setTimeout(() => {
      pollLoop();
    }, delay);
  };

  const pollLoop = async () => {
    while (!isClosed) {
      try {
        const response = await sorobanServer.getEvents({
          startLedger: undefined,
          filters: [{ contractIds: [contractId], type: "contract" }],
          pagination: { cursor, limit: 50 },
        });

        attempts = 0;
        for (const event of response.events) {
          cursor = event.pagingToken;
          const parsed = parseEvent(event);
          if (parsed) onEvent(parsed);
        }
      } catch (error) {
        console.error("Contract event subscription error:", error);
        scheduleRetry();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  };

  pollLoop();

  return () => {
    isClosed = true;
    if (timeoutRef) clearTimeout(timeoutRef);
  };
}

// ─── Soroban / Escrow ─────────────────────────────────────────────────────────

/**
 * Build an unsigned Soroban transaction that calls create_escrow() on the
 * MarketPay contract. The caller must sign it with Freighter and submit via
 * submitSorobanTransaction().
 *
 * When NEXT_PUBLIC_USE_CONTRACT_MOCK=true, returns a mock transaction that
 * bypasses the network entirely.
 *
 * @param clientPublicKey  Stellar address of the client (signer + payer)
 * @param jobId            Backend job UUID
 * @param freelancerAddress Stellar address of the freelancer
 * @param budgetXLM        Budget in XLM (e.g. "100.0000000")
 */
export async function buildCreateEscrowTransaction({
  clientPublicKey,
  jobId,
  freelancerAddress,
  budgetXLM,
}: {
  clientPublicKey: string;
  jobId: string;
  freelancerAddress: string;
  budgetXLM: string;
}) {
  // Mock mode: return a fake transaction object
  if (USE_MOCK) {
    console.log("[STELLAR] Using contract mock mode");
    return {
      toXDR: () => "MOCK_UNSIGNED_XDR",
      _mockParams: {
        jobId,
        client: clientPublicKey,
        freelancer: freelancerAddress,
        token: XLM_SAC_ADDRESS,
        amount: String(BigInt(Math.round(parseFloat(budgetXLM) * 10_000_000))),
      },
    } as any;
  }

  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
  if (!contractId) throw new Error("NEXT_PUBLIC_CONTRACT_ID is not set");

  // Convert XLM to stroops (1 XLM = 10_000_000 stroops)
  const amountStroops = BigInt(Math.round(parseFloat(budgetXLM) * 10_000_000));

  const contract = new Contract(contractId);
  const sourceAccount = await sorobanServer.getAccount(clientPublicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "1000000", // generous fee for Soroban ops
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "create_escrow",
        nativeToScVal(jobId, { type: "string" }),
        new Address(clientPublicKey).toScVal(),
        new Address(freelancerAddress).toScVal(),
        new Address(XLM_SAC_ADDRESS).toScVal(),
        nativeToScVal(amountStroops, { type: "i128" }),
      )
    )
    .setTimeout(60)
    .build();

  // Simulate to get the correct resource footprint
  const simResult = await sorobanServer.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Soroban simulation failed: ${simResult.error}`);
  }

  return SorobanRpc.assembleTransaction(tx, simResult).build();
}

/**
 * Submit a signed Soroban transaction and poll until it's confirmed.
 * 
 * When NEXT_PUBLIC_USE_CONTRACT_MOCK=true, calls the mock contract instead.
 */
export async function submitSorobanTransaction(signedXDR: string, mockParams?: any): Promise<string> {
  // Mock mode: call mock contract
  if (USE_MOCK && signedXDR === "MOCK_SIGNED_XDR" && mockParams) {
    console.log("[STELLAR] Submitting to mock contract");
    return await mockCreateEscrow(mockParams);
  }

  const sendResult = await sorobanServer.sendTransaction(
    new Transaction(signedXDR, NETWORK_PASSPHRASE)
  );

  if (sendResult.status === "ERROR") {
    throw new Error(`Soroban submission failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const hash = sendResult.hash;

  // Poll for confirmation (up to 30s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await sorobanServer.getTransaction(hash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return hash;
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Soroban transaction failed: ${hash}`);
    }
  }

  throw new Error(`Soroban transaction timed out: ${hash}`);
}

/**
 * Build and submit start_work transaction.
 * Marks escrow as in-progress when client accepts a freelancer.
 */
export async function startWork(jobId: string, clientPublicKey: string): Promise<string> {
  if (USE_MOCK) {
    console.log("[STELLAR] Using contract mock mode for start_work");
    return await mockStartWork({ jobId, client: clientPublicKey });
  }

  // Real implementation would build + sign + submit transaction
  throw new Error("start_work not yet implemented for real contract");
}

/**
 * Build and submit release_escrow transaction.
 * Releases funds to freelancer when work is approved.
 */
export async function releaseEscrow(jobId: string, clientPublicKey: string): Promise<string> {
  if (USE_MOCK) {
    console.log("[STELLAR] Using contract mock mode for release_escrow");
    return await mockReleaseEscrow({ jobId, client: clientPublicKey });
  }

  // Real implementation would build + sign + submit transaction
  throw new Error("release_escrow not yet implemented for real contract");
}

/**
 * Build and submit refund_escrow transaction.
 * Returns funds to client before work starts.
 */
export async function refundEscrow(jobId: string, clientPublicKey: string): Promise<string> {
  if (USE_MOCK) {
    console.log("[STELLAR] Using contract mock mode for refund_escrow");
    return await mockRefundEscrow({ jobId, client: clientPublicKey });
  }

  // Real implementation would build + sign + submit transaction
  throw new Error("refund_escrow not yet implemented for real contract");
}

/**
 * Query escrow status for a job.
 */
export async function getEscrowStatus(jobId: string): Promise<string> {
  if (USE_MOCK) {
    console.log("[STELLAR] Using contract mock mode for get_status");
    return await mockGetStatus(jobId);
  }

  // Real implementation would query contract
  throw new Error("get_status not yet implemented for real contract");
}

/**
 * Query full escrow record for a job.
 */
export async function getEscrow(jobId: string): Promise<any> {
  if (USE_MOCK) {
    console.log("[STELLAR] Using contract mock mode for get_escrow");
    return await mockGetEscrow(jobId);
  }

  // Real implementation would query contract
  throw new Error("get_escrow not yet implemented for real contract");
}

/**
 * Query total escrow count.
 */
export async function getEscrowCount(): Promise<number> {
  if (USE_MOCK) {
    console.log("[STELLAR] Using contract mock mode for get_escrow_count");
    return await mockGetEscrowCount();
  }

  // Real implementation would query contract
  throw new Error("get_escrow_count not yet implemented for real contract");
}

// Enhanced transaction fetching for MarketPay
export interface MarketPayTransaction {
  id: string;
  hash: string;
  ledger: number;
  created_at: string;
  source_account: string;
  type: string;
  type_i: number;
  amount?: string;
  asset?: string;
  to?: string;
  from?: string;
  memo?: string;
  memo_type?: string;
  fee_paid: string;
  successful: boolean;
  operations: any[];
  marketPayType: "payment" | "escrow" | "other";
}

/**
 * Fetch transactions with enhanced MarketPay filtering
 */
export async function fetchMarketPayTransactions(
  publicKey: string,
  limit: number = 20,
  cursor?: string
): Promise<{ transactions: MarketPayTransaction[]; hasMore: boolean; nextCursor?: string }> {
  try {
    const builder = server
      .transactions()
      .forAccount(publicKey)
      .limit(limit)
      .order("desc");

    if (cursor) {
      builder.cursor(cursor);
    }

    const response = await builder.call();
    const transactions: MarketPayTransaction[] = [];

    for (const tx of response.records) {
      const marketPayTx = await parseMarketPayTransaction(tx);
      if (marketPayTx) {
        transactions.push(marketPayTx);
      }
    }

    return {
      transactions,
      hasMore: response.records.length === limit,
      nextCursor: response.records.length > 0 ? response.records[response.records.length - 1].paging_token : undefined,
    };
  } catch (error) {
    console.error("Error fetching MarketPay transactions:", error);
    throw error;
  }
}

/**
 * Parse a transaction and determine if it's MarketPay-related
 */
async function parseMarketPayTransaction(tx: Horizon.ServerApi.TransactionRecord): Promise<MarketPayTransaction | null> {
  try {
    let amount: string | undefined;
    let asset: string | undefined;
    let to: string | undefined;
    let from: string | undefined;
    let marketPayType: "payment" | "escrow" | "other" = "other";
    let isMarketPayRelated = false;

    // Get operations for this transaction
    const operations = await server
      .operations()
      .forTransaction(tx.hash)
      .call();

    // Analyze operations to determine MarketPay relevance
    for (const op of operations.records) {
      if (op.type === "payment") {
        const payment = op as any;
        amount = payment.amount;
        asset = payment.asset_type === "native" ? "XLM" : payment.asset_code;
        to = payment.to;
        from = tx.source_account;
        
        // Check if payment has MarketPay memo
        if (tx.memo && tx.memo_type !== "none") {
          isMarketPayRelated = true;
          marketPayType = "payment";
        }
        
        // Check if payment amount matches typical job budgets (optional enhancement)
        if (amount && parseFloat(amount) > 0.1) { // Threshold for MarketPay relevance
          isMarketPayRelated = true;
        }
      } else if (op.type === "invoke_host_function") {
        // Soroban contract calls - likely escrow operations
        isMarketPayRelated = true;
        marketPayType = "escrow";
      } else if (op.type === "create_account") {
        // Account creation - could be related to MarketPay onboarding
        isMarketPayRelated = true;
        marketPayType = "other";
      }
    }

    // If not MarketPay related, return null
    if (!isMarketPayRelated) {
      return null;
    }

    return {
      id: tx.id,
      hash: tx.hash,
      ledger: tx.ledger_attr || 0,
      created_at: tx.created_at,
      source_account: tx.source_account,
      type: tx.type,
      type_i: tx.type_i,
      amount,
      asset,
      to,
      from,
      memo: tx.memo,
      memo_type: tx.memo_type,
      fee_paid: tx.fee_paid,
      successful: tx.successful,
      operations: operations.records,
      marketPayType,
    };
  } catch (error) {
    console.error("Error parsing transaction:", error);
    return null;
  }
}

/**
 * Get transaction details with full operation information
 */
export async function getTransactionDetails(txHash: string): Promise<MarketPayTransaction | null> {
  try {
    const tx = await server.transactions().transaction(txHash);
    return parseMarketPayTransaction(tx);
  } catch (error) {
    console.error("Error fetching transaction details:", error);
    return null;
  }
}
