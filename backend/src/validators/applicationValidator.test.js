/**
 * src/validators/applicationValidator.test.js
 */
"use strict";

const {
  validate,
  createApplicationSchema,
  closeBiddingSchema,
  revealBidSchema,
  acceptApplicationSchema,
  withdrawApplicationSchema,
} = require("./applicationValidator");

describe("applicationValidator schemas", () => {
  describe("createApplicationSchema", () => {
    it("validates valid application payload", () => {
      const input = {
        jobId: "job-123",
        freelancerId: "GFL123",
        proposal: "I can build this app in 5 days",
        bidAmount: 350,
        estimatedDuration: "5 days",
      };
      const result = validate(createApplicationSchema, input);
      expect(result.jobId).toBe("job-123");
      expect(result.bidAmount).toBe(350);
    });

    it("accepts bidAmount as numeric string", () => {
      const input = {
        jobId: "job-123",
        freelancerAddress: "GFL123",
        proposal: "Great proposal",
        bidAmount: "500",
      };
      const result = validate(createApplicationSchema, input);
      expect(result.bidAmount).toBe(500);
    });

    it("fails when bidAmount is <= 0 or missing", () => {
      expect(() =>
        validate(createApplicationSchema, {
          jobId: "job-123",
          freelancerId: "GFL123",
          proposal: "Prop",
          bidAmount: -10,
        }),
      ).toThrow();
    });
  });

  describe("closeBiddingSchema", () => {
    it("validates clientAddress", () => {
      const res = validate(closeBiddingSchema, { clientAddress: "GCLI123" });
      expect(res.clientAddress).toBe("GCLI123");
    });

    it("fails if clientAddress is missing", () => {
      expect(() => validate(closeBiddingSchema, {})).toThrow("clientAddress is required");
    });
  });

  describe("revealBidSchema", () => {
    it("validates bid reveal payload", () => {
      const input = {
        freelancerAddress: "GFL123",
        bidAmount: 200,
        nonce: "secret-nonce-123",
      };
      const res = validate(revealBidSchema, input);
      expect(res.bidAmount).toBe(200);
      expect(res.nonce).toBe("secret-nonce-123");
    });

    it("fails when nonce is missing", () => {
      expect(() =>
        validate(revealBidSchema, {
          freelancerAddress: "GFL123",
          bidAmount: 200,
        }),
      ).toThrow();
    });
  });

  describe("acceptApplicationSchema", () => {
    it("validates accept proposal request", () => {
      const res = validate(acceptApplicationSchema, {
        clientAddress: "GCLI123",
        contractTxHash: "tx-abc",
      });
      expect(res.clientAddress).toBe("GCLI123");
    });
  });

  describe("withdrawApplicationSchema", () => {
    it("validates withdraw request", () => {
      const res = validate(withdrawApplicationSchema, {
        freelancerAddress: "GFL123",
      });
      expect(res.freelancerAddress).toBe("GFL123");
    });
  });
});
