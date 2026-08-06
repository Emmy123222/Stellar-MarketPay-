/**
 * src/validators/profileValidator.test.js
 */
"use strict";

const {
  validate,
  upsertProfileSchema,
  notificationPreferencesSchema,
  availabilitySchema,
  priceAlertSchema,
  endorseSkillSchema,
  blockFreelancerSchema,
  encryptionKeySchema,
} = require("./profileValidator");

describe("profileValidator schemas", () => {
  describe("upsertProfileSchema", () => {
    it("validates valid profile payload", () => {
      const input = {
        publicKey: "G12345",
        displayName: "Alice Developer",
        bio: "Senior Rust & Stellar Engineer",
        skills: ["Rust", "Stellar", "Node"],
        hourlyRate: 75,
      };
      const res = validate(upsertProfileSchema, input);
      expect(res.displayName).toBe("Alice Developer");
      expect(res.hourlyRate).toBe(75);
    });
  });

  describe("notificationPreferencesSchema", () => {
    it("validates notification settings", () => {
      const input = {
        email: "dev@example.com",
        emailNotificationsEnabled: true,
        webhookUrl: "https://example.com/webhook",
      };
      const res = validate(notificationPreferencesSchema, input);
      expect(res.email).toBe("dev@example.com");
      expect(res.emailNotificationsEnabled).toBe(true);
    });
  });

  describe("availabilitySchema", () => {
    it("validates availability update", () => {
      const res = validate(availabilitySchema, { availability: "available" });
      expect(res.availability).toBe("available");
    });
  });

  describe("priceAlertSchema", () => {
    it("validates price alert settings", () => {
      const res = validate(priceAlertSchema, {
        minXlmPriceUsd: 0.1,
        maxXlmPriceUsd: 0.5,
        emailNotificationsEnabled: true,
      });
      expect(res.minXlmPriceUsd).toBe(0.1);
    });
  });

  describe("endorseSkillSchema", () => {
    it("validates endorsement payload", () => {
      const res = validate(endorseSkillSchema, {
        skill: "JavaScript",
        endorserAddress: "GEND123",
      });
      expect(res.skill).toBe("JavaScript");
    });

    it("throws if skill is missing", () => {
      expect(() => validate(endorseSkillSchema, {})).toThrow("Skill name is required");
    });
  });

  describe("blockFreelancerSchema", () => {
    it("validates block request", () => {
      const res = validate(blockFreelancerSchema, { address: "GBLK123" });
      expect(res.address).toBe("GBLK123");
    });

    it("throws if address is missing", () => {
      expect(() => validate(blockFreelancerSchema, {})).toThrow("Address is required");
    });
  });

  describe("encryptionKeySchema", () => {
    it("validates 32-byte base64 key", () => {
      const validBase64Key = Buffer.alloc(32, 1).toString("base64");
      const res = validate(encryptionKeySchema, {
        encryptionPublicKey: validBase64Key,
      });
      expect(res.encryptionPublicKey).toBe(validBase64Key);
    });

    it("rejects non-32-byte base64 key", () => {
      const invalidKey = Buffer.alloc(16, 1).toString("base64");
      expect(() =>
        validate(encryptionKeySchema, {
          encryptionPublicKey: invalidKey,
        }),
      ).toThrow("encryptionPublicKey must be a 32-byte X25519 key (base64)");
    });
  });
});
