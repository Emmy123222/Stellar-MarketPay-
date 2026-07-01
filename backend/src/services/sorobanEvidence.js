"use strict";

/**
 * backend/src/services/sorobanEvidence.js
 *
 * On-chain anchoring of dispute-evidence IPFS CIDs (Issue #448 — AC #1, #3).
 *
 * `disputeService.uploadEvidence` invokes `recordEvidenceCidOnChain` after a
 * successful Pinata upload so that the resulting CID is also written to the
 * Soroban contract's `Vec<Bytes>` audit trail at
 * `DataKey::EvidenceCids(job_id)`. The frontend then signs the returned
 * unsigned XDR with the uploader's wallet, mirroring the existing
 * `attachMessageTxHash` flow.
 *
 * `getOnchainEvidenceCids` is the read side — `GET /api/disputes/:jobId/onchain-cids`
 * uses it to surface the chain-attested CIDs in the dispute page even when
 * off-chain IPFS pins are lost.
 */

const {
  TransactionBuilder,
  Account,
  Contract,
  nativeToScVal,
  scValToNative,
  Address,
  Networks,
  rpc,
} = require("@stellar/stellar-sdk");
const pool = require("../db/pool");

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ||
  process.env.STELLAR_RPC_URL ||
  "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

const READ_CACHE_TTL_MS = 30 * 1000;
const readCache = new Map();

/**
 * Resolve which Soroban contract holds the dispute-evidence audit trail for a job.
 * The same escrow contract is the host: we look up the job's escrowContractId via
 * the Soroban env var `DISPUTE_CONTRACT_ID` (preferred) or `NEXT_PUBLIC_CONTRACT_ID`,
 * falling back to `jobs.escrowContractId` if recorded.
 */
async function resolveContractId(jobId) {
  if (process.env.DISPUTE_CONTRACT_ID) return process.env.DISPUTE_CONTRACT_ID;
  if (process.env.ESCROW_CONTRACT_ID) return process.env.ESCROW_CONTRACT_ID;
  if (process.env.NEXT_PUBLIC_CONTRACT_ID) return process.env.NEXT_PUBLIC_CONTRACT_ID;
  if (jobId) {
    const { rows } = await pool.query(
      "SELECT escrow_contract_id FROM jobs WHERE id = $1",
      [jobId],
    );
    if (rows.length && rows[0].escrow_contract_id) {
      return rows[0].escrow_contract_id;
    }
  }
  return null;
}

/**
 * Build an unsigned Soroban transaction that calls
 * `submit_evidence_cid(job_id: String, cid: Bytes, caller: Address)` on the
 * dispute contract. The frontend signs and submits it via the existing
 * wallet + Soroban RPC pipeline; the resulting tx hash can then be attached
 * to the evidence record via /api/disputes/:jobId/evidence/:id/tx-hash.
 *
 * Best-effort: if the contract ID can’t be resolved, env vars are missing,
 * or the RPC server is unreachable, this returns `{success: false, error}`
 * — the caller decides whether to surface that as a warning.
 */
async function recordEvidenceCidOnChain({ jobId, cid, callerAddress }) {
  try {
    if (!jobId || typeof cid !== "string" || !cid || !callerAddress) {
      return { success: false, error: "Missing jobId / cid / callerAddress" };
    }

    const contractId = await resolveContractId(jobId);
    if (!contractId) {
      return { success: false, error: "Contract ID not configured" };
    }

    const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: SOROBAN_RPC_URL.startsWith("http://") });
    const sourceAccount = await server.getAccount(callerAddress).catch(() => null);
    if (!sourceAccount) {
      return { success: false, error: `Account ${callerAddress} not found on network` };
    }

    const cidBytes = Buffer.from(cid, "utf8");
    const contract = new Contract(contractId);
    const operation = contract.call(
      "submit_evidence_cid",
      nativeToScVal(jobId, { type: "string" }),
      xdr.ScVal.scvBytes(cidBytes),
      new Address(callerAddress).toScVal(),
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "10000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(tx).catch((e) => {
      throw new Error(`Soroban prepareTransaction failed: ${e.message}`);
    });

    const xdrBase64 = prepared.toEnvelope().toXDR("base64");
    return {
      success: true,
      contractId,
      xdr: xdrBase64,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: SOROBAN_RPC_URL,
    };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Read the on-chain audit trail of CIDs for a job by simulating a call to
 * `get_evidence_cids(job_id)` on the dispute contract via Soroban RPC.
 * Returns a `string[]` of CID strings in insertion order.
 *
 * Cached for 30 s — chain evidence entries are append-only and very stable.
 *
 * Note: We deliberately do NOT fall back to `getContractData` (low-level
 * instance-storage read). The contract exposes a public view function
 * `get_evidence_cids` that abstracts the storage layout; going around it
 * would couple the backend to specific DataKey encodings.
 */
async function getOnchainEvidenceCids(jobId) {
  if (!jobId) return [];
  const cacheKey = `${jobId}::${(await resolveContractId(jobId)) || "_"}`;
  const cached = readCache.get(cacheKey);
  if (cached && Date.now() - cached.at < READ_CACHE_TTL_MS) {
    return cached.cids;
  }

  const contractId = await resolveContractId(jobId);
  if (!contractId) {
    readCache.set(cacheKey, { at: Date.now(), cids: [] });
    return [];
  }

  let cids = [];
  try {
    const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: SOROBAN_RPC_URL.startsWith("http://") });
    const viewCallPayload = new TransactionBuilder(
      new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(
        new Contract(contractId).call(
          "get_evidence_cids",
          nativeToScVal(jobId, { type: "string" }),
        ),
      )
      .setTimeout(0)
      .build();

    const sim = await server.simulateTransaction(viewCallPayload);
    if (sim && sim.result && sim.result.retval) {
      const native = scValToNative(sim.result.retval);
      if (Array.isArray(native)) {
        cids = native.map((v) =>
          Buffer.isBuffer(v) ? v.toString("utf8") : String(v),
        );
      }
    }
  } catch {
    // Contract not deployed on this network, RPC unreachable, or other transient
    // failure. The off-chain dispute_evidence table remains the source of
    // truth; we return an empty list rather than fail the request.
    cids = [];
  }

  readCache.set(cacheKey, { at: Date.now(), cids });
  return cids;
}

module.exports = {
  recordEvidenceCidOnChain,
  getOnchainEvidenceCids,
  resolveContractId,
  // exported for testing
  _clearCache: () => readCache.clear(),
};
