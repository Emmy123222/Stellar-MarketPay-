/**
 * src/validators/jobValidator.test.js
 */
"use strict";

const {
  validate,
  createJobSchema,
  boostJobSchema,
  extendJobSchema,
  jobReferralSchema,
  reportJobSchema,
  disputeJobSchema,
  bulkCancelJobSchema,
  bulkExtendJobSchema,
  bulkBoostJobSchema,
  inviteJobSchema,
  updateEscrowSchema,
} = require("./jobValidator");

describe("jobValidator schemas", () => {
  describe("createJobSchema", () => {
    it("validates a valid job creation payload", () => {
      const input = {
        title: "Build a Stellar app",
        description: "Need a fullstack dev",
        budget: 500,
        clientAddress: "GABC123456789",
        category: "Web Development",
        skills: ["Stellar", "Node.js"],
      };
      const result = validate(createJobSchema, input);
      expect(result.title).toBe("Build a Stellar app");
      expect(result.budget).toBe(500);
    });

    it("converts numeric string budget to number", () => {
      const input = {
        title: "Job",
        description: "Desc",
        budget: "100",
        clientAddress: "GABC123",
      };
      const result = validate(createJobSchema, input);
      expect(result.budget).toBe(100);
    });

    it("fails when required fields are missing", () => {
      expect(() => validate(createJobSchema, {})).toThrow();
    });
  });

  describe("boostJobSchema", () => {
    it("validates valid boost payload", () => {
      const input = { txHash: "0x123abc", amountXlm: 15 };
      const result = validate(boostJobSchema, input);
      expect(result.txHash).toBe("0x123abc");
    });

    it("fails when txHash is missing", () => {
      expect(() => validate(boostJobSchema, {})).toThrow("Transaction hash is required");
    });
  });

  describe("extendJobSchema", () => {
    it("accepts valid days 7, 14, 30", () => {
      expect(validate(extendJobSchema, { days: 7 }).days).toBe(7);
      expect(validate(extendJobSchema, { days: 14 }).days).toBe(14);
      expect(validate(extendJobSchema, { days: "30" }).days).toBe(30);
    });

    it("rejects invalid days", () => {
      expect(() => validate(extendJobSchema, { days: 10 })).toThrow("Extension days must be 7, 14, or 30");
    });
  });

  describe("jobReferralSchema", () => {
    it("validates referrer address", () => {
      const res = validate(jobReferralSchema, { referrer: "GXXXX" });
      expect(res.referrer).toBe("GXXXX");
    });

    it("throws if referrer missing", () => {
      expect(() => validate(jobReferralSchema, {})).toThrow("Referrer address is required");
    });
  });

  describe("reportJobSchema", () => {
    it("validates report with valid category", () => {
      const res = validate(reportJobSchema, {
        reporterAddress: "G123",
        category: "spam",
        description: "spammy job",
      });
      expect(res.category).toBe("spam");
    });

    it("rejects invalid category", () => {
      expect(() =>
        validate(reportJobSchema, {
          reporterAddress: "G123",
          category: "invalid_cat",
        }),
      ).toThrow("Valid report category is required");
    });
  });

  describe("disputeJobSchema", () => {
    it("validates dispute payload", () => {
      const res = validate(disputeJobSchema, {
        reason: "Incomplete work",
        description: "Freelancer did not finish tasks",
      });
      expect(res.reason).toBe("Incomplete work");
    });

    it("throws when reason is missing", () => {
      expect(() => validate(disputeJobSchema, { description: "Desc" })).toThrow();
    });
  });

  describe("bulkCancelJobSchema", () => {
    it("validates array of jobIds", () => {
      const res = validate(bulkCancelJobSchema, { jobIds: ["job1", "job2"] });
      expect(res.jobIds).toHaveLength(2);
    });

    it("throws when jobIds is empty or not array", () => {
      expect(() => validate(bulkCancelJobSchema, { jobIds: [] })).toThrow("jobIds must be a non-empty array");
    });
  });

  describe("bulkExtendJobSchema", () => {
    it("validates bulk extend payload", () => {
      const res = validate(bulkExtendJobSchema, { jobIds: ["job1"], days: 30 });
      expect(res.jobIds).toEqual(["job1"]);
    });
  });

  describe("bulkBoostJobSchema", () => {
    it("validates bulk boost payload", () => {
      const res = validate(bulkBoostJobSchema, { jobIds: ["job1"], txHash: "tx123" });
      expect(res.txHash).toBe("tx123");
    });

    it("throws if txHash missing", () => {
      expect(() => validate(bulkBoostJobSchema, { jobIds: ["job1"] })).toThrow("txHash is required for bulk boost");
    });
  });

  describe("inviteJobSchema", () => {
    it("validates freelancerAddress", () => {
      const res = validate(inviteJobSchema, { freelancerAddress: "GFL123" });
      expect(res.freelancerAddress).toBe("GFL123");
    });
  });

  describe("updateEscrowSchema", () => {
    it("validates escrowContractId", () => {
      const res = validate(updateEscrowSchema, { escrowContractId: "ESC123" });
      expect(res.escrowContractId).toBe("ESC123");
    });
  });
});
