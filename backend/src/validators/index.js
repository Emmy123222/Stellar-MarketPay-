/**
 * src/validators/index.js
 * Centralized validation helper using Zod.
 */
"use strict";

const { z } = require("zod");
const { createError, ErrorCodes } = require("../utils/errors");

/**
 * Validates data against a Zod schema.
 * Throws a structured 400 error if validation fails.
 *
 * @param {import("zod").ZodSchema} schema
 * @param {any} data
 * @returns {any} Validated data
 */
function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const message = firstIssue ? firstIssue.message : "Validation error";
    const err = createError(ErrorCodes.VALIDATION_ERROR, message, 400, result.error.issues);
    throw err;
  }
  return result.data;
}

module.exports = {
  validate,
  z,
};
