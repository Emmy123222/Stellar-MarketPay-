"use strict";

const compression = require("compression");

/**
 * Compression middleware.
 * Uses built-in compression (gzip/deflate) for payloads > 1KB.
 */
function compressionMiddleware() {
  return compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) {
        return false;
      }
      return compression.filter(req, res);
    },
  });
}

module.exports = compressionMiddleware;
