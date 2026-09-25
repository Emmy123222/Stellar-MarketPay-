"use strict";

const { createError, ErrorCodes } = require("../utils/errors");

const DEFAULT_REQUEST_SIZE_LIMIT_BYTES = 100 * 1024;

function parseSizeLimit(limit) {
  if (typeof limit === "number" && Number.isFinite(limit)) {
    return limit;
  }

  if (typeof limit !== "string") {
    return DEFAULT_REQUEST_SIZE_LIMIT_BYTES;
  }

  const normalized = limit.trim().toLowerCase();
  const match = normalized.match(/^(\d+)(b|kb|mb)?$/);
  if (!match) {
    return DEFAULT_REQUEST_SIZE_LIMIT_BYTES;
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2] || "b";

  if (unit === "mb") return value * 1024 * 1024;
  if (unit === "kb") return value * 1024;
  return value;
}

function createRequestSizeLimitMiddleware(limit = "100kb") {
  const limitBytes = parseSizeLimit(limit);

  return function requestSizeLimitMiddleware(req, res, next) {
    const header = req.headers["content-length"];
    if (!header) {
      return next();
    }

    const contentLength = Number.parseInt(header, 10);
    if (Number.isNaN(contentLength) || contentLength <= limitBytes) {
      return next();
    }

    return next(
      createError(
        ErrorCodes.FILE_TOO_LARGE,
        `Request body too large. Maximum size is ${limit}.`,
        413,
      ),
    );
  };
}

module.exports = {
  DEFAULT_REQUEST_SIZE_LIMIT_BYTES,
  createRequestSizeLimitMiddleware,
  parseSizeLimit,
};
