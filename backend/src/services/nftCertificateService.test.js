"use strict";

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });

jest.mock("../db/pool", () => ({
  query: mockQuery,
}));

const {
  recordCertificate,
  getCertificateByJob,
  getCertificatesForFreelancer,
} = require("./nftCertificateService");

const FREELANCER = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const CLIENT = "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const JOB_ID = "job-123";

describe("nftCertificateService", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    jest.clearAllMocks();
  });

  describe("recordCertificate", () => {
    it("inserts a certificate with all metadata and returns the row", async () => {
      const stored = {
        id: "nft_uuid",
        job_id: JOB_ID,
        freelancer_address: FREELANCER,
        client_address: CLIENT,
        job_title: "Build a dApp",
        amount_xlm: "500",
        completion_date: "2026-01-01T00:00:00.000Z",
        tx_hash: "tx-hash-abc",
        contract_id: "CCONTRACT",
        created_at: "2026-01-01T00:00:00.000Z",
      };
      mockQuery.mockResolvedValueOnce({ rows: [stored] });

      const result = await recordCertificate({
        jobId: JOB_ID,
        freelancerAddress: FREELANCER,
        clientAddress: CLIENT,
        jobTitle: "Build a dApp",
        amountXlm: "500",
        completionDate: "2026-01-01T00:00:00.000Z",
        txHash: "tx-hash-abc",
        contractId: "CCONTRACT",
      });

      expect(result).toEqual(stored);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("INSERT INTO nft_certificates");
      expect(sql).toContain("ON CONFLICT (job_id) DO UPDATE");
      expect(params[0]).toMatch(/^nft_/);
      expect(params[1]).toBe(JOB_ID);
      expect(params[2]).toBe(FREELANCER);
      expect(params[3]).toBe(CLIENT);
      expect(params[4]).toBe("Build a dApp");
    });

    it("defaults optional metadata to null", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: "nft_uuid" }] });
      await recordCertificate({
        jobId: JOB_ID,
        freelancerAddress: FREELANCER,
        clientAddress: CLIENT,
        jobTitle: "Build a dApp",
      });
      const params = mockQuery.mock.calls[0][1];
      expect(params[5]).toBeNull(); // amount_xlm
      expect(params[6]).toBeNull(); // completion_date
      expect(params[7]).toBeNull(); // tx_hash
      expect(params[8]).toBeNull(); // contract_id
    });
  });

  describe("getCertificateByJob", () => {
    it("queries with the profile join and returns the row", async () => {
      const row = { job_id: JOB_ID, freelancer_name: "Ada" };
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const result = await getCertificateByJob(JOB_ID);
      expect(result).toEqual(row);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("LEFT JOIN profiles");
      expect(sql).toContain("WHERE nc.job_id = $1");
      expect(params).toEqual([JOB_ID]);
    });

    it("returns null when no certificate exists", async () => {
      const result = await getCertificateByJob(JOB_ID);
      expect(result).toBeNull();
    });
  });

  describe("getCertificatesForFreelancer", () => {
    it("lists certificates for a freelancer, newest first", async () => {
      const rows = [{ job_id: "job-2" }, { job_id: "job-1" }];
      mockQuery.mockResolvedValueOnce({ rows });
      const result = await getCertificatesForFreelancer(FREELANCER);
      expect(result).toEqual(rows);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("ORDER BY nc.created_at DESC");
      expect(params).toEqual([FREELANCER]);
    });
  });
});
