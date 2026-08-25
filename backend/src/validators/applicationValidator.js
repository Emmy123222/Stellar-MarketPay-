/**
 * src/validators/applicationValidator.js
 */
"use strict";

const { z } = require("zod");
const { validate } = require("./index");

const reqStr = (msg) =>
  z.string({ message: msg }).min(1, msg);

const createApplicationSchema = z
  .object({
    jobId: reqStr("jobId is required"),
    proposal: reqStr("proposal is required"),
    bidAmount: z
      .union([z.number(), z.string()])
      .transform((val) => Number(val))
      .refine((val) => !isNaN(val) && val > 0, "bidAmount must be a positive number"),
    freelancerId: z.string().optional(),
    freelancerAddress: z.string().optional(),
    estimatedDuration: z.string().optional(),
    screeningAnswers: z.any().optional(),
  })
  .passthrough();

const closeBiddingSchema = z
  .object({
    clientAddress: reqStr("clientAddress is required"),
  })
  .passthrough();

const revealBidSchema = z
  .object({
    freelancerAddress: reqStr("freelancerAddress is required"),
    bidAmount: z
      .union([z.number(), z.string()])
      .transform((val) => Number(val))
      .refine((val) => !isNaN(val) && val > 0, "bidAmount must be a positive number"),
    nonce: z.union([z.string(), z.number()]).refine((val) => val !== undefined && val !== "", "nonce is required"),
  })
  .passthrough();

const acceptApplicationSchema = z
  .object({
    clientAddress: reqStr("clientAddress is required"),
    contractTxHash: z.string().optional(),
  })
  .passthrough();

const withdrawApplicationSchema = z
  .object({
    freelancerAddress: reqStr("freelancerAddress is required"),
  })
  .passthrough();

module.exports = {
  validate,
  createApplicationSchema,
  closeBiddingSchema,
  revealBidSchema,
  acceptApplicationSchema,
  withdrawApplicationSchema,
};
