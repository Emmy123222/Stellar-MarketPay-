"use strict";

const { nativeToScVal, scValToNative } = require("@stellar/stellar-sdk");
const { readContractValue } = require("./sorobanClient");
const cache = require("../utils/cache");
const pool = require("../db/pool");

const ARBITRATOR_REGISTRY_CONTRACT_ID = process.env.ARBITRATOR_REGISTRY_CONTRACT_ID;
const ARBITRATOR_LIST_CACHE_KEY = "dao:arbitrators:list";
const ARBITRATOR_LIST_CACHE_TTL = 24 * 60 * 60;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_TIMEOUT_MS = 30_000;

let consecutiveRpcFailures = 0;
let circuitOpenedAt = 0;

function isCircuitOpen() {
  if (!circuitOpenedAt) return false;
  if (Date.now() - circuitOpenedAt >= CIRCUIT_RESET_TIMEOUT_MS) {
    consecutiveRpcFailures = 0;
    circuitOpenedAt = 0;
    return false;
  }
  return true;
}

async function readRegistryValue(method, args = []) {
  if (isCircuitOpen()) {
    const error = new Error("Soroban arbitrator registry circuit is open");
    error.isSorobanRegistryError = true;
    throw error;
  }

  try {
    const result = await readContractValue(
      ARBITRATOR_REGISTRY_CONTRACT_ID,
      method,
      args,
    );
    consecutiveRpcFailures = 0;
    circuitOpenedAt = 0;
    return result;
  } catch (error) {
    consecutiveRpcFailures += 1;
    if (consecutiveRpcFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      circuitOpenedAt = Date.now();
    }
    error.isSorobanRegistryError = true;
    throw error;
  }
}

function registryUnavailableError() {
  const error = new Error("Arbitrator registry temporarily unavailable");
  error.status = 503;
  return error;
}

/**
 * Read the list of active arbitrator addresses from the on-chain contract.
 * Returns an array of Stellar public keys (strings).
 */
async function getArbitratorAddresses() {
  if (!ARBITRATOR_REGISTRY_CONTRACT_ID) {
    return [];
  }
  const result = await readRegistryValue("get_arbitrators");
  if (!result) return [];
  const scVals = result.retval ? [result.retval] : (result.results || []);
  if (!scVals.length) return [];
  const addresses = scValToNative(scVals[0]);
  if (!Array.isArray(addresses)) return [];
  return addresses.map((a) => a.toString());
}

/**
 * Check if a specific address is an active arbitrator on-chain.
 */
async function isArbitrator(address) {
  if (!ARBITRATOR_REGISTRY_CONTRACT_ID) {
    return false;
  }
  try {
    const result = await readRegistryValue("is_arbitrator", [
      nativeToScVal(address, { type: "address" }),
    ]);
    if (!result) return false;
    const scVals = result.retval ? [result.retval] : (result.results || []);
    if (!scVals.length) return false;
    return scValToNative(scVals[0]) === true;
  } catch {
    return false;
  }
}

/**
 * Get arbitrator count from on-chain contract.
 */
async function getArbitratorCount() {
  if (!ARBITRATOR_REGISTRY_CONTRACT_ID) return 0;
  try {
    const result = await readRegistryValue("get_arbitrator_count");
    if (!result) return 0;
    const scVals = result.retval ? [result.retval] : (result.results || []);
    if (!scVals.length) return 0;
    return Number(scValToNative(scVals[0])) || 0;
  } catch {
    return 0;
  }
}

/**
 * Get detailed info for a specific arbitrator from the on-chain contract.
 */
async function getArbitratorInfo(address) {
  if (!ARBITRATOR_REGISTRY_CONTRACT_ID) return null;
  try {
    const result = await readRegistryValue("get_arbitrator", [
      nativeToScVal(address, { type: "address" }),
    ]);
    if (!result) return null;
    const scVals = result.retval ? [result.retval] : (result.results || []);
    if (!scVals.length) return null;
    const info = scValToNative(scVals[0]);
    return {
      active: info.active,
      stakedAmount: String(info.staked_amount || 0),
      metadataUri: info.metadata_uri || "",
      registeredAt: info.registered_at || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Get the combined list: on-chain active addresses enriched with
 * off-chain metadata (display name, bio) from the dao_arbitrators table.
 * Uses the last successful list when the contract is unreachable.
 */
async function listArbitrators() {
  if (ARBITRATOR_REGISTRY_CONTRACT_ID) {
    try {
      const chainAddresses = await getArbitratorAddresses();
      let arbitrators;

      if (chainAddresses.length > 0) {
        const { rows } = await pool.query(
          `SELECT public_key, display_name, bio, disputes_resolved
           FROM dao_arbitrators
           WHERE public_key = ANY($1)`,
          [chainAddresses],
        );
        const dbMap = {};
        for (const row of rows) {
          dbMap[row.public_key] = row;
        }
        arbitrators = chainAddresses.map((key) => ({
          publicKey: key,
          displayName: dbMap[key]?.display_name || null,
          bio: dbMap[key]?.bio || null,
          disputesResolved: Number(dbMap[key]?.disputes_resolved || 0),
          onChain: true,
        }));
      } else {
        arbitrators = await getDbArbitrators();
      }

      await cache.set(
        ARBITRATOR_LIST_CACHE_KEY,
        arbitrators,
        ARBITRATOR_LIST_CACHE_TTL,
      );
      return arbitrators;
    } catch (error) {
      const cachedArbitrators = await cache.get(ARBITRATOR_LIST_CACHE_KEY);
      if (Array.isArray(cachedArbitrators)) return cachedArbitrators;
      if (error.isSorobanRegistryError) {
        throw registryUnavailableError();
      }
      throw error;
    }
  }

  return getDbArbitrators();
}

async function getDbArbitrators() {
  const { rows } = await pool.query(
    `SELECT public_key, display_name, bio, disputes_resolved, votes_received, elected_at
     FROM dao_arbitrators WHERE active = true
     ORDER BY votes_received DESC, created_at ASC`,
  );
  return rows.map((r) => ({
    publicKey: r.public_key,
    displayName: r.display_name,
    bio: r.bio,
    disputesResolved: Number(r.disputes_resolved || 0),
    onChain: false,
  }));
}

module.exports = {
  getArbitratorAddresses,
  isArbitrator,
  getArbitratorCount,
  getArbitratorInfo,
  listArbitrators,
  ARBITRATOR_REGISTRY_CONTRACT_ID,
};
