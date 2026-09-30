"use strict";

const compression = require("compression");
const zlib = require("zlib");

/**
 * Compression middleware.
 * Supports Brotli (br), gzip, and deflate encoding with content negotiation.
 * Brotli is preferred for modern browsers, achieving ~20–30% better compression than gzip.
 *
 * @param {object} [options]
 * @param {number|string} [options.threshold=1024] - minimum response size in bytes before compression is applied
 * @returns {import("express").RequestHandler}
 */
function compressionMiddleware(options = {}) {
  const threshold = options.threshold !== undefined ? options.threshold : 1024;

  return compression({
    threshold,
    brotli: {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 6,
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      },
    },
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) {
        return false;
      }
      return compression.filter(req, res);
    },
  });
}

module.exports = compressionMiddleware;
