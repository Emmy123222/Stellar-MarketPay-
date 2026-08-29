/**
 * src/validators/profileMigrationValidator.js
 * Zod schemas for the account-merge (identity migration) endpoint — Issue #885.
 */
"use strict";

const { z } = require("zod");
const { validate } = require("./index");

const STELLAR_ADDRESS = /^G[A-Z0-9]{55}$/;
// ed25519 signature = 64 bytes → 128 hex chars, or 88 base64 chars (same 64 bytes).
const SIGNATURE = /^([0-9a-fA-F]{128}|[0-9a-zA-Z+/]{86}==)$/;

const profileMigrationSchema = z
  .object({
    oldPublicKey: z.string().regex(STELLAR_ADDRESS, "oldPublicKey must be a valid Stellar G-address"),
    newPublicKey: z.string().regex(STELLAR_ADDRESS, "newPublicKey must be a valid Stellar G-address"),
    // Signature over the canonical challenge string by each key's secret key,
    // proving ownership of BOTH accounts (hex or base64-encoded ed25519 sig).
    oldSignature: z.string().regex(SIGNATURE, "oldSignature must be a 64-byte ed25519 signature (128 hex chars or base64)"),
    newSignature: z.string().regex(SIGNATURE, "newSignature must be a 64-byte ed25519 signature (128 hex chars or base64)"),
    network: z.enum(["testnet", "mainnet"]).optional().default("testnet"),
    // ISO timestamp embedded in the challenge string (replay window: 10 min).
    issuedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((d) => d.oldPublicKey !== d.newPublicKey, {
    message: "oldPublicKey and newPublicKey must differ",
  });

/**
 * Validate a migrate-profiles request body.
 * @param {any} data
 * @returns {object} parsed body
 */
function validateProfileMigration(data) {
  return validate(profileMigrationSchema, data);
}

module.exports = { profileMigrationSchema, validateProfileMigration };
