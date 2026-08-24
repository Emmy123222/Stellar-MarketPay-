"use strict";

/**
 * src/routes/escrow.test.js
 *
 * Route-level test suite for /api/escrow endpoints (Issue #1143).
 * Covers:
 *   - Happy paths with valid payloads (release, partial_release, milestones, refund, timeout-refund, recurring, verify)
 *   - Authentication / authorization rejection (403) where caller is not client
 *   - Validation failure (400) for malformed bodies and invalid addresses/amounts
 *   - Not-found paths (404) for job/escrow retrieval
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/jobService", () => ({
  getJob: jest.fn(),
  updateJobStatus: jest.fn(),
}));

jest.mock("../services/contractAuditService", () => ({
  logContractInteraction: jest.fn(),
  verifyOnChainTransaction: jest.fn().mockResolvedValue({
    ledgerSequence: 12345,
    feeCharged: "100",
    eventData: {},
  }),
}));

jest.mock("../services/auditLogService", () => ({
  insertAuditLog: jest.fn().mockResolvedValue({ id: 1 }),
}));

jest.mock("../services/notificationService", () => ({
  notifyEscrowEvent: jest.fn().mockResolvedValue(true),
  EVENT_TYPES: {
    ESCROW_RELEASED: "escrow_released",
    REFUND_ISSUED: "refund_issued",
    DISPUTE_OPENED: "dispute_opened",
  },
}));

jest.mock("../services/referralService", () => ({
  processReferralPayout: jest.fn(),
}));

jest.mock("../services/escrowService", () => ({
  timeoutRefund: jest.fn(),
  releaseMilestone: jest.fn(),
  rejectMilestone: jest.fn(),
  disputeMilestone: jest.fn(),
  verifyFreelancerAccount: jest.fn(),
}));

jest.mock("../services/recurringEscrowService", () => ({
  createRecurringEscrow: jest.fn(),
  cancelRecurringEscrow: jest.fn(),
  getRecurringEscrow: jest.fn(),
}));

const pool = require("../db/pool");
const { defaultEscrowRow } = require("../testUtils/pgMock");

const { getJob, updateJobStatus } = require("../services/jobService");
const { processReferralPayout } = require("../services/referralService");
const {
  timeoutRefund,
  releaseMilestone,
  rejectMilestone,
  disputeMilestone,
  verifyFreelancerAccount,
} = require("../services/escrowService");
const {
  createRecurringEscrow,
  cancelRecurringEscrow,
  getRecurringEscrow,
} = require("../services/recurringEscrowService");

const express = require("express");
const request = require("supertest");
const escrowRoutes = require("./escrow");

// Setup minimal Express test application
const app = express();
app.use(express.json());
app.use("/api/escrow", escrowRoutes);

// Structured error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

// Test Stellar Public Keys (valid 56-char G... addresses generated synthetically)
const CLIENT_ADDRESS = "G" + "A".repeat(55);
const FREELANCER_ADDRESS = "G" + "B".repeat(55);
const OTHER_ADDRESS = "G" + "C".repeat(55);
const JOB_ID = "job-101";

describe("Escrow Route Suite (/api/escrow)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. POST /api/escrow/:jobId/release
  // =========================================================================
  describe("POST /api/escrow/:jobId/release", () => {
    it("200 — releases escrow and completes job successfully", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
        freelancerAddress: FREELANCER_ADDRESS,
        status: "in_progress",
        budget: "500",
      });
      processReferralPayout.mockResolvedValue(null);

      const escrow = defaultEscrowRow({
        job_id: JOB_ID,
        client_address: CLIENT_ADDRESS,
        amount_xlm: "500.0000000",
        status: "funded",
      });
      pool.escrows.set(JOB_ID, escrow);

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/release`)
        .send({
          clientAddress: CLIENT_ADDRESS,
          contractTxHash: "tx-release-123",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Escrow released and job completed");
      expect(updateJobStatus).toHaveBeenCalledWith(JOB_ID, "completed");
    });

    it("200 — includes referral bonus in response if applicable", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
        freelancerAddress: FREELANCER_ADDRESS,
        status: "in_progress",
      });
      processReferralPayout.mockResolvedValue({
        referrer: OTHER_ADDRESS,
        bonusXlm: "10.0000000",
      });

      const escrow = defaultEscrowRow({
        job_id: JOB_ID,
        client_address: CLIENT_ADDRESS,
        amount_xlm: "500.0000000",
      });
      pool.escrows.set(JOB_ID, escrow);

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/release`)
        .send({ clientAddress: CLIENT_ADDRESS });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.referralBonus).toEqual({
        referrer: OTHER_ADDRESS,
        bonusXlm: "10.0000000",
      });
    });

    it("400 — rejects when client address format is invalid", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/release`)
        .send({ clientAddress: "INVALID_ADDRESS" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid client address");
    });

    it("403 — rejects when caller is not the job client", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
        status: "in_progress",
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/release`)
        .send({ clientAddress: OTHER_ADDRESS });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Only the job client can release escrow");
    });

    it("400 — rejects when job is not in progress", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
        status: "completed",
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/release`)
        .send({ clientAddress: CLIENT_ADDRESS });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Job is not in progress");
    });

    it("400 — rejects when escrow record is missing", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
        status: "in_progress",
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/release`)
        .send({ clientAddress: CLIENT_ADDRESS });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("No escrow record found for this job");
    });

    it("400 — rejects when escrow amount is zero or invalid", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
        status: "in_progress",
      });

      const escrow = defaultEscrowRow({
        job_id: JOB_ID,
        amount_xlm: "0",
      });
      pool.escrows.set(JOB_ID, escrow);

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/release`)
        .send({ clientAddress: CLIENT_ADDRESS });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Escrow amount is missing or invalid");
    });
  });

  // =========================================================================
  // 2. POST /api/escrow/:jobId/partial_release
  // =========================================================================
  describe("POST /api/escrow/:jobId/partial_release", () => {
    it("200 — partially releases escrow successfully", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
        freelancerAddress: FREELANCER_ADDRESS,
        title: "Web3 Integration",
        currency: "XLM",
        budget: "1000",
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/partial_release`)
        .send({
          clientAddress: CLIENT_ADDRESS,
          contractTxHash: "tx-partial-123",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Escrow released and job completed");
    });

    it("400 — rejects partial release for malformed client address", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/partial_release`)
        .send({ clientAddress: "SHORT" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid client address");
    });

    it("403 — rejects when caller is not job client", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/partial_release`)
        .send({ clientAddress: OTHER_ADDRESS });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Only the job client can release milestones");
    });
  });

  // =========================================================================
  // 3. POST /api/escrow/:jobId/release-milestone
  // =========================================================================
  describe("POST /api/escrow/:jobId/release-milestone", () => {
    it("200 — releases a milestone successfully", async () => {
      releaseMilestone.mockResolvedValue({
        milestoneIndex: 0,
        status: "released",
        amount: "250",
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/release-milestone`)
        .send({
          clientAddress: CLIENT_ADDRESS,
          milestoneIndex: 0,
          contractTxHash: "tx-milestone-1",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("released");
      expect(releaseMilestone).toHaveBeenCalledWith(JOB_ID, 0, CLIENT_ADDRESS, "tx-milestone-1");
    });

    it("400 — rejects when client address is invalid", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/release-milestone`)
        .send({ clientAddress: "INVALID" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid client address");
    });
  });

  // =========================================================================
  // 4. POST /api/escrow/:jobId/reject-milestone
  // =========================================================================
  describe("POST /api/escrow/:jobId/reject-milestone", () => {
    it("200 — rejects a milestone and returns updated status", async () => {
      rejectMilestone.mockResolvedValue({
        milestoneIndex: 1,
        status: "rejected",
        refundedAmount: "300",
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/reject-milestone`)
        .send({
          clientAddress: CLIENT_ADDRESS,
          milestoneIndex: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("rejected");
      expect(rejectMilestone).toHaveBeenCalledWith(JOB_ID, 1, CLIENT_ADDRESS, undefined);
    });

    it("400 — rejects when client address is missing or invalid", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/reject-milestone`)
        .send({ milestoneIndex: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid client address");
    });
  });

  // =========================================================================
  // 5. POST /api/escrow/:jobId/dispute-milestone
  // =========================================================================
  describe("POST /api/escrow/:jobId/dispute-milestone", () => {
    it("200 — raises dispute for milestone", async () => {
      disputeMilestone.mockResolvedValue({
        milestoneIndex: 0,
        status: "disputed",
        raisedBy: FREELANCER_ADDRESS,
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/dispute-milestone`)
        .send({
          raisedBy: FREELANCER_ADDRESS,
          milestoneIndex: 0,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("disputed");
      expect(disputeMilestone).toHaveBeenCalledWith(JOB_ID, 0, FREELANCER_ADDRESS);
    });

    it("400 — rejects dispute with invalid wallet address", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/dispute-milestone`)
        .send({ raisedBy: "BAD_WALLET", milestoneIndex: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid wallet address");
    });
  });

  // =========================================================================
  // 6. POST /api/escrow/:jobId/refund
  // =========================================================================
  describe("POST /api/escrow/:jobId/refund", () => {
    it("200 — processes client escrow refund", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
        freelancerAddress: FREELANCER_ADDRESS,
        title: "Escrow Test",
        budget: "400",
        currency: "XLM",
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/refund`)
        .send({
          clientAddress: CLIENT_ADDRESS,
          contractTxHash: "tx-refund-123",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Escrow refunded");
    });

    it("403 — rejects refund when caller is not the job client", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/refund`)
        .send({ clientAddress: OTHER_ADDRESS });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Only the job client can refund escrow");
    });
  });

  // =========================================================================
  // 7. POST /api/escrow/:jobId/timeout-refund
  // =========================================================================
  describe("POST /api/escrow/:jobId/timeout-refund", () => {
    it("200 — processes timeout refund when eligible", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
      });
      timeoutRefund.mockResolvedValue({
        success: true,
        message: "Timeout refund processed",
        refundedAmount: "500",
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/timeout-refund`)
        .send({
          clientAddress: CLIENT_ADDRESS,
          contractTxHash: "tx-timeout-1",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.refundedAmount).toBe("500");
    });

    it("403 — rejects timeout refund when caller is not client", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/timeout-refund`)
        .send({ clientAddress: OTHER_ADDRESS });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Only the job client can request a timeout refund");
    });
  });

  // =========================================================================
  // 8. GET /api/escrow/:jobId
  // =========================================================================
  describe("GET /api/escrow/:jobId", () => {
    it("200 — returns escrow record for existing job", async () => {
      const escrow = defaultEscrowRow({
        job_id: JOB_ID,
        amount_xlm: "750.0000000",
        status: "funded",
      });
      pool.escrows.set(JOB_ID, escrow);

      const res = await request(app).get(`/api/escrow/${JOB_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.job_id).toBe(JOB_ID);
      expect(res.body.data.amount_xlm).toBe("750.0000000");
    });

    it("404 — returns not-found when escrow record does not exist", async () => {
      const res = await request(app).get(`/api/escrow/non-existent-job`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("No escrow record found for this job");
    });
  });

  // =========================================================================
  // 9. POST /api/escrow/:jobId/recurring
  // =========================================================================
  describe("POST /api/escrow/:jobId/recurring", () => {
    const validRecurringBody = {
      clientAddress: CLIENT_ADDRESS,
      freelancerAddress: FREELANCER_ADDRESS,
      contractId: "C123456",
      amountPerRelease: "100",
      currency: "XLM",
      intervalDays: 14,
      totalReleases: 4,
    };

    it("200 — creates recurring escrow successfully", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
      });
      createRecurringEscrow.mockResolvedValue({
        id: "recurring-1",
        jobId: JOB_ID,
        totalReleases: 4,
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/recurring`)
        .send(validRecurringBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Recurring escrow created successfully");
      expect(res.body.data.id).toBe("recurring-1");
    });

    it("400 — rejects invalid client address", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/recurring`)
        .send({ ...validRecurringBody, clientAddress: "BAD_CLIENT" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid client address");
    });

    it("400 — rejects invalid freelancer address", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/recurring`)
        .send({ ...validRecurringBody, freelancerAddress: "BAD_FREELANCER" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid freelancer address");
    });

    it("400 — rejects non-positive amountPerRelease", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/recurring`)
        .send({ ...validRecurringBody, amountPerRelease: "0" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Amount per release must be positive");
    });

    it("400 — rejects non-positive intervalDays", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/recurring`)
        .send({ ...validRecurringBody, intervalDays: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Interval days must be positive");
    });

    it("400 — rejects non-positive totalReleases", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/recurring`)
        .send({ ...validRecurringBody, totalReleases: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Total releases must be positive");
    });

    it("403 — rejects when caller is not the job client", async () => {
      getJob.mockResolvedValue({
        id: JOB_ID,
        clientAddress: CLIENT_ADDRESS,
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/recurring`)
        .send({ ...validRecurringBody, clientAddress: OTHER_ADDRESS });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Only the job client can create recurring escrow");
    });
  });

  // =========================================================================
  // 10. POST /api/escrow/:jobId/recurring/cancel
  // =========================================================================
  describe("POST /api/escrow/:jobId/recurring/cancel", () => {
    it("200 — cancels recurring escrow", async () => {
      cancelRecurringEscrow.mockResolvedValue({
        message: "Recurring escrow cancelled",
        refundAmount: 200,
      });

      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/recurring/cancel`)
        .send({ clientAddress: CLIENT_ADDRESS });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Recurring escrow cancelled");
    });

    it("400 — rejects cancel with invalid client address", async () => {
      const res = await request(app)
        .post(`/api/escrow/${JOB_ID}/recurring/cancel`)
        .send({ clientAddress: "INVALID" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid client address");
    });
  });

  // =========================================================================
  // 11. GET /api/escrow/:jobId/recurring
  // =========================================================================
  describe("GET /api/escrow/:jobId/recurring", () => {
    it("200 — returns recurring escrow details", async () => {
      getRecurringEscrow.mockResolvedValue({
        jobId: JOB_ID,
        totalReleases: 4,
        releasesCompleted: 1,
      });

      const res = await request(app).get(`/api/escrow/${JOB_ID}/recurring`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalReleases).toBe(4);
    });
  });

  // =========================================================================
  // 12. POST /api/escrow/verify-freelancer
  // =========================================================================
  describe("POST /api/escrow/verify-freelancer", () => {
    it("200 — verifies that freelancer account exists", async () => {
      verifyFreelancerAccount.mockResolvedValue(true);

      const res = await request(app)
        .post("/api/escrow/verify-freelancer")
        .send({ freelancerAddress: FREELANCER_ADDRESS });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        freelancerAddress: FREELANCER_ADDRESS,
        exists: true,
      });
      expect(verifyFreelancerAccount).toHaveBeenCalledWith(FREELANCER_ADDRESS);
    });

    it("400 — rejects when freelancerAddress is missing", async () => {
      const res = await request(app)
        .post("/api/escrow/verify-freelancer")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("freelancerAddress is required");
    });
  });
});
