"use strict";

/**
 * backend/src/services/contractVersionService.js
 *
 * Reads the deployed escrow contract's semver string via its `get_version()`
 * view function, so callers (e.g. GET /health) can version-gate behaviour
 * without comparing WASM hashes against a registry.
 *
 * The value only changes on `upgrade()`, so it is cached for
 * CACHE_TTL_MS. Any failure (contract ID unset, RPC unreachable, contract
 * not initialized) yields `null` rather than throwing.
 */

const {
  TransactionBuilder,
  Account,
  Contract,
  scValToNative,
  Networks,
  rpc,
} = require("@stellar/stellar-sdk");

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ||
  process.env.STELLAR_RPC_URL ||
  "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

const CACHE_TTL_MS = 5 * 60 * 1000;
const READ_TIMEOUT_MS = 2000;

// Any funded-or-not account works as the source of a simulated view call.
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

let cache = null; // { at: number, version: string|null }

function resolveContractId() {
  return (
    process.env.CONTRACT_ID ||
    process.env.ESCROW_CONTRACT_ID ||
    process.env.NEXT_PUBLIC_CONTRACT_ID ||
    null
  );
}

async function readVersionFromChain(contractId) {
  const server = new rpc.Server(SOROBAN_RPC_URL, {
    allowHttp: SOROBAN_RPC_URL.startsWith("http://"),
  });
  const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call("get_version"))
    .setTimeout(0)
    .build();

  let timer;
  const sim = await Promise.race([
    server.simulateTransaction(tx),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("get_version simulation timed out")),
        READ_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));

  if (rpc.Api.isSimulationError(sim) || !sim.result || !sim.result.retval) {
    return null;
  }
  const version = scValToNative(sim.result.retval);
  return typeof version === "string" ? version : null;
}

/**
 * Return the deployed contract's semver string (e.g. "1.2.0"), or null when
 * it cannot be determined.
 * @returns {Promise<string|null>}
 */
async function getContractVersion() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.version;
  }

  const contractId = resolveContractId();
  let version = null;
  if (contractId) {
    try {
      version = await readVersionFromChain(contractId);
    } catch {
      version = null;
    }
  }

  // Don't pin a failed read for the full TTL; retry on the next request.
  if (version !== null) {
    cache = { at: Date.now(), version };
  }
  return version;
}

/** Test helper: drop the cached value. */
function _resetCache() {
  cache = null;
}

module.exports = { getContractVersion, _resetCache };
