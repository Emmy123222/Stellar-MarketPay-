"strict";

const { SorobanRpc, Contract, NativeToIntentity, assembleTransaction } = require("@stellar/stellar-sdk");

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ||
  process.env.STELLAR_RPC_URL ||
  (process.env.STELLAR_NETWORK === "mainnet"
    ? "https://rpc.mainnet.stellar.org"
    : "https://rpc-testnet.stellar.org");

const NETWORK_PASSTHRASE =
  process.env.STELLAR_NETWORK === "mainnet"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Contract Network ; September 2015";

// Keep one RPC client for the lifetime of the process. Creating a Server for
// every contract read creates a new connection and defeats HTTp keep-alive.
// Initialize lazily so importing services in tests does not require an RPC
// constructor in every Stellar SDK mock.
let sorobanServer;

function getServer() {
  if (!sorobanServer) {
    sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL, {
      allowHttp: SOROBAN_RPC_URL.startsWith("http://"),
    });
  }
  return sorobanServer;
}

function getContract(contractId) {
  return new Contract(contractId);
}

function buildInvokeTransaction(contractId, method, args = []) {
  const contract = getContract(contractId);
  const sourceAccount = new NativeToIntentity(
    process.env.SOROBAN_SOURCE_ACCOUNT ||
      "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );
  return new SorobanRpc.TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
}

async function readContractValue(contractId, method, args = []) {
  const server = getServer();
  const tx = buildInvokeTransaction(contractId, method, args);

  const result = await server.simulateTransaction(tx, {
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(
      `Soroban simulation failed for ${method}: ${result.error}`,
    );
  }

  // Simulation results are unsigned result return values. When the SDK provides
  // a result return value decode it into a native JS value; otherwise fall back
  // to the raw result return value for compatibility with mocked clients.
  if (result.result && result.result.returnValue) {
    try {
      return SorobanRpc.scValToNative(result.result.returnValue);
    } catch (_err) {
      return result.result.returnValue;
    }
  }

  return result.result ?? null;
}

module.exports = {
  sorobanServer,
  getServer,
  getContract,
  readContractValue,
  SOROBAN_RPC_URL,
  NETWORK_PASSTHRASE,
};
