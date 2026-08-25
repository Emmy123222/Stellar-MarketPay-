/**
 * src/validators/profileValidator.js
 */
"use strict";

const { z } = require("zod");
const { validate } = require("./index");

const reqStr = (msg) =>
  z.string({ message: msg }).min(1, msg);

const upsertProfileSchema = z
  .object({
    publicKey: z.string().optional(),
    displayName: z.string().optional(),
    display_name: z.string().optional(),
    bio: z.string().optional(),
    title: z.string().optional(),
    skills: z.array(z.string()).optional(),
    hourlyRate: z.union([z.number(), z.string()]).optional(),
    hourly_rate: z.union([z.number(), z.string()]).optional(),
    portfolio_items: z.array(z.any()).optional(),
  })
  .passthrough();

const notificationPreferencesSchema = z
  .object({
    email: z.string().optional(),
    emailNotificationsEnabled: z.boolean().optional(),
    webhookUrl: z.string().optional(),
    webhookSecret: z.string().optional(),
  })
  .passthrough();

const availabilitySchema = z
  .object({
    availability: z.union([z.string(), z.boolean(), z.object({})]).optional(),
  })
  .passthrough();

const priceAlertSchema = z
  .object({
    minXlmPriceUsd: z.union([z.number(), z.string()]).optional(),
    maxXlmPriceUsd: z.union([z.number(), z.string()]).optional(),
    emailNotificationsEnabled: z.boolean().optional(),
    email: z.string().optional(),
  })
  .passthrough();

const endorseSkillSchema = z
  .object({
    skill: reqStr("Skill name is required"),
    endorserAddress: z.string().optional(),
  })
  .passthrough();

const blockFreelancerSchema = z
  .object({
    address: reqStr("Address is required"),
  })
  .passthrough();

const encryptionKeySchema = z
  .object({
    encryptionPublicKey: reqStr("encryptionPublicKey is required")
      .refine((val) => {
        try {
          const buf = Buffer.from(val, "base64");
          return buf.length === 32;
        } catch {
          return false;
        }
      }, "encryptionPublicKey must be a 32-byte X25519 key (base64)"),
  })
  .passthrough();

module.exports = {
  validate,
  upsertProfileSchema,
  notificationPreferencesSchema,
  availabilitySchema,
  priceAlertSchema,
  endorseSkillSchema,
  blockFreelancerSchema,
  encryptionKeySchema,
};
