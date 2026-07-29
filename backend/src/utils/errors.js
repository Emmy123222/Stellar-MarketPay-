/**
 * src/utils/errors.js
 * Centralized error codes and factory helper for structured API error responses.
 *
 * Response shape: { error: { code, message, details? } }
 */
"use strict";

/**
 * Machine-readable error code enum.
 * Frontend can map these to user-facing strings.
 */
const ErrorCodes = {
  // Generic
  INTERNAL_SERVER_ERROR:        "INTERNAL_SERVER_ERROR",
  VALIDATION_ERROR:             "VALIDATION_ERROR",
  NOT_FOUND:                    "NOT_FOUND",
  UNAUTHORIZED:                 "UNAUTHORIZED",
  FORBIDDEN:                    "FORBIDDEN",
  RATE_LIMITED:                 "RATE_LIMITED",
  BAD_REQUEST:                  "BAD_REQUEST",

  // Auth
  INVALID_TOKEN:                "INVALID_TOKEN",
  TOKEN_EXPIRED:                "TOKEN_EXPIRED",
  ADDRESS_MISMATCH:             "ADDRESS_MISMATCH",

  // Profile
  PROFILE_NOT_FOUND:            "PROFILE_NOT_FOUND",
  PROFILE_DELETED:              "PROFILE_DELETED",
  ENCRYPTION_KEY_INVALID:       "ENCRYPTION_KEY_INVALID",

  // Jobs
  JOB_NOT_FOUND:                "JOB_NOT_FOUND",
  JOB_ALREADY_EXPIRED:          "JOB_ALREADY_EXPIRED",
  JOB_NOT_OPEN:                 "JOB_NOT_OPEN",

  // Applications
  APPLICATION_NOT_FOUND:        "APPLICATION_NOT_FOUND",
  ALREADY_APPLIED:              "ALREADY_APPLIED",

  // Escrow
  ESCROW_ALREADY_EXISTS:        "ESCROW_ALREADY_EXISTS",
  ESCROW_NOT_FOUND:             "ESCROW_NOT_FOUND",
  INSUFFICIENT_BALANCE:         "INSUFFICIENT_BALANCE",
  ESCROW_ALREADY_RELEASED:      "ESCROW_ALREADY_RELEASED",
  ESCROW_TIMEOUT_NOT_REACHED:   "ESCROW_TIMEOUT_NOT_REACHED",

  // Disputes
  DISPUTE_NOT_FOUND:            "DISPUTE_NOT_FOUND",
  DISPUTE_ALREADY_EXISTS:       "DISPUTE_ALREADY_EXISTS",
  EVIDENCE_LIMIT_REACHED:       "EVIDENCE_LIMIT_REACHED",
  EVIDENCE_NOT_FOUND:           "EVIDENCE_NOT_FOUND",

  // Messages
  MESSAGE_NOT_FOUND:            "MESSAGE_NOT_FOUND",
  MESSAGE_TOO_LONG:             "MESSAGE_TOO_LONG",
  NOT_JOB_PARTICIPANT:          "NOT_JOB_PARTICIPANT",

  // Files / IPFS
  FILE_TOO_LARGE:               "FILE_TOO_LARGE",
  FILE_TYPE_NOT_ALLOWED:        "FILE_TYPE_NOT_ALLOWED",
  PORTFOLIO_LIMIT_REACHED:      "PORTFOLIO_LIMIT_REACHED",
  IPFS_UPLOAD_FAILED:           "IPFS_UPLOAD_FAILED",
  PINATA_NOT_CONFIGURED:        "PINATA_NOT_CONFIGURED",
  SIGNED_URL_EXPIRED:           "SIGNED_URL_EXPIRED",
  SIGNED_URL_INVALID:           "SIGNED_URL_INVALID",

  // JSONB / Schema
  JSONB_DEPTH_EXCEEDED:         "JSONB_DEPTH_EXCEEDED",
  JSONB_SCHEMA_INVALID:         "JSONB_SCHEMA_INVALID",
};

/**
 * Create a structured error object.
 *
 * @param {string} code      - One of ErrorCodes
 * @param {string} message   - Human-readable message
 * @param {number} statusCode - HTTP status code (default 400)
 * @param {*}     [details]  - Optional extra context (validation errors, etc.)
 * @returns {Error}
 */
function createError(code, message, statusCode = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.status = statusCode;
  if (details !== undefined) err.details = details;
  return err;
}

/**
 * Express error handler middleware that serializes errors into the standard shape.
 * Mount this as the last middleware in server.js.
 *
 *   app.use(structuredErrorHandler);
 */
function structuredErrorHandler(err, req, res, next) {
  void next; // silence eslint no-unused-vars

  const status = err.status || err.statusCode || 500;
  const code   = err.code  || (status === 404 ? ErrorCodes.NOT_FOUND
                             : status === 401 ? ErrorCodes.UNAUTHORIZED
                             : status === 403 ? ErrorCodes.FORBIDDEN
                             : status === 429 ? ErrorCodes.RATE_LIMITED
                             : ErrorCodes.INTERNAL_SERVER_ERROR);

  const body = {
    error: {
      code,
      message: err.message || "Internal server error",
    },
  };

  if (err.details !== undefined) {
    body.error.details = err.details;
  }

  // Don't leak stack traces in production
  if (process.env.NODE_ENV !== "production" && err.stack) {
    body.error._stack = err.stack;
  }

  res.status(status).json(body);
}

module.exports = { ErrorCodes, createError, structuredErrorHandler };
