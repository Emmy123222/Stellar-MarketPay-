"use strict";

const shrinkRay = require("shrink-ray-current");

/**
 * Compression middleware.
 * Uses shrink-ray-current for Brotli support with Gzip fallback.
 * Applies compression for payloads > 1KB (1024 bytes).
 */
function compressionMiddleware() {
  return shrinkRay({
    threshold: 1024, // 1 KB threshold
    filter: (req, res) => {
      // By default shrinkRay uses the same filter logic as compression
      // which looks at res.getHeader('Content-Type')
      if (req.headers["x-no-compression"]) {
        return false;
      }
      // fallback to standard filter function
      return shrinkRay.filter(req, res);
    }
  });
}

module.exports = compressionMiddleware;
