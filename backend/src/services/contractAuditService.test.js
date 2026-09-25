"use strict";

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });

jest.mock("../db/pool", () => ({
  query: mockQuery,
}));

let originalFetch;
let originalHorizonUrl;

const {
  verifyOnChainTransaction,
  parseSorobanEvents,
  logContractInteraction,
  verifyAndLogContractInteraction,
  getAuditLogsForJob,
} = require("./contractAuditService");

const TX_HASH = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const OFFCHAIN_TX_HASH = "offchain-1234567890";
const ADMIN_TX_HASH = "admin-1234567890";
const CALLER = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const JOB_ID = "job-123";

function makeSuccessfulTxResponse(overrides = {}) {
  return {
    hash: TX_HASH,
    ledger: 12345,
    fee_charged: "100",
    successful: true,
    soroban: {
      events: [
        {
          type: "contract",
          contract_id: "CCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          topic: ["AAAABQAAAAtlc2Nyb3dfcmVsZWFzZQAAAAA=", "AAAABAAAAA=="],
          data: { map: [{ key: { sym: "amount" }, val: { i128: { lo: 500, hi: 0 } } }] },
        },
      ],
    },
    ...overrides,
  };
}

function makeFailedTxResponse(overrides = {}) {
  return {
    hash: TX_HASH,
    ledger: 12345,
    fee_charged: "100",
    successful: false,
    ...overrides,
  };
}

describe("contractAuditService", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    originalFetch = global.fetch;
    originalHorizonUrl = process.env.HORIZON_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalHorizonUrl !== undefined) {
      process.env.HORIZON_URL = originalHorizonUrl;
    } else {
      delete process.env.HORIZON_URL;
    }
  });

  describe("verifyOnChainTransaction", () => {
    it("returns null for offchain- prefixed hashes", async () => {
      const result = await verifyOnChainTransaction(OFFCHAIN_TX_HASH);
      expect(result).toBeNull();
    });

    it("returns null for admin- prefixed hashes", async () => {
      const result = await verifyOnChainTransaction(ADMIN_TX_HASH);
      expect(result).toBeNull();
    });

    it("returns null for undefined txHash", async () => {
      const result = await verifyOnChainTransaction(undefined);
      expect(result).toBeNull();
    });

    it("returns null for empty txHash", async () => {
      const result = await verifyOnChainTransaction("");
      expect(result).toBeNull();
    });

    it("fetches transaction from Horizon and returns parsed data on success", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeSuccessfulTxResponse()),
      });

      const result = await verifyOnChainTransaction(TX_HASH);

      expect(result).not.toBeNull();
      expect(result.ledgerSequence).toBe(12345);
      expect(result.feeCharged).toBe("100");
      expect(Array.isArray(result.eventData)).toBe(true);
      expect(result.eventData.length).toBe(1);
      expect(result.eventData[0].type).toBe("contract");
      expect(result.eventData[0].contract_id).toBe("CCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXX");
    });

    it("fetches transaction with correct Horizon URL", async () => {
      process.env.HORIZON_URL = "https://horizon-custom.stellar.org";
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeSuccessfulTxResponse()),
      });

      await verifyOnChainTransaction(TX_HASH);

      expect(global.fetch).toHaveBeenCalledWith(
        `https://horizon-custom.stellar.org/transactions/${TX_HASH}`,
      );
    });

    it("throws 502 if transaction is not found on Horizon", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      });

      await expect(verifyOnChainTransaction(TX_HASH)).rejects.toMatchObject({
        message: "Transaction not found on Stellar network",
        status: 502,
      });
    });

    it("throws 502 if Horizon returns an error", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      await expect(verifyOnChainTransaction(TX_HASH)).rejects.toMatchObject({
        message: expect.stringContaining("Horizon request failed"),
        status: 502,
      });
    });

    it("throws 502 if transaction failed on-chain", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeFailedTxResponse()),
      });

      await expect(verifyOnChainTransaction(TX_HASH)).rejects.toMatchObject({
        message: "Transaction failed on Stellar network",
        status: 502,
      });
    });

    it("throws 502 if fetch throws a network error", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("Network timeout"));

      await expect(verifyOnChainTransaction(TX_HASH)).rejects.toMatchObject({
        message: expect.stringContaining("Failed to query Stellar Horizon"),
        status: 502,
      });
    });
  });

  describe("parseSorobanEvents", () => {
    it("returns empty array when no soroban field exists", () => {
      const result = parseSorobanEvents({});
      expect(result).toEqual([]);
    });

    it("returns empty array when no events exist", () => {
      const result = parseSorobanEvents({ soroban: { events: [] } });
      expect(result).toEqual([]);
    });

    it("parses Soroban events correctly", () => {
      const tx = makeSuccessfulTxResponse();
      const result = parseSorobanEvents(tx);

      expect(result.length).toBe(1);
      expect(result[0]).toEqual({
        type: "contract",
        contract_id: "CCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        topics: ["AAAABQAAAAtlc2Nyb3dfcmVsZWFzZQAAAAA=", "AAAABAAAAA=="],
        data: { map: [{ key: { sym: "amount" }, val: { i128: { lo: 500, hi: 0 } } }] },
      });
    });

    it("handles multiple events", () => {
      const tx = {
        soroban: {
          events: [
            { type: "contract", contract_id: "C1", topic: ["t1"], data: { val: "a" } },
            { type: "contract", contract_id: "C2", topic: ["t2"], data: { val: "b" } },
          ],
        },
      };
      const result = parseSorobanEvents(tx);

      expect(result.length).toBe(2);
      expect(result[0].contract_id).toBe("C1");
      expect(result[1].contract_id).toBe("C2");
    });
  });

  describe("logContractInteraction", () => {
    it("inserts a row and returns it with basic fields", async () => {
      const insertedRow = {
        id: 1,
        function_name: "release_escrow",
        caller_address: CALLER,
        job_id: JOB_ID,
        tx_hash: TX_HASH,
      };
      mockQuery.mockResolvedValue({ rows: [insertedRow] });

      const result = await logContractInteraction({
        functionName: "release_escrow",
        callerAddress: CALLER,
        jobId: JOB_ID,
        txHash: TX_HASH,
      });

      expect(result).toEqual(insertedRow);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO contract_audit_log"),
        expect.arrayContaining([
          "release_escrow",
          CALLER,
          JOB_ID,
          TX_HASH,
          null,
          null,
          null,
        ]),
      );
    });

    it("inserts a row with all enriched fields", async () => {
      const eventData = [{ type: "contract", contract_id: "C1", topics: [], data: {} }];
      mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });

      await logContractInteraction({
        functionName: "release_escrow",
        callerAddress: CALLER,
        jobId: JOB_ID,
        txHash: TX_HASH,
        ledgerSequence: 12345,
        feeCharged: "100",
        eventData,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO contract_audit_log"),
        expect.arrayContaining([
          "release_escrow",
          CALLER,
          JOB_ID,
          TX_HASH,
          12345,
          "100",
          JSON.stringify(eventData),
        ]),
      );
    });

    it("returns null for untracked function", async () => {
      const result = await logContractInteraction({
        functionName: "unknown_function",
        callerAddress: CALLER,
        jobId: JOB_ID,
        txHash: TX_HASH,
      });

      expect(result).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("returns null when callerAddress is missing", async () => {
      const result = await logContractInteraction({
        functionName: "release_escrow",
        callerAddress: null,
        jobId: JOB_ID,
        txHash: TX_HASH,
      });

      expect(result).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("returns null when txHash is missing", async () => {
      const result = await logContractInteraction({
        functionName: "release_escrow",
        callerAddress: CALLER,
        jobId: JOB_ID,
        txHash: null,
      });

      expect(result).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("verifyAndLogContractInteraction", () => {
    it("verifies tx and logs with enriched data when tx is valid", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeSuccessfulTxResponse()),
      });
      mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });

      const result = await verifyAndLogContractInteraction({
        functionName: "release_escrow",
        callerAddress: CALLER,
        jobId: JOB_ID,
        txHash: TX_HASH,
      });

      expect(result).toBeDefined();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO contract_audit_log"),
        expect.arrayContaining([
          "release_escrow",
          CALLER,
          JOB_ID,
          TX_HASH,
          12345,
          "100",
        ]),
      );
    });

    it("logs basic data for offchain hashes", async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });

      const result = await verifyAndLogContractInteraction({
        functionName: "release_escrow",
        callerAddress: CALLER,
        jobId: JOB_ID,
        txHash: OFFCHAIN_TX_HASH,
      });

      expect(result).toBeDefined();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO contract_audit_log"),
        expect.arrayContaining([
          "release_escrow",
          CALLER,
          JOB_ID,
          OFFCHAIN_TX_HASH,
          null,
          null,
          null,
        ]),
      );
    });

    it("throws 502 when on-chain transaction failed", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeFailedTxResponse()),
      });

      await expect(
        verifyAndLogContractInteraction({
          functionName: "release_escrow",
          callerAddress: CALLER,
          jobId: JOB_ID,
          txHash: TX_HASH,
        }),
      ).rejects.toMatchObject({
        message: "Transaction failed on Stellar network",
        status: 502,
      });

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("getAuditLogsForJob", () => {
    it("returns audit logs for a job", async () => {
      const auditRows = [
        { id: 1, function_name: "release_escrow", job_id: JOB_ID },
        { id: 2, function_name: "create_escrow", job_id: JOB_ID },
      ];
      mockQuery.mockResolvedValue({ rows: auditRows });

      const result = await getAuditLogsForJob(JOB_ID);

      expect(result).toEqual(auditRows);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("FROM contract_audit_log"),
        [JOB_ID],
      );
    });

    it("includes new enriched columns in SELECT", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await getAuditLogsForJob(JOB_ID);

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain("ledger_sequence");
      expect(sql).toContain("fee_charged");
      expect(sql).toContain("event_data");
      expect(sql).toContain("success");
    });

    it("returns empty array when no logs exist", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await getAuditLogsForJob(JOB_ID);
      expect(result).toEqual([]);
    });
  });
});
