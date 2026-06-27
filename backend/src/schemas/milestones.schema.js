"use strict";
// JSON Schema for the milestones JSONB field on jobs
module.exports = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "array",
  maxItems: 20,
  items: {
    type: "object",
    required: ["description", "amount"],
    additionalProperties: false,
    properties: {
      description: { type: "string", minLength: 1, maxLength: 500 },
      amount:      { type: "string", pattern: "^[0-9]+(\\.[0-9]{1,7})?$" },
      status:      { type: "string", enum: ["pending", "in_progress", "completed", "disputed"] },
      index:       { type: "integer", minimum: 0 },
    },
  },
};
