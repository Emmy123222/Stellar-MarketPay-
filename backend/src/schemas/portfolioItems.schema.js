"use strict";
// JSON Schema for portfolio_items JSONB field on profiles
module.exports = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "array",
  maxItems: 10,
  items: {
    type: "object",
    required: ["cid", "fileName", "mimeType", "uploadedAt"],
    additionalProperties: false,
    properties: {
      id:         { type: "string" },
      title:      { type: "string", maxLength: 200 },
      type:       { type: "string", enum: ["image", "pdf", "document", "other"] },
      cid:        { type: "string", minLength: 1, maxLength: 200 },
      fileName:   { type: "string", minLength: 1, maxLength: 255 },
      mimeType:   { type: "string", minLength: 1, maxLength: 100 },
      size:       { type: "number", minimum: 0 },
      uploadedAt: { type: "string" },
      url:        { type: "string" },
    },
  },
};
