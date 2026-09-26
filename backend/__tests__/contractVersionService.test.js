/**
 * __tests__/contractVersionService.test.js
 *
 * Unit tests for reading the escrow contract's get_version() semver string.
 */
"use strict";

const mockSimulate = jest.fn();
const mockCall = jest.fn();

// The real SDK pulls in ESM-only deps Jest can't load here, so mock the
// pieces the service touches. A retval is modelled as { native: value }.
jest.mock("@stellar/stellar-sdk", () => {
  function TransactionBuilder() {
    this.addOperation = () => this;
    this.setTimeout = () => this;
    this.build = () => ({ tx: true });
  }
  return {
    TransactionBuilder,
    Account: jest.fn(),
    Contract: jest.fn().mockImplementation(() => ({ call: mockCall })),
    scValToNative: (scVal) => scVal.native,
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        simulateTransaction: (...args) => mockSimulate(...args),
      })),
      Api: { isSimulationError: (sim) => "error" in sim },
    },
  };
});

const {
  getContractVersion,
  _resetCache,
} = require("../src/services/contractVersionService");

const CONTRACT_ID = "CBFJNX67NYYRZPLH4YYT77ZUULRJ5NI2LPEYRRLFHBTEACZOZUUYLOGG";

function simulationReturning(value) {
  return { result: { retval: { native: value } } };
}

describe("contractVersionService.getContractVersion", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    _resetCache();
    delete process.env.CONTRACT_ID;
    delete process.env.ESCROW_CONTRACT_ID;
    delete process.env.NEXT_PUBLIC_CONTRACT_ID;
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it("returns null without calling RPC when no contract ID is configured", async () => {
    await expect(getContractVersion()).resolves.toBeNull();
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it("returns the semver string from get_version()", async () => {
    process.env.CONTRACT_ID = CONTRACT_ID;
    mockSimulate.mockResolvedValue(simulationReturning("1.2.0"));

    await expect(getContractVersion()).resolves.toBe("1.2.0");
    expect(mockCall).toHaveBeenCalledWith("get_version");
    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });

  it("caches a successful read", async () => {
    process.env.CONTRACT_ID = CONTRACT_ID;
    mockSimulate.mockResolvedValue(simulationReturning("1.2.0"));

    await getContractVersion();
    await expect(getContractVersion()).resolves.toBe("1.2.0");
    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not cache when simulation fails", async () => {
    process.env.CONTRACT_ID = CONTRACT_ID;
    mockSimulate.mockResolvedValueOnce({ error: "HostError: Not initialized" });
    mockSimulate.mockResolvedValueOnce(simulationReturning("1.3.0"));

    await expect(getContractVersion()).resolves.toBeNull();
    await expect(getContractVersion()).resolves.toBe("1.3.0");
  });

  it("returns null when the RPC call throws", async () => {
    process.env.CONTRACT_ID = CONTRACT_ID;
    mockSimulate.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(getContractVersion()).resolves.toBeNull();
  });
});
