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

jest.mock("./referralService", () => ({
  processReferralPayout: jest.fn(),
}));

const { getJob } = require("./jobService");
const { processReferralPayout } = require("./referralService");
const {
  releaseFunds,
  refundClient,
  timeoutRefund,
  markDisputed,
  partialRelease,
  releaseMilestone,
  disputeMilestone,
  getEscrow,
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
      ).rejects.toThrow("Only the job client can release escrow");
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
      ).rejects.toThrow("Job is not in progress");
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
});
