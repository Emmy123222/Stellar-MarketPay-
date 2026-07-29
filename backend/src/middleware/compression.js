"use strict";

const compression = require("compression");
const { createBrotliCompress, constants } = require("zlib");

/**
 * Supported encoding priorities:
 *   1. br  (Brotli)  — best compression, ~20–30% smaller than gzip
 *   2. gzip          — universal fallback
 *   3. deflate       — legacy
 *
 * The middleware selects the best encoding advertised by the client's
 * `Accept-Encoding` header.  Brotli is only used for responses ≥ 1 KB.
 */

/** Determine the best compression encoding from Accept-Encoding header. */
function selectEncoding(acceptEncoding) {
  if (!acceptEncoding) return null;

  // Weighted preference: br > gzip > deflate
  const encodings = acceptEncoding
    .split(",")
    .map((s) => {
      const parts = s.trim().split(";");
      const name = parts[0].trim().toLowerCase();
      let q = 1.0;
      for (let i = 1; i < parts.length; i++) {
        const kv = parts[i].trim();
        if (kv.startsWith("q=")) {
          q = parseFloat(kv.slice(2)) || 0;
        }
      }
      return { name, q };
    })
    .filter((e) => ["br", "gzip", "deflate"].includes(e.name));

  encodings.sort((a, b) => b.q - a.q);

  if (encodings.length === 0) return null;

  // If Brotli is accepted and preferred, use it
  const best = encodings[0];
  if (best.name === "br") return "br";
  return best.name;
}

/**
 * Creates a Brotli compression stream with default quality settings.
 */
function createBrotliStream() {
  return createBrotliCompress({
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_DEFAULT_QUALITY,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    },
  });
}

/**
 * Compression middleware supporting Brotli, gzip, and deflate.
 *
 * - Uses the `compression` package for gzip/deflate (proven production path).
 * - Uses Node.js built-in `zlib.createBrotliCompress` for Brotli (requires
 *   Node ≥ 20; no native addon needed).
 * - Skips compression when `x-no-compression` header is present.
 *
 * @param {object} [options]
 * @param {number} [options.threshold=1024] — minimum response size in bytes.
 * @returns {import("express").RequestHandler}
 */
function compressionMiddleware(options = {}) {
  const threshold = options.threshold || 1024;

  // Gzip/deflate middleware via the proven `compression` package
  const gzipMiddleware = compression({
    threshold,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) {
        return false;
      }
      // Let the custom middleware handle Brotli; `compression` handles gzip/deflate.
      const encoding = selectEncoding(req.headers["accept-encoding"]);
      if (encoding === "br") return false;
      return compression.filter(req, res);
    },
  });

  return (req, res, next) => {
    // Honour the opt-out header
    if (req.headers["x-no-compression"]) {
      return next();
    }

    const encoding = selectEncoding(req.headers["accept-encoding"]);

    if (encoding === "br") {
      // ── Brotli path ──────────────────────────────────────────────────────
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);
      const originalWriteHead = res.writeHead.bind(res);

      let chunks = [];
      let totalLength = 0;

      res.write = (chunk, encoding, callback) => {
        if (typeof chunk === "string") {
          chunk = Buffer.from(chunk, encoding);
        }
        chunks.push(chunk);
        totalLength += chunk.length;
        if (callback) callback();
        return true;
      };

      res.end = (chunk, encoding, callback) => {
        if (chunk) {
          if (typeof chunk === "string") {
            chunk = Buffer.from(chunk, encoding);
          }
          chunks.push(chunk);
          totalLength += chunk.length;
        }

        if (totalLength < threshold) {
          // Below threshold — send uncompressed
          const body = Buffer.concat(chunks);
          originalWriteHead(res.statusCode, {
            ...res.getHeaders(),
            "content-length": String(body.length),
          });
          originalEnd(body, callback);
          return;
        }

        // Compress with Brotli
        const brotli = createBrotliStream();
        const compressedChunks = [];

        brotli.on("data", (compressed) => {
          compressedChunks.push(compressed);
        });

        brotli.on("end", () => {
          const body = Buffer.concat(compressedChunks);
          const headers = {
            ...res.getHeaders(),
            "content-encoding": "br",
            "content-length": String(body.length),
            vary: "Accept-Encoding",
          };
          delete headers["content-encoding"]; // will be set below
          originalWriteHead(res.statusCode, headers);
          originalEnd(body, callback);
        });

        brotli.on("error", (err) => {
          console.error("Brotli compression error:", err);
          // Fall back to uncompressed
          const body = Buffer.concat(chunks);
          originalWriteHead(res.statusCode, {
            ...res.getHeaders(),
            "content-length": String(body.length),
          });
          originalEnd(body, callback);
        });

        const body = Buffer.concat(chunks);
        brotli.end(body);
      };

      return next();
    }

    // ── Gzip / deflate path — delegate to the `compression` package ────────
    return gzipMiddleware(req, res, next);
  };
}

module.exports = compressionMiddleware;
