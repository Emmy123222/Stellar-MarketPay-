/**
 * lib/stellar.ts
 * Stellar blockchain helpers for MarketPay.
 */

import {
  Horizon, Networks, Asset, Operation, TransactionBuilder, Transaction,
  Contract, nativeToScVal, Address,
} from "@stellar/stellar-sdk";
import { SorobanRpc } from "@stellar/stellar-sdk";

const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as "testnet" | "mainnet";
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";

/** Soroban RPC (Stellar RPC) — used for smart contract calls. */
const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
  (NETWORK === "mainnet"
    ? "https://soroban-mainnet.stellar.org"
    : "https://soroban-testnet.stellar.org");

export const NETWORK_PASSPHRASE = NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
export const server = new Horizon.Server(HORIZON_URL);
export const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL);

export type MarketPayContractEventType = "created" | "released" | "refunded";

export interface MarketPayContractEvent {
  type: MarketPayContractEventType;
  jobId: string | null;
  raw: SorobanRpc.Api.GetEventsResponse["events"][number];
}

// XLM SAC (Stellar Asset Contract) address on testnet
export const XLM_SAC_ADDRESS =
  NETWORK === "mainnet"
    ? "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"
    : "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// USDC SAC (Stellar Asset Contract) address on testnet
export const USDC_SAC_ADDRESS =
  NETWORK === "mainnet"
    ? "CCU2PSEUPFGB5O4QLNBVCPGSJ6YHYIMFZTQDJTQTJ6LQI3M3J66OQ5YN"
    : "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";


// USDC asset issued by Circle
export const USDC_ISSUER =
  NETWORK === "mainnet"
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const USDC = new Asset("USDC", USDC_ISSUER);

// ─── Account ─────────────────────────────────────────────────────────────────

export async function getXLMBalance(publicKey: string): Promise<string> {
  try {
    const account = await server.loadAccount(publicKey);
    const xlm = account.balances.find((b) => b.asset_type === "native");
    return xlm ? xlm.balance : "0";
  } catch {
    throw new Error("Account not found or not funded.");
  }
}

export async function getUSDCBalance(publicKey: string): Promise<string | null> {
  try {
    const account = await server.loadAccount(publicKey);
    const usdc = account.balances.find(
      (b): b is Horizon.HorizonApi.BalanceLineAsset =>
        b.asset_type !== "native" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_code === "USDC" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_issuer === USDC_ISSUER
    );
    return usdc ? usdc.balance : null;
  } catch {
    return null;
  }
}

export async function getBalances(publicKey: string): Promise<{ xlm: string; usdc: string | null }> {
  try {
    const account = await server.loadAccount(publicKey);
    const xlm = account.balances.find((b) => b.asset_type === "native");
    const usdc = account.balances.find(
      (b): b is Horizon.HorizonApi.BalanceLineAsset =>
        b.asset_type !== "native" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_code === "USDC" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_issuer === USDC_ISSUER
    );
    return {
      xlm: xlm ? xlm.balance : "0",
      usdc: usdc ? usdc.balance : null,
    };
  } catch {
    return { xlm: "0", usdc: null };
  }
}

// ─── Payments ─────────────────────────────────────────────────────────────────

/**
 * Build an unsigned payment transaction for XLM or USDC.
 */
export async function buildPaymentTransaction({
  fromPublicKey, toPublicKey, amount, memo, asset = "XLM",
}: {
  fromPublicKey: string;
  toPublicKey: string;
  amount: string;
  memo?: string;
  asset?: "XLM" | "USDC";
}) {
  const sourceAccount = await server.loadAccount(fromPublicKey);

  // Check recipient trustline for USDC
  if (asset === "USDC") {
    const recipient = await server.loadAccount(toPublicKey).catch(() => null);
    if (!recipient) throw new Error("Recipient account not found on Stellar network.");
    const hasTrustline = recipient.balances.some(
      (b): b is Horizon.HorizonApi.BalanceLineAsset =>
        b.asset_type !== "native" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_code === "USDC" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_issuer === USDC_ISSUER
    );
    if (!hasTrustline) {
      throw new Error("Recipient has no USDC trustline. They must add USDC to their wallet first.");
    }
  }

  const builder = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.payment({
      destination: toPublicKey,
      asset: asset === "USDC" ? USDC : Asset.native(),
      amount,
    }))
    .setTimeout(60);

  if (memo) {
    const { Memo } = await import("@stellar/stellar-sdk");
    builder.addMemo(Memo.text(memo.slice(0, 28)));
  }

  return builder.build();
}

/**
 * Build a Strict Send Path Payment transaction.
 * This converts a source asset to a destination asset via the DEX.
 */
export async function buildPathPaymentTransaction({
  fromPublicKey,
  toPublicKey,
  sendAsset,
  sendAmount,
  destAsset,
  destMin,
  path,
}: {
  fromPublicKey: string;
  toPublicKey: string;
  sendAsset: Asset;
  sendAmount: string;
  destAsset: Asset;
  destMin: string;
  path: Asset[];
}) {
  const sourceAccount = await server.loadAccount(fromPublicKey);

  const builder = new TransactionBuilder(sourceAccount, {
    fee: "1000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.pathPaymentStrictSend({
      sendAsset,
      sendAmount,
      destination: toPublicKey,
      destAsset,
      destMin,
      path,
    }))
    .setTimeout(60);

  return builder.build();
}

/**
 * Get the best path and estimated exchange rate for a swap.
 */
export async function getPathPaymentPrice(
  sourceAsset: Asset,
  sourceAmount: string,
  destAsset: Asset
): Promise<{ amount: string; path: Asset[] } | null> {
  try {
    const paths = await server.strictSendPaths(sourceAsset, sourceAmount, [destAsset]).call();
    if (paths.records.length === 0) return null;
    
    // Pick the one with the highest destination amount
    const bestPath = paths.records[0];
    return {
      amount: bestPath.destination_amount,
      path: bestPath.path.map(p => new Asset(p.asset_code || "XLM", p.asset_issuer)),
    };
  } catch (err) {
    console.error("Error fetching path payment price:", err);
    return null;
  }
}

export async function submitTransaction(signedXDR: string) {
  const tx = new Transaction(signedXDR, NETWORK_PASSPHRASE);
  try {
    return await server.submitTransaction(tx);
  } catch (err: unknown) {
    const e = err as { response?: { data?: { extras?: { result_codes?: unknown } } } };
    if (e?.response?.data?.extras?.result_codes) {
      throw new Error(`Transaction failed: ${JSON.stringify(e.response.data.extras.result_codes)}`);
    }
    throw err;
  }
}

// ─── Soroban escrow (release_escrow) ───────────────────────────────────────────

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;

function friendlySorobanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient") && (lower.includes("balance") || lower.includes("fund"))) {
    return "Not enough XLM to pay the network fee. Add a small amount of test XLM to this account and try again.";
  }
  if (lower.includes("simulation") && lower.includes("failed")) {
    return "The contract rejected this transaction (simulation failed). Check that the job ID matches the on-chain escrow and that you are the client.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "The network took too long to confirm. Check Stellar Expert for the transaction status.";
  }
  if (raw.length > 220) return `${raw.slice(0, 220)}…`;
  return raw;
}

/**
 * Builds a prepared Soroban transaction that invokes `release_escrow(job_id, client)` on the escrow contract.
 * Sign the returned transaction with Freighter, then call {@link submitSignedSorobanTransaction}.
 */
export async function buildReleaseEscrowTransaction(
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
      "release_escrow",
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

/**
 * Builds a prepared Soroban transaction that invokes `release_with_conversion(job_id, client, target_token, min_amount_out)` on the escrow contract.
 */
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
 * Submits a signed Soroban transaction via RPC and polls until success or failure.
 * @returns Confirmed transaction hash (ledger close).
 */
export async function submitSignedSorobanTransaction(signedXdr: string): Promise<{ hash: string }> {
  let tx: Transaction;
  try {
    tx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
  } catch (err: unknown) {
    throw new Error(friendlySorobanError(err));
  }

  let sent: SorobanRpc.Api.SendTransactionResponse;
  try {
    sent = await sorobanServer.sendTransaction(tx);
  } catch (err: unknown) {
    throw new Error(friendlySorobanError(err));
  }

  if (sent.status === "ERROR") {
    const detail =
      sent.errorResult != null
        ? `Transaction rejected: ${String(sent.errorResult)}`
        : "Transaction was rejected by the network.";
    throw new Error(friendlySorobanError(new Error(detail)));
  }
  if (sent.status === "TRY_AGAIN_LATER") {
    throw new Error("The network is busy. Wait a few seconds and try again.");
  }

  const hash = sent.hash;
  const maxAttempts = 90;
  for (let i = 0; i < maxAttempts; i += 1) {
    const info = await sorobanServer.getTransaction(hash);
    if (info.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash };
    }
    if (info.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(
        "The on-chain transaction failed. Open the explorer link to see details, or verify the escrow state matches this job."
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    "Confirmation timed out waiting for the network. Your transaction may still succeed — check Stellar Expert using the hash from your wallet."
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(address);
}

export function explorerUrl(hash: string): string {
  const net = NETWORK === "mainnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/tx/${hash}`;
}

// ─── Soroban / Escrow ─────────────────────────────────────────────────────────

/**
 * Build an unsigned Soroban transaction that calls create_escrow() on the
 * MarketPay contract.  The caller must sign it with Freighter and submit via
 * submitSorobanTransaction().
 *
 * @param clientPublicKey  Stellar address of the client (signer + payer)
 * @param jobId            Backend job UUID
 * @param freelancerAddress Stellar address of the freelancer (placeholder — use a dummy if not yet known)
 * @param budget           Budget amount (e.g. "100.0000000")
 * @param currency         Currency type ("XLM" or "USDC")
 */
export async function buildCreateEscrowTransaction({
  clientPublicKey,
  jobId,
  freelancerAddress,
  budget,
  currency = "XLM",
}: {
  clientPublicKey: string;
  jobId: string;
  freelancerAddress: string;
  budget: string;
  currency?: "XLM" | "USDC";
}) {
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
  if (!contractId) throw new Error("NEXT_PUBLIC_CONTRACT_ID is not set");

  // Convert budget to smallest unit based on currency
  // XLM: 1 XLM = 10_000_000 stroops
  // USDC: 1 USDC = 1_000_000 units (6 decimals)
  const amountUnits = currency === "XLM" 
    ? BigInt(Math.round(parseFloat(budget) * 10_000_000))
    : BigInt(Math.round(parseFloat(budget) * 1_000_000));

  const tokenAddress = currency === "XLM" ? XLM_SAC_ADDRESS : USDC_SAC_ADDRESS;

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
        new Address(tokenAddress).toScVal(),
        nativeToScVal(amountUnits, { type: "i128" }),
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
 */
export async function submitSorobanTransaction(signedXDR: string): Promise<string> {
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

export function accountUrl(address: string): string {
  const net = NETWORK === "mainnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/account/${address}`;
}

/**
 * Streams transactions for a given account using Horizon SSE.
 * @param publicKey The account to watch.
 * @param onTransaction Callback triggered when a new transaction is detected.
 * @returns A function to close the stream.
 */
export function streamAccountTransactions(
  publicKey: string,
  onTransaction: (tx: Horizon.ServerApi.TransactionRecord) => void
): () => void {
  const closeStream = server
    .transactions()
    .forAccount(publicKey)
    .cursor("now")
    .stream({
      onmessage: (tx) => {
        onTransaction(tx as unknown as Horizon.ServerApi.TransactionRecord);
      },
      onerror: (error) => {
        console.error("Horizon stream error:", error);
      },
    });

  return closeStream;
}

export function subscribeToContractEvents(
  contractId: string,
  onEvent: (event: MarketPayContractEvent) => void
): () => void {
  let isClosed = false;
  let timeoutRef: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let cursor: string | undefined;
  const maxAttempts = 3;
  const supported = new Set<MarketPayContractEventType>(["created", "released", "refunded"]);

  const parseEvent = (
    event: SorobanRpc.Api.GetEventsResponse["events"][number]
  ): MarketPayContractEvent | null => {
    const value = event.value as unknown as { _attributes?: Record<string, unknown>; _value?: unknown };
    const attrs = value?._attributes || {};
    const topics = Array.isArray(attrs.topic) ? attrs.topic : [];
    const first = topics[0] as unknown as { _value?: string } | undefined;
    const eventType = first?._value as MarketPayContractEventType | undefined;
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
