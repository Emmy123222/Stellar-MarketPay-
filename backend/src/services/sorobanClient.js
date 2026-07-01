"use strict";

const { SorobanRpc, Contract, xdr } = require("@stellar/stellar-sdk");
const { requireEnv } = require("../config/env");

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ||
  (process.env.STELLAR_NETWORK === "mainnet"
    ? "https://rpc.mainnet.stellar.org"
    : "https://rpc-testnet.stellar.org");

let _server = null;

function getServer() {
  if (!_server) {
    _server = new SorobanRpc.Server(SOROBAN_RPC_URL);
  }
  return _server;
}

function getContract(contractId) {
  return new Contract(contractId);
}

async function readContractValue(contractId, method, args = []) {
  const server = getServer();
  const contract = getContract(contractId);

  const result = await server.simulateTransaction(
    new SorobanRpc.TransactionBuilder(undefined, {
      networkPassphrase:
        process.env.STELLAR_NETWORK === "mainnet"
          ? "Public Global Stellar Network ; September 2015"
          : "Test SDF Network ; September 2015",
    })
      .addOperation(contract.call(method, ...args))
      .build(),
  );

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(
      `Soroban simulation failed for ${method}: ${result.error}`,
    );
  }

  return result.result ?? null;
}

module.exports = {
  getServer,
  getContract,
  readContractValue,
  SOROBAN_RPC_URL,
};
