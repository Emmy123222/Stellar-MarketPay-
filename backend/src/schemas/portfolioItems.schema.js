"use strict";
// JSON Schema for portfolio_items JSONB field on profiles
//
// NOTE: The schema's `required` stays at the minimum set so existing
// rows without verification metadata keep validating. New optional
// fields (`verified`, `verificationError`, `verifiedAt`, `lastCheckedAt`)
// are written by `linkVerificationService` after the user saves the
// profile; the worker reads them but should never trust user-supplied
// values for `verified === true` (re-check every 7 days).
module.exports = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "array",
  maxItems: 10,
  items: {
    type: "object",
    required: ["cid", "fileName", "mimeType", "uploadedAt"],
    additionalProperties: false,
    properties: {
      id:                  { type: "string" },
      title:               { type: "string", maxLength: 200 },
      type:                { type: "string", enum: ["image", "pdf", "document", "other"] },
      cid:                 { type: "string", minLength: 1, maxLength: 200 },
      fileName:            { type: "string", minLength: 1, maxLength: 255 },
      mimeType:            { type: "string", minLength: 1, maxLength: 100 },
      size:                { type: "number", minimum: 0 },
      uploadedAt:          { type: "string" },
      url:                 { type: "string" },
      // ─── Link verification metadata (V17+, written by linkVerificationService) ───
      verified:            { type: "boolean" },
      verificationError:   { type: "string", maxLength: 500 },
      verifiedAt:          { type: "string" },
      lastCheckedAt:       { type: "string" },
    },
  },
};
