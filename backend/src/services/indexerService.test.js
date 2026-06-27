"use strict";

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
const mockConnect = jest.fn().mockReturnValue({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  release: jest.fn(),
});

jest.mock("../db/pool", () => ({
  query: mockQuery,
  connect: mockConnect,
}));

jest.mock("../config/env", () => ({
  requireEnv: jest.fn((key, options) => options?.fallback || "mocked-env-value"),
  requireChoice: jest.fn((key, choices, options) => options?.fallback || choices[0]),
}));

// Mock @stellar/stellar-sdk Horizon Server
const mockHorizonServer = {
  transactions: jest.fn().mockReturnThis(),
  forAccount: jest.fn().mockReturnThis(),
  cursor: jest.fn().mockReturnThis(),
  stream: jest.fn().mockReturnValue(jest.fn()),
  events: jest.fn().mockReturnThis(),
  operations: jest.fn().mockReturnThis(),
  forTransaction: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  call: jest.fn().mockResolvedValue({ records: [] }),
};

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => mockHorizonServer),
  },
}));

const IndexerService = require("./indexerService");
const escrowService = require("./escrowService");
const { startEscrowTimeoutChecker } = escrowService;

// Spy on timeoutRefund to intercept internal module calls and prevent real execution
jest.spyOn(escrowService, "timeoutRefund").mockImplementation(async () => {
  return { success: true, message: "mocked timeout refund" };
});

describe("IndexerService & Escrow Timeout Checker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockConnect.mockReset();
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(mockClient);
  });

  describe("processEvent", () => {
    it("updates DB when escrow_timeout_refunded event is received", async () => {
      const indexer = new IndexerService({
        platformWallet: "GPlatformWalletAddress",
        contractId: "CContractIdAddress",
      });

      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };
      mockConnect.mockResolvedValue(mockClient);

      const event = {
        contract_id: "CContractIdAddress",
        topic: ["escrow_timeout_refunded", "job-123-uuid"],
        value: { job_id: "job-123-uuid" },
        transaction_hash: "tx-hash-123",
        ledger: 100,
        ledger_closed_at: "2026-06-25T12:00:00Z",
      };

      await indexer.processEvent(event);

      // Verify it queried contract_events table to save the event
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO contract_events"),
        expect.any(Array)
      );

      // Verify the transaction updates the jobs and escrows status
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE jobs SET status = 'cancelled'"),
        ["job-123-uuid"]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE escrows SET status = 'refunded'"),
        ["job-123-uuid"]
      );
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("updates DB when escrow_rf (short symbol) event is received", async () => {
      const indexer = new IndexerService({
        platformWallet: "GPlatformWalletAddress",
        contractId: "CContractIdAddress",
      });

      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };
      mockConnect.mockResolvedValue(mockClient);

      const event = {
        contract_id: "CContractIdAddress",
        topic: ["escrow_rf", "job-123-uuid"],
        value: { job_id: "job-123-uuid" },
        transaction_hash: "tx-hash-123",
        ledger: 100,
        ledger_closed_at: "2026-06-25T12:00:00Z",
      };

      await indexer.processEvent(event);

      // Verify transaction updates jobs and escrows status
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE jobs SET status = 'cancelled'"),
        ["job-123-uuid"]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE escrows SET status = 'refunded'"),
        ["job-123-uuid"]
      );
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    });
  });

  describe("startEscrowTimeoutChecker", () => {
    it("queries expired escrows and calls timeoutRefund", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ job_id: "job-expired-1", client_address: "GClientAddress" }],
      });

      // Trigger the checker manually
      await startEscrowTimeoutChecker();

      // Verify database was queried for funded escrows older than 7 days
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE e.status = 'funded' AND e.created_at + INTERVAL '7 days' < NOW()")
      );

      // Verify timeoutRefund was invoked for the expired escrow
      expect(escrowService.timeoutRefund).toHaveBeenCalledWith("job-expired-1", "GClientAddress");
    });
  });
});
