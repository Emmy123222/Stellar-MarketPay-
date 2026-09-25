"use strict";

/**
 * src/routes/disputes.test.js
 *
 * Route-level test suite for /api/disputes endpoints.
 * Covers, per endpoint:
 *   - Happy path
 *   - Authentication rejection where guarded (verifyJWT)
 *   - Validation failure (400)
 *   - Not-found path (404)
 *   - Forbidden path (403)
 *
 * The DB pool is replaced with the shared pgMock. Service calls
 * (sorobanEvidence, ipfsService, disputeService) are mocked at the
 * module level so tests stay fast and deterministic.
 */

jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("../services/sorobanEvidence", () => ({
  getOnchainEvidenceCids: jest.fn(),
  recordEvidenceCidOnChain: jest.fn(),
  resolveContractId: jest.fn(),
  _clearCache: jest.fn(),
}));

jest.mock("../services/ipfsService", () => ({
  uploadFile: jest.fn(),
  getGatewayUrl: jest.fn(),
  generateSignedUrlToken: jest.fn(),
  verifySignedUrlToken: jest.fn(),
  proxyIpfsFile: jest.fn(),
  SIGNED_URL_TTL_SECONDS: 15 * 60,
}));

jest.mock("../services/disputeService", () => ({
  validateIpfsCid: jest.fn(),
}));

const pool = require("../db/pool");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { Readable } = require("stream");
const { JWT_SECRET } = require("../middleware/auth");
const disputeRoutes = require("./disputes");

const { getOnchainEvidenceCids } = require("../services/sorobanEvidence");
const {
  uploadFile,
  getGatewayUrl,
  generateSignedUrlToken,
  verifySignedUrlToken,
  proxyIpfsFile,
} = require("../services/ipfsService");
const { validateIpfsCid } = require("../services/disputeService");

// ── Minimal Express test app ─────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use("/api/disputes", disputeRoutes);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message, code: err.code || "INTERNAL_ERROR" });
});

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CLIENT_ADDRESS = "G" + "A".repeat(55);
const FREELANCER_ADDRESS = "G" + "B".repeat(55);
const OTHER_ADDRESS = "G" + "C".repeat(55);
const JOB_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EVIDENCE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VALID_CID = "QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o";

function makeToken(publicKey = CLIENT_ADDRESS) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
}

/** Seed a job into pgMock's jobs Map */
function seedJob(overrides = {}) {
  const job = {
    id: overrides.id || JOB_ID,
    title: overrides.title || "Build a decentralized app",
    description: overrides.description || "Looking for a full-stack developer.",
    budget: overrides.budget || "500.0000000",
    currency: overrides.currency || "XLM",
    category: overrides.category || "Smart Contracts",
    category_id: overrides.category_id ?? null,
    skills: overrides.skills || [],
    status: overrides.status || "disputed",
    client_address: overrides.client_address || CLIENT_ADDRESS,
    freelancer_address: overrides.freelancer_address || FREELANCER_ADDRESS,
    escrow_contract_id: overrides.escrow_contract_id || null,
    applicant_count: overrides.applicant_count ?? 0,
    share_count: overrides.share_count ?? 0,
    boosted: overrides.boosted ?? false,
    boosted_until: overrides.boosted_until || null,
    deadline: overrides.deadline || null,
    timezone: overrides.timezone || null,
    screening_questions: overrides.screening_questions || [],
    milestones: overrides.milestones || [],
    visibility: overrides.visibility || "public",
    dispute_reason: overrides.dispute_reason || null,
    dispute_description: overrides.dispute_description || null,
    disputed_by: overrides.disputed_by || null,
    disputed_at: overrides.disputed_at || null,
    expires_at: overrides.expires_at || null,
    extended_count: overrides.extended_count ?? null,
    extended_until: overrides.extended_until || null,
    bidding_closed_at: overrides.bidding_closed_at || null,
    view_count: overrides.view_count ?? 0,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    deleted_at: overrides.deleted_at || null,
  };
  pool.jobs.set(job.id, job);
  return job;
}

/** Helper to build a fake evidence row returned by the dispute_evidence query */
function fakeEvidenceRow(overrides = {}) {
  return {
    id: overrides.id || EVIDENCE_ID,
    uploader_address: overrides.uploader_address || CLIENT_ADDRESS,
    file_name: overrides.file_name || "document.pdf",
    file_size: overrides.file_size || 1024,
    mime_type: overrides.mime_type || "application/pdf",
    ipfs_cid: overrides.ipfs_cid || VALID_CID,
    created_at: overrides.created_at || new Date().toISOString(),
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Dispute Routes Suite (/api/disputes)", () => {
  beforeEach(() => {
    pool.reset();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // 1. GET /api/disputes/:jobId/onchain-cids
  // ===========================================================================
  describe("GET /api/disputes/:jobId/onchain-cids", () => {
    it("200 — happy path: returns on-chain CIDs", async () => {
      seedJob();
      getOnchainEvidenceCids.mockResolvedValue([VALID_CID, "QmAnotherCid12345678901234567890123456789012"]);

      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/onchain-cids`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.jobId).toBe(JOB_ID);
      expect(res.body.data.cids).toHaveLength(2);
      expect(getOnchainEvidenceCids).toHaveBeenCalledWith(JOB_ID);
    });

    it("200 — returns empty array when no on-chain CIDs", async () => {
      seedJob();
      getOnchainEvidenceCids.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/onchain-cids`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(200);
      expect(res.body.data.cids).toEqual([]);
    });

    it("404 — returns 404 when job not found", async () => {
      getOnchainEvidenceCids.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/disputes/non-existent-job/onchain-cids")
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Job not found/);
    });
  });

  // ===========================================================================
  // 2. GET /api/disputes/:jobId — dispute details with evidence list
  // ===========================================================================
  describe("GET /api/disputes/:jobId", () => {
    it("200 — happy path: returns job details and evidence list", async () => {
      const job = seedJob();
      getGatewayUrl.mockReturnValue(`https://gateway.pinata.cloud/ipfs/${VALID_CID}`);

      // 1st query: job lookup → return job row
      pool.query.mockResolvedValueOnce({ rows: [job] });
      // 2nd query: evidence list → return evidence rows
      pool.query.mockResolvedValueOnce({ rows: [fakeEvidenceRow()] });

      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.job.id).toBe(JOB_ID);
      expect(res.body.data.evidence).toHaveLength(1);
      expect(res.body.data.evidence[0].fileName).toBe("document.pdf");
    });

    it("200 — returns empty evidence array when no evidence uploaded", async () => {
      const job = seedJob();

      // 1st query: job lookup → return job row
      pool.query.mockResolvedValueOnce({ rows: [job] });
      // 2nd query: evidence list → return empty
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(200);
      expect(res.body.data.evidence).toEqual([]);
    });

    it("404 — returns 404 when job not found", async () => {
      const res = await request(app)
        .get("/api/disputes/non-existent-job")
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Job not found/);
    });
  });

  // ===========================================================================
  // 3. POST /api/disputes/:jobId/evidence — upload evidence file
  // ===========================================================================
  describe("POST /api/disputes/:jobId/evidence", () => {
    it("201 — happy path: uploads file and returns evidence record", async () => {
      const job = seedJob();
      uploadFile.mockResolvedValue({ cid: VALID_CID, size: 1024 });
      validateIpfsCid.mockReturnValue(VALID_CID);
      getGatewayUrl.mockReturnValue(`https://gateway.pinata.cloud/ipfs/${VALID_CID}`);

      // 1st query: job lookup → return job row
      pool.query.mockResolvedValueOnce({ rows: [job] });
      // 2nd query: evidence count → return 0
      pool.query.mockResolvedValueOnce({ rows: [{ count: "0" }] });
      // 3rd query: insert evidence → return evidence row
      pool.query.mockResolvedValueOnce({ rows: [fakeEvidenceRow()] });

      const res = await request(app)
        .post(`/api/disputes/${JOB_ID}/evidence`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .attach("file", Buffer.from("fake-pdf-content"), {
          filename: "document.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fileName).toBe("document.pdf");
      expect(uploadFile).toHaveBeenCalled();
    });

    it("401 — rejects when no JWT is supplied", async () => {
      const res = await request(app)
        .post(`/api/disputes/${JOB_ID}/evidence`)
        .set("X-CSRF-Token", "dummy-token")
        .attach("file", Buffer.from("fake-pdf-content"), {
          filename: "document.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it("400 — rejects when no file is provided", async () => {
      seedJob();
      const res = await request(app)
        .post(`/api/disputes/${JOB_ID}/evidence`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/No file provided/i);
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it("403 — rejects when uploader is not client or freelancer", async () => {
      seedJob();
      const res = await request(app)
        .post(`/api/disputes/${JOB_ID}/evidence`)
        .set("Authorization", `Bearer ${makeToken(OTHER_ADDRESS)}`)
        .set("X-CSRF-Token", "dummy-token")
        .attach("file", Buffer.from("fake-pdf-content"), {
          filename: "document.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/client or freelancer/);
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it("404 — returns 404 when job not found", async () => {
      const res = await request(app)
        .post("/api/disputes/non-existent-job/evidence")
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .attach("file", Buffer.from("fake-pdf-content"), {
          filename: "document.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Job not found/);
    });

    it("400 — rejects when evidence limit reached", async () => {
      const job = seedJob();

      // 1st query: job lookup → return job row
      pool.query.mockResolvedValueOnce({ rows: [job] });
      // 2nd query: evidence count → return 5 (at limit)
      pool.query.mockResolvedValueOnce({ rows: [{ count: "5" }] });

      const res = await request(app)
        .post(`/api/disputes/${JOB_ID}/evidence`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token")
        .attach("file", Buffer.from("fake-pdf-content"), {
          filename: "document.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Maximum 5 files/);
      expect(uploadFile).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 4. GET /api/disputes/:jobId/evidence/:id/url — generate signed URL
  // ===========================================================================
  describe("GET /api/disputes/:jobId/evidence/:id/url", () => {
    it("200 — happy path: returns signed URL and expiration", async () => {
      const job = seedJob();
      const mockToken = "signed-jwt-token";
      generateSignedUrlToken.mockReturnValue(mockToken);

      // 1st query: job lookup → return job row
      pool.query.mockResolvedValueOnce({ rows: [job] });
      // 2nd query: evidence by id → return evidence row
      pool.query.mockResolvedValueOnce({ rows: [fakeEvidenceRow()] });
      // 3rd query: audit log insert → return audit row
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/evidence/${EVIDENCE_ID}/url`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toContain(mockToken);
      expect(res.body.data.fileName).toBe("document.pdf");
      expect(res.body.data.mimeType).toBe("application/pdf");
      expect(res.body.data.expiresAt).toBeDefined();
      expect(generateSignedUrlToken).toHaveBeenCalledWith(VALID_CID, JOB_ID, CLIENT_ADDRESS);
    });

    it("401 — rejects when no JWT is supplied", async () => {
      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/evidence/${EVIDENCE_ID}/url`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/);
      expect(generateSignedUrlToken).not.toHaveBeenCalled();
    });

    it("403 — rejects when requester is not client or freelancer", async () => {
      seedJob();
      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/evidence/${EVIDENCE_ID}/url`)
        .set("Authorization", `Bearer ${makeToken(OTHER_ADDRESS)}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/client or freelancer/);
    });

    it("404 — returns 404 when job not found", async () => {
      const res = await request(app)
        .get(`/api/disputes/non-existent-job/evidence/${EVIDENCE_ID}/url`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Job not found/);
    });

    it("404 — returns 404 when evidence not found", async () => {
      const job = seedJob();

      // 1st query: job lookup → return job row
      pool.query.mockResolvedValueOnce({ rows: [job] });
      // 2nd query: evidence by id → return empty
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/evidence/non-existent-id/url`)
        .set("Authorization", `Bearer ${makeToken()}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Evidence not found/);
    });
  });

  // ===========================================================================
  // 5. GET /api/disputes/:jobId/evidence/:id/proxy — proxy IPFS file
  // ===========================================================================
  describe("GET /api/disputes/:jobId/evidence/:id/proxy", () => {
    it("200 — happy path: streams file from IPFS gateway", async () => {
      seedJob();
      const mockToken = "signed-jwt-token";
      const mockPayload = { cid: VALID_CID, jobId: JOB_ID, requesterAddress: CLIENT_ADDRESS };
      verifySignedUrlToken.mockReturnValue(mockPayload);

      const mockStream = Readable.from(["fake-file-content"]);
      proxyIpfsFile.mockResolvedValue({
        stream: mockStream,
        headers: { "content-type": "application/pdf" },
      });

      // 1st query: evidence by id → return evidence row
      pool.query.mockResolvedValueOnce({ rows: [fakeEvidenceRow()] });

      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/evidence/${EVIDENCE_ID}/proxy?token=${mockToken}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(200);
      expect(verifySignedUrlToken).toHaveBeenCalledWith(mockToken);
      expect(proxyIpfsFile).toHaveBeenCalledWith(VALID_CID);
    });

    it("403 — rejects when token is missing", async () => {
      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/evidence/${EVIDENCE_ID}/proxy`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Missing token/);
    });

    it("403 — rejects when token is invalid", async () => {
      const err = Object.assign(new Error("Invalid signed URL"), {
        status: 403,
        code: "SIGNED_URL_INVALID",
      });
      verifySignedUrlToken.mockImplementation(() => { throw err; });

      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/evidence/${EVIDENCE_ID}/proxy?token=invalid-token`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Invalid signed URL/);
    });

    it("404 — returns 404 when evidence not found", async () => {
      const mockToken = "signed-jwt-token";
      const mockPayload = { cid: VALID_CID, jobId: JOB_ID, requesterAddress: CLIENT_ADDRESS };
      verifySignedUrlToken.mockReturnValue(mockPayload);

      // 1st query: evidence by id → return empty
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/evidence/non-existent-id/proxy?token=${mockToken}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Evidence not found/);
    });

    it("403 — rejects when token CID does not match evidence CID", async () => {
      const mockToken = "signed-jwt-token";
      const mockPayload = { cid: "QmDifferentCid12345678901234567890123456789012", jobId: JOB_ID, requesterAddress: CLIENT_ADDRESS };
      verifySignedUrlToken.mockReturnValue(mockPayload);

      // 1st query: evidence by id → return evidence row
      pool.query.mockResolvedValueOnce({ rows: [fakeEvidenceRow()] });

      const res = await request(app)
        .get(`/api/disputes/${JOB_ID}/evidence/${EVIDENCE_ID}/proxy?token=${mockToken}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Token does not match/);
    });
  });
});
