"use strict";
// JSON Schema for screening_answers JSONB field on applications
module.exports = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  maxProperties: 20,
  additionalProperties: { type: "string", maxLength: 2000 },
};
