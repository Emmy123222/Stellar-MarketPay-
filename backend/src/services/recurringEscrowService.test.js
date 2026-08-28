"use strict";

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });

jest.mock("../db/pool", () => ({
  query: mockQuery,
}));

jest.mock("./jobService", () => ({
  getJob: jest.fn(),
}));

jest.mock("./contractAuditService", () => ({
  logContractInteraction: jest.fn(),
}));

jest.mock("./notificationService", () => ({
  notifyEscrowEvent: jest.fn(),
  EVENT_TYPES: {
    ESCROW_RELEASED: "escrow_released",
    REFUND_ISSUED: "refund_issued",
  },
}));

jest.mock("./stellarServiceKey", () => ({
  getServicePublicKey: jest.fn(() => "GSERVICEPUBLICKEY0000000000000000000000000000000000000000"),
}));

const { getJob } = require("./jobService");
const { logContractInteraction } = require("./contractAuditService");
const { notifyEscrowEvent } = require("./notificationService");
const { getServicePublicKey } = require("./stellarServiceKey");
const {
  createRecurringEscrow,
  tickRecurringEscrow,
  cancelRecurringEscrow,
} = require("./recurringEscrowService");

const CLIENT_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const FREELANCER_ADDRESS = "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const JOB_ID = "job-123";

function makeJob(overrides = {}) {
  return {
    id: JOB_ID,
    title: "Retainer contract",
    clientAddress: CLIENT_ADDRESS,
    freelancerAddress: FREELANCER_ADDRESS,
    currency: "XLM",
    ...overrides,
  };
}

describe("recurringEscrowService", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    jest.clearAllMocks();
    notifyEscrowEvent.mockResolvedValue(undefined);
    logContractInteraction.mockResolvedValue({ id: 1 });
  });

  describe("createRecurringEscrow", () => {
    it("logs the contract interaction after creating the escrow", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ job_id: JOB_ID, is_recurring: true, releases_remaining: 4 }],
      });

      await createRecurringEscrow({
        jobId: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
        freelancerAddress: FREELANCER_ADDRESS,
        contractId: "contract-1",
        amountPerRelease: 100,
        currency: "XLM",
        intervalDays: 7,
        totalReleases: 4,
      });

      expect(logContractInteraction).toHaveBeenCalledTimes(1);
      expect(logContractInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "create_recurring_escrow",
          callerAddress: CLIENT_ADDRESS,
          jobId: JOB_ID,
          txHash: expect.stringMatching(/^offchain-/),
        }),
      );
    });

    it("does not log when the escrow is not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        createRecurringEscrow({
          jobId: JOB_ID,
          clientAddress: CLIENT_ADDRESS,
          freelancerAddress: FREELANCER_ADDRESS,
          contractId: "contract-1",
          amountPerRelease: 100,
          currency: "XLM",
          intervalDays: 7,
          totalReleases: 4,
        }),
      ).rejects.toMatchObject({ status: 404 });

      expect(logContractInteraction).not.toHaveBeenCalled();
    });
  });

  describe("tickRecurringEscrow", () => {
    it("logs the contract interaction with the service address as caller", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ job_id: JOB_ID, amount_per_release: 100, releases_remaining: 4 }],
        })
        .mockResolvedValueOnce({
          rows: [{ job_id: JOB_ID, releases_remaining: 3 }],
        });
      getJob.mockResolvedValue(makeJob());

      await tickRecurringEscrow(JOB_ID);

      expect(logContractInteraction).toHaveBeenCalledTimes(1);
      expect(logContractInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "release_recurring_escrow",
          callerAddress: getServicePublicKey(),
          jobId: JOB_ID,
          txHash: expect.stringMatching(/^offchain-/),
        }),
      );
    });

    it("logs before notifying so the audit trail is written even if notification is in flight", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ job_id: JOB_ID, amount_per_release: 100, releases_remaining: 1 }],
        })
        .mockResolvedValueOnce({
          rows: [{ job_id: JOB_ID, releases_remaining: 0 }],
        });
      getJob.mockResolvedValue(makeJob());

      const callOrder = [];
      logContractInteraction.mockImplementation(async () => {
        callOrder.push("log");
      });
      notifyEscrowEvent.mockImplementation(async () => {
        callOrder.push("notify");
      });

      await tickRecurringEscrow(JOB_ID);

      expect(callOrder).toEqual(["log", "notify"]);
    });

    it("does not log when there is no active recurring escrow to tick", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(tickRecurringEscrow(JOB_ID)).rejects.toMatchObject({ status: 404 });

      expect(logContractInteraction).not.toHaveBeenCalled();
    });
  });

  describe("cancelRecurringEscrow", () => {
    it("logs the contract interaction with the client as caller", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery.mockResolvedValueOnce({
        rows: [{ job_id: JOB_ID, amount_per_release: 100, releases_remaining: 2 }],
      });

      await cancelRecurringEscrow(JOB_ID, CLIENT_ADDRESS);

      expect(logContractInteraction).toHaveBeenCalledTimes(1);
      expect(logContractInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "cancel_recurring_escrow",
          callerAddress: CLIENT_ADDRESS,
          jobId: JOB_ID,
          txHash: expect.stringMatching(/^offchain-/),
        }),
      );
    });

    it("does not log when the caller is not the client", async () => {
      getJob.mockResolvedValue(makeJob());

      await expect(
        cancelRecurringEscrow(JOB_ID, FREELANCER_ADDRESS),
      ).rejects.toMatchObject({ status: 403 });

      expect(logContractInteraction).not.toHaveBeenCalled();
    });

    it("does not log when there is no active recurring escrow to cancel", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        cancelRecurringEscrow(JOB_ID, CLIENT_ADDRESS),
      ).rejects.toMatchObject({ status: 404 });

      expect(logContractInteraction).not.toHaveBeenCalled();
    });
  });
});
