/**
 * src/validators/jobValidator.js
 */
"use strict";

const { z } = require("zod");
const { validate } = require("./index");

const reqStr = (msg) =>
  z.string({ message: msg }).min(1, msg);

const reqArray = (msg) =>
  z.array(z.string(), { message: msg }).min(1, msg);

const createJobSchema = z
  .object({
    title: reqStr("Title is required"),
    description: reqStr("Description is required"),
    budget: z
      .union([z.number(), z.string()])
      .transform((val) => Number(val))
      .refine((val) => !isNaN(val) && val > 0, "Budget must be a positive number"),
    clientAddress: reqStr("clientAddress is required"),
    category: z.string().optional(),
    skills: z.array(z.string()).optional(),
    visibility: z.enum(["public", "private"]).optional().default("public"),
    milestones: z.array(z.any()).optional(),
  })
  .passthrough();

const boostJobSchema = z
  .object({
    txHash: reqStr("Transaction hash is required"),
    amountXlm: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

const extendJobSchema = z
  .object({
    days: z
      .union([z.number(), z.string()])
      .transform((val) => Number(val))
      .refine((val) => [7, 14, 30].includes(val), "Extension days must be 7, 14, or 30"),
  })
  .passthrough();

const jobReferralSchema = z
  .object({
    referrer: reqStr("Referrer address is required"),
  })
  .passthrough();

const reportJobSchema = z
  .object({
    reporterAddress: reqStr("Reporter address is required"),
    category: z
      .string({ message: "Valid report category is required" })
      .refine((val) => ["fraud", "suspicious", "spam", "inappropriate", "other"].includes(val), "Valid report category is required"),
    description: z.string().optional(),
  })
  .passthrough();

const disputeJobSchema = z
  .object({
    reason: reqStr("Reason and description are required"),
    description: reqStr("Reason and description are required"),
  })
  .passthrough();


const bulkCancelJobSchema = z
  .object({
    jobIds: reqArray("jobIds must be a non-empty array"),
  })
  .passthrough();

const bulkExtendJobSchema = z
  .object({
    jobIds: reqArray("jobIds must be a non-empty array"),
    days: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

const bulkBoostJobSchema = z
  .object({
    jobIds: reqArray("jobIds must be a non-empty array"),
    txHash: reqStr("txHash is required for bulk boost"),
  })
  .passthrough();

const inviteJobSchema = z
  .object({
    freelancerAddress: reqStr("freelancerAddress is required"),
  })
  .passthrough();

const updateEscrowSchema = z
  .object({
    escrowContractId: reqStr("escrowContractId is required"),
  })
  .passthrough();

module.exports = {
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
};
