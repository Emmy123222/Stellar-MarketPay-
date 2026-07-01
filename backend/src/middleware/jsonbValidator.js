/**
 * src/middleware/jsonbValidator.js
 * JSONB depth-limit + AJV schema validation middleware (Issue #456).
 *
 * Usage:
 *   const { validateJsonb } = require('../middleware/jsonbValidator');
 *   router.post('/', validateJsonb({ milestones: milestonesSchema }), handler);
 */
"use strict";

const Ajv = require("ajv");
const { createError, ErrorCodes } = require("../utils/errors");

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Measure the nesting depth of an arbitrary value.
 * Objects and arrays count as one level; primitives are depth 0.
 */
function measureDepth(value, current = 0) {
  if (current > 5) return current; // short-circuit once we know it's too deep
  if (Array.isArray(value)) {
    if (value.length === 0) return current;
    return Math.max(...value.map((v) => measureDepth(v, current + 1)));
  }
  if (value !== null && typeof value === "object") {
    const vals = Object.values(value);
    if (vals.length === 0) return current;
    return Math.max(...vals.map((v) => measureDepth(v, current + 1)));
  }
  return current;
}

/**
 * Format AJV validation errors into a concise list.
 */
function formatAjvErrors(errors) {
  return errors.map((e) => `${e.instancePath || "/"} ${e.message}`);
}

/**
 * Returns an Express middleware that:
 *  1. Enforces a max JSON depth of 5 on the entire req.body.
 *  2. Validates each specified JSONB field against its AJV schema.
 *
 * @param {Object} fieldSchemas  - { fieldName: ajvSchema, ... }
 * @returns {Function} Express middleware
 */
function validateJsonb(fieldSchemas = {}) {
  // Pre-compile validators
  const validators = {};
  for (const [field, schema] of Object.entries(fieldSchemas)) {
    validators[field] = ajv.compile(schema);
  }

  return (req, res, next) => {
    if (!req.body || typeof req.body !== "object") return next();

    // 1. Global depth check
    const depth = measureDepth(req.body);
    if (depth > 5) {
      return next(
        createError(
          ErrorCodes.JSONB_DEPTH_EXCEEDED,
          "Request body nesting depth exceeds the limit of 5",
          400,
          { depth }
        )
      );
    }

    // 2. Per-field schema validation
    for (const [field, validate] of Object.entries(validators)) {
      const value = req.body[field];
      if (value === undefined || value === null) continue; // field is optional

      // Parse string JSONB if needed
      let parsed = value;
      if (typeof value === "string") {
        try {
          parsed = JSON.parse(value);
        } catch {
          return next(
            createError(
              ErrorCodes.JSONB_SCHEMA_INVALID,
              `Field '${field}' is not valid JSON`,
              400,
              { field }
            )
          );
        }
      }

      if (!validate(parsed)) {
        return next(
          createError(
            ErrorCodes.JSONB_SCHEMA_INVALID,
            `Field '${field}' failed schema validation`,
            400,
            { field, errors: formatAjvErrors(validate.errors) }
          )
        );
      }
    }

    next();
  };
}

/**
 * Standalone depth-limit middleware (applied globally or per router).
 * Rejects any request body with nesting depth > 5.
 */
function jsonDepthLimitMiddleware(req, res, next) {
  if (!req.body || typeof req.body !== "object") return next();
  const depth = measureDepth(req.body);
  if (depth > 5) {
    return next(
      createError(
        ErrorCodes.JSONB_DEPTH_EXCEEDED,
        "Request body nesting depth exceeds the limit of 5",
        400,
        { depth }
      )
    );
  }
  next();
}

module.exports = { validateJsonb, jsonDepthLimitMiddleware, measureDepth };
