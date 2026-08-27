"use strict";

/**
 * src/routes/nft.test.js
 *
 * Route-level test suite for /api/nft endpoints (Issue #1147).
 * Covers:
 *   - Happy paths with valid payloads
 *   - Authorization rejection (403) when a non-client tries to mint
 *   - Validation failure (400) for malformed bodies and invalid addresses
 *   - Not-found paths (404) for missing jobs / certificates
 *
 * Note: CSRF protection is enforced by doubleCsrfProtection in src/server.js,
 * not inside this router-only test harness — see src/routes/auth.test.js for
 * full-app CSRF coverage. Mutating requests include an X-CSRF-Token header
 * for compatibility with the production middleware contract.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/jobService", () => ({
  getJob: jest.fn(),
}));

jest.mock("../services/contractAuditService", () => ({
  verifyOnChainTransaction: jest.fn().mockResolvedValue({
    ledgerSequence: 12345,
    feeCharged: "100",
    eventData: {},
  }),
}));

jest.mock("../services/auditLogService", () => ({
  insertAuditLog: jest.fn().mockResolvedValue({ id: 1 }),
}));

jest.mock("../services/nftCertificateService", () => ({
  recordCertificate: jest.fn(),
  getCertificateByJob: jest.fn(),
  getCertificatesForFreelancer: jest.fn(),
}));

const pool = require("../db/pool");
const { getJob } = require("../services/jobService");
const { verifyOnChainTransaction } = require("../services/contractAuditService");
const { insertAuditLog } = require("../services/auditLogService");
const {
  recordCertificate,
  getCertificateByJob,
  getCertificatesForFreelancer,
} = require("../services/nftCertificateService");

const express = require("express");
const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");
const nftRoutes = require("./nft");

const app = express();
app.use(express.json());
app.use("/api/nft", nftRoutes);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || "INTERNAL_ERROR",
  });
});

const CLIENT_ADDRESS = Keypair.random().publicKey();
const FREELANCER_ADDRESS = Keypair.random().publicKey();
const OTHER_ADDRESS = Keypair.random().publicKey();
const JOB_ID = "job-nft-101";
const TX_HASH = "a".repeat(64);

function completedJob(overrides = {}) {
  return {
    id: JOB_ID,
    title: "Build Soroban escrow UI",
    clientAddress: CLIENT_ADDRESS,
    freelancerAddress: FREELANCER_ADDRESS,
    status: "completed",
    budget: "250.0000000",
    escrowContractId: "C" + "A".repeat(55),
    ...overrides,
  };
}

function certificateRow(overrides = {}) {
  return {
    id: "nft_cert_1",
    job_id: JOB_ID,
    job_title: "Build Soroban escrow UI",
    freelancer_address: FREELANCER_ADDRESS,
    client_address: CLIENT_ADDRESS,
    freelancer_name: "Alice Dev",
    client_name: "Bob Client",
    amount_xlm: "250.0000000",
    completion_date: "2026-08-01T12:00:00.000Z",
    tx_hash: TX_HASH,
    contract_id: "C" + "A".repeat(55),
    created_at: "2026-08-01T12:05:00.000Z",
    ...overrides,
  };
}

describe("NFT Route Suite (/api/nft)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
    verifyOnChainTransaction.mockResolvedValue({
      ledgerSequence: 12345,
      feeCharged: "100",
      eventData: {},
    });
    insertAuditLog.mockResolvedValue({ id: 1 });
  });

  // =========================================================================
  // 1. POST /api/nft/mint-completion-certificate
  // =========================================================================
  describe("POST /api/nft/mint-completion-certificate", () => {
    it("201 — records a completion certificate with a valid payload", async () => {
      getJob.mockResolvedValueOnce(completedJob());
      recordCertificate.mockResolvedValueOnce(certificateRow());

      const res = await request(app)
        .post("/api/nft/mint-completion-certificate")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          jobId: JOB_ID,
          clientAddress: CLIENT_ADDRESS,
          contractTxHash: TX_HASH,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: "nft_cert_1",
        jobId: JOB_ID,
        jobTitle: "Build Soroban escrow UI",
        freelancerAddress: FREELANCER_ADDRESS,
        clientAddress: CLIENT_ADDRESS,
        amountXlm: "250.0000000",
        txHash: TX_HASH,
      });
      expect(res.body.data.verifyUrl).toContain(TX_HASH);
      expect(recordCertificate).toHaveBeenCalled();
      expect(insertAuditLog).toHaveBeenCalled();
    });

    it("403 — rejects mint when caller is not the job client", async () => {
      getJob.mockResolvedValueOnce(completedJob());

      const res = await request(app)
        .post("/api/nft/mint-completion-certificate")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          jobId: JOB_ID,
          clientAddress: OTHER_ADDRESS,
          contractTxHash: TX_HASH,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(
        "Only the job client can record the completion certificate",
      );
      expect(recordCertificate).not.toHaveBeenCalled();
    });

    it("400 — rejects when required fields are missing", async () => {
      const res = await request(app)
        .post("/api/nft/mint-completion-certificate")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({ jobId: JOB_ID });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Missing required fields");
      expect(getJob).not.toHaveBeenCalled();
    });

    it("400 — rejects an invalid client Stellar address", async () => {
      const res = await request(app)
        .post("/api/nft/mint-completion-certificate")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          jobId: JOB_ID,
          clientAddress: "not-a-stellar-key",
          contractTxHash: TX_HASH,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid client Stellar address");
    });

    it("400 — rejects mint when the job is not completed", async () => {
      getJob.mockResolvedValueOnce(completedJob({ status: "in_progress" }));

      const res = await request(app)
        .post("/api/nft/mint-completion-certificate")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          jobId: JOB_ID,
          clientAddress: CLIENT_ADDRESS,
          contractTxHash: TX_HASH,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "Job must be completed before minting a certificate",
      );
      expect(recordCertificate).not.toHaveBeenCalled();
    });

    it("400 — rejects offchain placeholder transaction hashes", async () => {
      getJob.mockResolvedValueOnce(completedJob());

      const res = await request(app)
        .post("/api/nft/mint-completion-certificate")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          jobId: JOB_ID,
          clientAddress: CLIENT_ADDRESS,
          contractTxHash: "offchain-fake-mint",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "A real on-chain mint transaction hash is required",
      );
      expect(recordCertificate).not.toHaveBeenCalled();
    });

    it("404 — returns not found when the job does not exist", async () => {
      getJob.mockResolvedValueOnce(null);

      const res = await request(app)
        .post("/api/nft/mint-completion-certificate")
        .set("X-CSRF-Token", "dummy-csrf-token")
        .send({
          jobId: "job-missing",
          clientAddress: CLIENT_ADDRESS,
          contractTxHash: TX_HASH,
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Job not found");
      expect(recordCertificate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. GET /api/nft/job/:jobId
  // =========================================================================
  describe("GET /api/nft/job/:jobId", () => {
    it("200 — returns the certificate for a job", async () => {
      getCertificateByJob.mockResolvedValueOnce(certificateRow());

      const res = await request(app).get(`/api/nft/job/${JOB_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        id: "nft_cert_1",
        jobId: JOB_ID,
        freelancerAddress: FREELANCER_ADDRESS,
        clientAddress: CLIENT_ADDRESS,
        txHash: TX_HASH,
      });
      expect(getCertificateByJob).toHaveBeenCalledWith(JOB_ID);
    });

    it("404 — returns not found when no certificate exists for the job", async () => {
      getCertificateByJob.mockResolvedValueOnce(null);

      const res = await request(app).get("/api/nft/job/job-with-no-cert");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("No certificate minted for this job");
    });
  });

  // =========================================================================
  // 3. GET /api/nft/freelancer/:publicKey
  // =========================================================================
  describe("GET /api/nft/freelancer/:publicKey", () => {
    it("200 — returns certificates earned by a freelancer", async () => {
      getCertificatesForFreelancer.mockResolvedValueOnce([
        certificateRow(),
        certificateRow({ id: "nft_cert_2", job_id: "job-nft-202" }),
      ]);

      const res = await request(app).get(
        `/api/nft/freelancer/${FREELANCER_ADDRESS}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].id).toBe("nft_cert_1");
      expect(res.body.data[1].jobId).toBe("job-nft-202");
      expect(getCertificatesForFreelancer).toHaveBeenCalledWith(
        FREELANCER_ADDRESS,
      );
    });

    it("200 — returns an empty list when the freelancer has no certificates", async () => {
      getCertificatesForFreelancer.mockResolvedValueOnce([]);

      const res = await request(app).get(
        `/api/nft/freelancer/${FREELANCER_ADDRESS}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("400 — rejects an invalid freelancer Stellar address", async () => {
      const res = await request(app).get("/api/nft/freelancer/not-a-key");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid Stellar address");
      expect(getCertificatesForFreelancer).not.toHaveBeenCalled();
    });
  });
});
