"use strict";

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });

jest.mock("../db/pool", () => ({
  query: mockQuery,
}));

jest.mock("./ipfsService", () => ({
  uploadFile: jest.fn(),
  getGatewayUrl: jest.fn((cid) => `https://gateway.pinata.cloud/ipfs/${cid}`),
}));

const pool = require("../db/pool");
const ipfsService = require("./ipfsService");
const {
  createDispute,
  uploadEvidence,
  resolveDispute,
  getDispute,
  MAX_EVIDENCE_FILES,
  MAX_FILE_SIZE,
  validateIpfsCid,
} = require("./disputeService");

const CLIENT_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const FREELANCER_ADDRESS = "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const ADMIN_ADDRESS = "GADMIN1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF";
const OTHER_ADDRESS = "GCCCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const JOB_ID = "job-456";
const VALID_CID_V0 = "QmYwAPJzv5CZsnAzt8auVZRnApMEfM4kQh6wxbN4p5M6Za";
const VALID_CID_V1 = `bafy${"a".repeat(55)}`;

function makeJob(overrides = {}) {
  return {
    id: JOB_ID,
    title: "Test job",
    status: "in_progress",
    client_address: CLIENT_ADDRESS,
    freelancer_address: FREELANCER_ADDRESS,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvidenceRow(overrides = {}) {
  return {
    id: `ev-${Date.now()}`,
    job_id: JOB_ID,
    uploader_address: CLIENT_ADDRESS,
    file_name: "evidence.pdf",
    file_size: 1024,
    mime_type: "application/pdf",
    ipfs_cid: VALID_CID_V0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("disputeService", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    jest.clearAllMocks();
  });

  describe("createDispute", () => {
    it("allows client to create a dispute", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: "dispute-1",
            job_id: JOB_ID,
            raised_by: CLIENT_ADDRESS,
            status: "open",
            created_at: new Date().toISOString(),
          }],
        });

      const result = await createDispute(JOB_ID, CLIENT_ADDRESS);

      expect(result.success).toBe(true);
      expect(result.dispute.status).toBe("open");
    });

    it("allows freelancer to create a dispute", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: "dispute-2",
            job_id: JOB_ID,
            raised_by: FREELANCER_ADDRESS,
            status: "open",
          }],
        });

      const result = await createDispute(JOB_ID, FREELANCER_ADDRESS);

      expect(result.success).toBe(true);
    });

    it("rejects dispute creation by non-participant", async () => {
      pool.query.mockResolvedValueOnce({ rows: [makeJob()] });

      await expect(
        createDispute(JOB_ID, OTHER_ADDRESS),
      ).rejects.toThrow("Only the job client or freelancer can raise a dispute");
    });

    it("rejects duplicate dispute on same job", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [{ id: "existing" }] });

      await expect(
        createDispute(JOB_ID, CLIENT_ADDRESS),
      ).rejects.toThrow("A dispute already exists for this job");
    });

    it("throws 404 when job not found", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        createDispute(JOB_ID, CLIENT_ADDRESS),
      ).rejects.toThrow("Job not found");
    });
  });

  describe("uploadEvidence", () => {
    const fileBuffer = Buffer.from("fake file content");
    const fileName = "evidence.pdf";
    const mimeType = "application/pdf";

    it("uploads evidence successfully", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [{ id: "dispute-1", status: "open" }] })
        .mockResolvedValueOnce({ rows: [{ count: "0" }] })
        .mockResolvedValueOnce({ rows: [makeEvidenceRow()] });

      ipfsService.uploadFile.mockResolvedValue({ cid: VALID_CID_V0 });

      const result = await uploadEvidence(JOB_ID, CLIENT_ADDRESS, fileBuffer, fileName, mimeType);

      expect(result.success).toBe(true);
      expect(result.data.ipfsCid).toBe(VALID_CID_V0);
    });

    it("rejects evidence upload from non-participant", async () => {
      pool.query.mockResolvedValueOnce({ rows: [makeJob()] });

      await expect(
        uploadEvidence(JOB_ID, OTHER_ADDRESS, fileBuffer, fileName, mimeType),
      ).rejects.toThrow("Only the client or freelancer can upload evidence");
    });

    it("rejects evidence when no dispute exists", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        uploadEvidence(JOB_ID, CLIENT_ADDRESS, fileBuffer, fileName, mimeType),
      ).rejects.toThrow("No dispute exists for this job");
    });

    it("rejects evidence upload after dispute resolved", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [{ id: "dispute-1", status: "resolved" }] });

      await expect(
        uploadEvidence(JOB_ID, CLIENT_ADDRESS, fileBuffer, fileName, mimeType),
      ).rejects.toThrow("Cannot upload evidence after dispute has been resolved");
    });

    it("rejects evidence exceeding max file limit", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [{ id: "dispute-1", status: "open" }] })
        .mockResolvedValueOnce({ rows: [{ count: String(MAX_EVIDENCE_FILES) }] });

      await expect(
        uploadEvidence(JOB_ID, CLIENT_ADDRESS, fileBuffer, fileName, mimeType),
      ).rejects.toThrow(`Maximum ${MAX_EVIDENCE_FILES} files allowed per party`);
    });

    it("rejects evidence exceeding 5MB file size", async () => {
      const largeBuffer = Buffer.alloc(MAX_FILE_SIZE + 1);

      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [{ id: "dispute-1", status: "open" }] })
        .mockResolvedValueOnce({ rows: [{ count: "0" }] });

      await expect(
        uploadEvidence(JOB_ID, CLIENT_ADDRESS, largeBuffer, fileName, mimeType),
      ).rejects.toThrow("File size exceeds 5MB limit");
    });

    it("validates IPFS CID from upload response", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [{ id: "dispute-1", status: "open" }] })
        .mockResolvedValueOnce({ rows: [{ count: "0" }] })
        .mockResolvedValueOnce({ rows: [makeEvidenceRow({ ipfs_cid: VALID_CID_V1 })] });

      ipfsService.uploadFile.mockResolvedValue({ cid: VALID_CID_V1 });

      const result = await uploadEvidence(JOB_ID, CLIENT_ADDRESS, fileBuffer, fileName, mimeType);

      expect(result.data.ipfsCid).toBe(VALID_CID_V1);
      expect(result.data.gatewayUrl).toContain(VALID_CID_V1);
    });

    it.each([
      ["short CID", "QmTest123"],
      ["CID with script payload", "<script>alert(1)</script>"],
      ["CID with special characters", "QmYwAPJzv5CZsnAzt8auVZRnApMEfM4kQh6wxbN4p5M!"],
      ["non-string CID", null],
    ])("rejects %s before storing evidence", async (_label, cid) => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [{ id: "dispute-1", status: "open" }] })
        .mockResolvedValueOnce({ rows: [{ count: "0" }] });

      ipfsService.uploadFile.mockResolvedValue({ cid });

      await expect(
        uploadEvidence(JOB_ID, CLIENT_ADDRESS, fileBuffer, fileName, mimeType),
      ).rejects.toMatchObject({
        message: "Invalid IPFS CID returned from upload service",
        status: 422,
      });

      expect(pool.query).toHaveBeenCalledTimes(3);
    });
  });

  describe("validateIpfsCid", () => {
    it.each([VALID_CID_V0, VALID_CID_V1])("accepts valid CID format %s", (cid) => {
      expect(validateIpfsCid(cid)).toBe(cid);
    });

    it("rejects a CID with unexpected length", () => {
      expect(() => validateIpfsCid("bafyshort")).toThrow("Invalid IPFS CID returned from upload service");
    });
  });

  describe("resolveDispute", () => {
    it("admin can resolve dispute with release_funds", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: ADMIN_ADDRESS }] })
        .mockResolvedValueOnce({ rows: [{ id: "dispute-1", status: "open" }] })
        .mockResolvedValueOnce({
          rows: [{
            id: "dispute-1",
            job_id: JOB_ID,
            status: "resolved",
            resolved_by: ADMIN_ADDRESS,
            resolution: "release_funds",
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await resolveDispute(JOB_ID, ADMIN_ADDRESS, "release_funds");

      expect(result.success).toBe(true);
      expect(result.dispute.status).toBe("resolved");
      expect(result.dispute.resolution).toBe("release_funds");
    });

    it("admin can resolve dispute with refund_client", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: ADMIN_ADDRESS }] })
        .mockResolvedValueOnce({ rows: [{ id: "dispute-1", status: "open" }] })
        .mockResolvedValueOnce({
          rows: [{
            id: "dispute-1",
            status: "resolved",
            resolved_by: ADMIN_ADDRESS,
            resolution: "refund_client",
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await resolveDispute(JOB_ID, ADMIN_ADDRESS, "refund_client");

      expect(result.success).toBe(true);
      expect(result.dispute.resolution).toBe("refund_client");
    });

    it("rejects resolution by non-admin", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        resolveDispute(JOB_ID, OTHER_ADDRESS, "release_funds"),
      ).rejects.toThrow("Only an admin can resolve disputes");
    });

    it("rejects invalid resolution value", async () => {
      await expect(
        resolveDispute(JOB_ID, ADMIN_ADDRESS, "invalid_action"),
      ).rejects.toThrow("Resolution must be 'release_funds' or 'refund_client'");
    });

    it("rejects resolving non-existent dispute", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: ADMIN_ADDRESS }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        resolveDispute(JOB_ID, ADMIN_ADDRESS, "release_funds"),
      ).rejects.toThrow("No dispute found for this job");
    });

    it("rejects resolving already resolved dispute", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: ADMIN_ADDRESS }] })
        .mockResolvedValueOnce({ rows: [{ id: "dispute-1", status: "resolved" }] });

      await expect(
        resolveDispute(JOB_ID, ADMIN_ADDRESS, "release_funds"),
      ).rejects.toThrow("Dispute has already been resolved");
    });
  });

  describe("getDispute", () => {
    it("returns dispute with evidence list", async () => {
      const evidenceRows = [
        makeEvidenceRow({ id: "ev-1", file_name: "doc1.pdf" }),
        makeEvidenceRow({ id: "ev-2", file_name: "doc2.pdf", uploader_address: FREELANCER_ADDRESS }),
      ];

      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: evidenceRows });

      const result = await getDispute(JOB_ID);

      expect(result.success).toBe(true);
      expect(result.data.evidence).toHaveLength(2);
      expect(result.data.evidence[0].fileName).toBe("doc1.pdf");
      expect(result.data.evidence[1].fileName).toBe("doc2.pdf");
      expect(result.data.evidence[0].gatewayUrl).toContain("gateway.pinata.cloud");
    });

    it("returns empty evidence list when no evidence uploaded", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await getDispute(JOB_ID);

      expect(result.success).toBe(true);
      expect(result.data.evidence).toEqual([]);
    });

    it("throws 404 when job not found", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(getDispute(JOB_ID)).rejects.toThrow("Job not found");
    });

    it("returns evidence with presigned gateway URLs", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeJob()] })
        .mockResolvedValueOnce({
          rows: [makeEvidenceRow({ ipfs_cid: "QmPresignedUrlTest" })],
        });

      const result = await getDispute(JOB_ID);

      expect(result.data.evidence[0].gatewayUrl).toBe(
        "https://gateway.pinata.cloud/ipfs/QmPresignedUrlTest",
      );
    });
  });
});
