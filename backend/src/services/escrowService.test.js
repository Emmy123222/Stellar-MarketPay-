"use strict";

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });

jest.mock("../db/pool", () => ({
  query: mockQuery,
}));

jest.mock("./jobService", () => ({
  getJob: jest.fn(),
  recordTimelineEvent: jest.fn(),
}));

jest.mock("./contractAuditService", () => ({
  logContractInteraction: jest.fn(),
  verifyOnChainTransaction: jest.fn().mockResolvedValue(null),
}));

jest.mock("./notificationService", () => ({
  notifyEscrowEvent: jest.fn(),
  EVENT_TYPES: {
    ESCROW_RELEASED: "escrow_released",
    REFUND_ISSUED: "refund_issued",
    DISPUTE_OPENED: "dispute_opened",
  },
}));

jest.mock("./referralService", () => ({
  processReferralPayout: jest.fn(),
}));

jest.mock("./stellarServiceKey", () => ({
  signWithServiceKey: jest.fn(async (_ip, fn) => fn({})),
  getServicePublicKey: jest.fn(() => "GSERVICEPUBLICKEY0000000000000000000000000000000000000000"),
}));

const { getJob,
  recordTimelineEvent,
} = require("./jobService");
const { processReferralPayout } = require("./referralService");
const { notifyEscrowEvent,
  EVENT_TYPES,
} = require("./notificationService");
const {
  releaseFunds,
  refundClient,
  timeoutRefund,
  markDisputed,
  partialRelease,
  releaseMilestone,
  disputeMilestone,
  getEscrow,
  verifyFreelancerAccount,
  requestEscrowExtension,
  approveEscrowExtension,
  ESCROW_TIMEOUT_DAYS,
} = require("./escrowService");

const CLIENT_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const FREELANCER_ADDRESS = "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const OTHER_ADDRESS = "GCCCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const JOB_ID = "job-123";
const TX_HASH = "tx-hash-abc";

function makeJob(overrides = {}) {
  return {
    id: JOB_ID,
    title: "Build a decentralized app",
    clientAddress: CLIENT_ADDRESS,
    freelancerAddress: FREELANCER_ADDRESS,
    budget: "500",
    currency: "XLM",
    status: "in_progress",
    createdAt: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("escrowService", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    jest.clearAllMocks();
  });

  describe("releaseFunds", () => {
    it("releases funds to freelancer on approval", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ amount_xlm: "500" }] });
      processReferralPayout.mockResolvedValue(null);

      const result = await releaseFunds(JOB_ID, CLIENT_ADDRESS, TX_HASH);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Escrow released");
      expect(processReferralPayout).toHaveBeenCalledWith(
        JOB_ID,
        FREELANCER_ADDRESS,
        "500",
        TX_HASH,
      );
    });

    it("rejects release by non-client", async () => {
      getJob.mockResolvedValue(makeJob());

      await expect(
        releaseFunds(JOB_ID, OTHER_ADDRESS, TX_HASH),
      ).rejects.toMatchObject({ message: "Only the job client can release escrow", status: 403 });
    });

    it("rejects double-release of same escrow", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [{ status: "completed" }] });

      await expect(
        releaseFunds(JOB_ID, CLIENT_ADDRESS, TX_HASH),
      ).rejects.toThrow("Escrow already released");
    });

    it("rejects release when job is not in_progress", async () => {
      getJob.mockResolvedValue(makeJob({ status: "open" }));

      await expect(
        releaseFunds(JOB_ID, CLIENT_ADDRESS, TX_HASH),
      ).rejects.toMatchObject({ message: "Job is not in progress", status: 400 });
    });
  });

  describe("refundClient", () => {
    it("refunds client when job is cancelled before start", async () => {
      getJob.mockResolvedValue(makeJob({ status: "open" }));

      const result = await refundClient(JOB_ID, CLIENT_ADDRESS, TX_HASH);

      expect(result.success).toBe(true);
      expect(result.message).toContain("refunded");
    });

    it("rejects refund by non-client", async () => {
      getJob.mockResolvedValue(makeJob());

      await expect(
        refundClient(JOB_ID, OTHER_ADDRESS, TX_HASH),
      ).rejects.toThrow("Only the job client can refund escrow");
    });

    it("rejects double-refund", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [{ status: "refunded" }] });

      await expect(
        refundClient(JOB_ID, CLIENT_ADDRESS, TX_HASH),
      ).rejects.toThrow("Escrow already released");
    });
  });

  describe("timeoutRefund", () => {
    it("refunds client after 7-day timeout", async () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      getJob.mockResolvedValue(makeJob({
        createdAt: oldDate.toISOString(),
        created_at: oldDate.toISOString(),
      }));

      const result = await timeoutRefund(JOB_ID, CLIENT_ADDRESS, TX_HASH);

      expect(result.success).toBe(true);
      expect(result.message).toContain("timeout");
    });

    it("rejects timeout refund before 7 days elapse", async () => {
      const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      getJob.mockResolvedValue(makeJob({
        createdAt: recentDate.toISOString(),
        created_at: recentDate.toISOString(),
      }));

      await expect(
        timeoutRefund(JOB_ID, CLIENT_ADDRESS, TX_HASH),
      ).rejects.toThrow(`${ESCROW_TIMEOUT_DAYS}-day timeout has not elapsed`);
    });

    it("rejects timeout refund by non-client", async () => {
      getJob.mockResolvedValue(makeJob());

      await expect(
        timeoutRefund(JOB_ID, OTHER_ADDRESS, TX_HASH),
      ).rejects.toThrow("Only the job client can request a timeout refund");
    });
  });

  describe("markDisputed", () => {
    it("marks escrow as disputed when dispute raised", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: "dispute-1",
            job_id: JOB_ID,
            raised_by: FREELANCER_ADDRESS,
            status: "open",
          }],
        });

      const result = await markDisputed(JOB_ID, FREELANCER_ADDRESS);

      expect(result.success).toBe(true);
      expect(result.dispute.status).toBe("open");
      expect(notifyEscrowEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "dispute_opened", jobId: JOB_ID }),
      );
    });

    it("rejects dispute raised by non-participant", async () => {
      getJob.mockResolvedValue(makeJob());

      await expect(
        markDisputed(JOB_ID, OTHER_ADDRESS),
      ).rejects.toThrow("Only the client or freelancer can raise a dispute");
    });

    it("rejects duplicate dispute on same job", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [{ id: "existing-dispute" }] });

      await expect(
        markDisputed(JOB_ID, FREELANCER_ADDRESS),
      ).rejects.toThrow("A dispute already exists for this job");
    });
  });

  describe("partialRelease", () => {
    it("handles partial release for milestones", async () => {
      getJob.mockResolvedValue(makeJob());

      const result = await partialRelease(JOB_ID, CLIENT_ADDRESS, TX_HASH);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Milestone 1 released");
    });

    it("rejects partial release by non-client", async () => {
      getJob.mockResolvedValue(makeJob());

      await expect(
        partialRelease(JOB_ID, OTHER_ADDRESS, TX_HASH),
      ).rejects.toThrow("Only the job client can release milestones");
    });

    it("rejects duplicate partial release", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [{ milestones: [{ description: "Final delivery", amount: "500", status: "released" }] }] });

      await expect(
        partialRelease(JOB_ID, CLIENT_ADDRESS, TX_HASH),
      ).rejects.toThrow("Milestone already released");
    });

    it("releases a selected milestone", async () => {
      getJob.mockResolvedValue(makeJob({
        milestones: [
          { description: "Design", amount: "200", status: "pending" },
          { description: "Build", amount: "300", status: "pending" },
        ],
      }));

      const result = await releaseMilestone(JOB_ID, 1, CLIENT_ADDRESS, TX_HASH);

      expect(result.success).toBe(true);
      expect(result.milestone.description).toBe("Build");
      expect(result.milestone.status).toBe("released");
    });

    it("disputes a selected milestone", async () => {
      getJob.mockResolvedValue(makeJob({
        milestones: [{ description: "Design", amount: "500", status: "pending" }],
      }));
      mockQuery.mockImplementation(async (sql) => {
        const text = sql.replace(/\s+/g, " ").trim();
        if (text.startsWith("INSERT INTO disputes")) {
          return { rows: [{ id: "dispute-1", job_id: JOB_ID, status: "open" }] };
        }
        return { rows: [] };
      });

      const result = await disputeMilestone(JOB_ID, 0, FREELANCER_ADDRESS);

      expect(result.success).toBe(true);
      expect(result.milestone.status).toBe("disputed");
    });
  });

  describe("getEscrow", () => {
    it("returns escrow data for a valid job", async () => {
      const escrowData = {
        job_id: JOB_ID,
        amount_xlm: "500",
        status: "held",
      };
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [escrowData] });

      const result = await getEscrow(JOB_ID);

      expect(result).toEqual(escrowData);
    });

    it("throws 404 when escrow not found", async () => {
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [] });

      await expect(getEscrow(JOB_ID)).rejects.toThrow(
        "No escrow record found for this job",
      );
    });
  });

  describe("verifyFreelancerAccount", () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("returns true when freelancer account exists on Stellar", async () => {
      global.fetch.mockResolvedValueOnce({ ok: true });

      const result = await verifyFreelancerAccount(FREELANCER_ADDRESS);
      expect(result).toBe(true);
    });

    it("throws 400 when freelancer account is not found on Stellar", async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

      await expect(verifyFreelancerAccount(FREELANCER_ADDRESS)).rejects.toThrow(
        "Freelancer account not found on Stellar network",
      );
    });

    it("throws 400 for invalid Stellar address format", async () => {
      await expect(verifyFreelancerAccount("not-an-address")).rejects.toThrow(
        "Invalid Stellar address",
      );
    });

    it("returns false for non-existent Stellar account", async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

      await expect(verifyFreelancerAccount(FREELANCER_ADDRESS)).rejects.toThrow(
        "Freelancer account not found on Stellar network",
      );
    });

    it("propagates Horizon errors", async () => {
      global.fetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(verifyFreelancerAccount(FREELANCER_ADDRESS)).rejects.toThrow(
        "Failed to verify freelancer account on Stellar network",
      );
    });
  });

  describe("requestEscrowExtension", () => {
    it("requests extension successfully by client", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [] }) // no pending extension
        .mockResolvedValueOnce({ rows: [{ status: "funded", timeout_ledger: 1000 }] }) // escrow
        .mockResolvedValueOnce({
          rows: [{ id: 1, job_id: JOB_ID, requested_by: CLIENT_ADDRESS, new_timeout_ledger: 2000, status: "pending" }],
        });

      const result = await requestEscrowExtension(JOB_ID, CLIENT_ADDRESS, 2000, TX_HASH);

      expect(result.success).toBe(true);
      expect(result.extension.new_timeout_ledger).toBe(2000);
      expect(result.extension.status).toBe("pending");
    });

    it("requests extension successfully by freelancer", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ status: "in_progress", timeout_ledger: 1000 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, job_id: JOB_ID, requested_by: FREELANCER_ADDRESS, new_timeout_ledger: 3000, status: "pending" }],
        });

      const result = await requestEscrowExtension(JOB_ID, FREELANCER_ADDRESS, 3000);

      expect(result.success).toBe(true);
      expect(result.extension.requested_by).toBe(FREELANCER_ADDRESS);
    });

    it("rejects extension request by non-participant", async () => {
      getJob.mockResolvedValue(makeJob());

      await expect(
        requestEscrowExtension(JOB_ID, OTHER_ADDRESS, 2000),
      ).rejects.toMatchObject({ message: "Only the client or freelancer can request an extension", status: 403 });
    });

    it("rejects when a pending extension request already exists", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [{ status: "pending" }] });

      await expect(
        requestEscrowExtension(JOB_ID, CLIENT_ADDRESS, 2000),
      ).rejects.toMatchObject({ message: "A pending extension request already exists for this escrow", status: 400 });
    });

    it("rejects when escrow not found", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        requestEscrowExtension(JOB_ID, CLIENT_ADDRESS, 2000),
      ).rejects.toMatchObject({ message: "No escrow found for this job", status: 404 });
    });

    it("rejects when escrow is not funded or in progress", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ status: "completed", timeout_ledger: 1000 }] });

      await expect(
        requestEscrowExtension(JOB_ID, CLIENT_ADDRESS, 2000),
      ).rejects.toMatchObject({ message: "Extension is only allowed while escrow is funded or in progress", status: 400 });
    });

    it("rejects when new timeout ledger is not greater than current timeout", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ status: "funded", timeout_ledger: 2000 }] });

      await expect(
        requestEscrowExtension(JOB_ID, CLIENT_ADDRESS, 1500),
      ).rejects.toMatchObject({ message: "New timeout ledger must be greater than the current timeout", status: 400 });
    });
  });

  describe("approveEscrowExtension", () => {
    it("approves extension successfully by counterparty", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({
          rows: [{ id: 1, job_id: JOB_ID, requested_by: CLIENT_ADDRESS, new_timeout_ledger: 2500, status: "pending" }],
        })
        .mockResolvedValueOnce({ rows: [{ status: "funded" }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, job_id: JOB_ID, requested_by: CLIENT_ADDRESS, approved_by: FREELANCER_ADDRESS, new_timeout_ledger: 2500, status: "approved" }],
        })
        .mockResolvedValueOnce({ rows: [] }); // update escrows timeout_ledger

      const result = await approveEscrowExtension(JOB_ID, FREELANCER_ADDRESS, TX_HASH);

      expect(result.success).toBe(true);
      expect(result.extension.status).toBe("approved");
      expect(result.extension.approved_by).toBe(FREELANCER_ADDRESS);
    });

    it("rejects approval by the same party who requested it", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({
          rows: [{ id: 1, job_id: JOB_ID, requested_by: CLIENT_ADDRESS, new_timeout_ledger: 2500, status: "pending" }],
        });

      await expect(
        approveEscrowExtension(JOB_ID, CLIENT_ADDRESS),
      ).rejects.toMatchObject({ message: "Cannot approve your own extension request", status: 403 });
    });

    it("rejects approval by non-participant", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({
          rows: [{ id: 1, job_id: JOB_ID, requested_by: CLIENT_ADDRESS, new_timeout_ledger: 2500, status: "pending" }],
        });

      await expect(
        approveEscrowExtension(JOB_ID, OTHER_ADDRESS),
      ).rejects.toMatchObject({ message: "Only the client or freelancer can approve an extension", status: 403 });
    });

    it("rejects approval when no pending request exists", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        approveEscrowExtension(JOB_ID, FREELANCER_ADDRESS),
      ).rejects.toMatchObject({ message: "No pending extension request for this job", status: 404 });
    });

    it("rejects approval when escrow is not funded or in progress", async () => {
      getJob.mockResolvedValue(makeJob());
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({
          rows: [{ id: 1, job_id: JOB_ID, requested_by: CLIENT_ADDRESS, new_timeout_ledger: 2500, status: "pending" }],
        })
        .mockResolvedValueOnce({ rows: [{ status: "completed" }] });

      await expect(
        approveEscrowExtension(JOB_ID, FREELANCER_ADDRESS),
      ).rejects.toMatchObject({ message: "Extension is only allowed while escrow is funded or in progress", status: 400 });
    });
  });
});
