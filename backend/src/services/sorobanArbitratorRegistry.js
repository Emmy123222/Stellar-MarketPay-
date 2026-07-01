"use strict";

const { Address, nativeToScVal, scValToNative } = require("@stellar/stellar-sdk");
const { requireEnv } = require("../config/env");
const { readContractValue } = require("./sorobanClient");
const pool = require("../db/pool");

const ARBITRATOR_REGISTRY_CONTRACT_ID = process.env.ARBITRATOR_REGISTRY_CONTRACT_ID;

/**
 * Read the list of active arbitrator addresses from the on-chain contract.
 * Returns an array of Stellar public keys (strings).
 */
async function getArbitratorAddresses() {
  if (!ARBITRATOR_REGISTRY_CONTRACT_ID) {
    return [];
  }
  try {
    const result = await readContractValue(
      ARBITRATOR_REGISTRY_CONTRACT_ID,
      "get_arbitrators",
    );
    if (!result) return [];
    const scVals = result.retval ? [result.retval] : (result.results || []);
    if (!scVals.length) return [];
    const addresses = scValToNative(scVals[0]);
    if (!Array.isArray(addresses)) return [];
    return addresses.map((a) => a.toString());
  } catch {
    return [];
  }
}

/**
 * Check if a specific address is an active arbitrator on-chain.
 */
async function isArbitrator(address) {
  if (!ARBITRATOR_REGISTRY_CONTRACT_ID) {
    return false;
  }
  try {
    const result = await readContractValue(
      ARBITRATOR_REGISTRY_CONTRACT_ID,
      "is_arbitrator",
      [nativeToScVal(address, { type: "address" })],
    );
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
    const result = await readContractValue(
      ARBITRATOR_REGISTRY_CONTRACT_ID,
      "get_arbitrator_count",
    );
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
    const result = await readContractValue(
      ARBITRATOR_REGISTRY_CONTRACT_ID,
      "get_arbitrator",
      [nativeToScVal(address, { type: "address" })],
    );
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
 * Falls back to the DB-only list when the contract is unreachable.
 */
async function listArbitrators() {
  // 1. Try on-chain first
  if (ARBITRATOR_REGISTRY_CONTRACT_ID) {
    const chainAddresses = await getArbitratorAddresses();
    if (chainAddresses.length > 0) {
      // 2. Enrich with DB metadata
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
      return chainAddresses.map((key) => ({
        publicKey: key,
        displayName: dbMap[key]?.display_name || null,
        bio: dbMap[key]?.bio || null,
        disputesResolved: Number(dbMap[key]?.disputes_resolved || 0),
        onChain: true,
      }));
    }
  }

  // 3. Fallback to DB-only
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
