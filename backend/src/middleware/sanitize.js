/**
 * src/middleware/sanitize.js
 * Input sanitization middleware to prevent XSS attacks
 */
"use strict";

const xss = require("xss");
const validator = require("validator");

/**
 * SQL injection patterns to detect and block
 */
const SQL_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|DECLARE)\b)/gi,
  /(--|\/\*|\*\/)/g,
  /(\bOR\b.*=.*|1=1|'=')/gi,
];

/**
 * XSS filter options - strip all HTML tags
 */
const XSS_OPTIONS = {
  whiteList: {}, // No tags allowed
  stripIgnoreTag: true, // Remove all tags
  stripIgnoreTagBody: ["script", "style"], // Remove script and style content
};

/**
 * Sanitize a single string value by:
 * 1. Decoding entities and normalizing Unicode exploits
 * 2. Stripping HTML tags and dangerous content
 * 3. Checking for SQL injection patterns
 *
 * @param {string} value - The string to sanitize
 * @param {Object} options - Sanitization options
 * @param {boolean} options.allowBasicMarkdown - Allow basic markdown-safe characters
 * @param {boolean} options.strict - Enable strict SQL pattern checking
 * @returns {string} Sanitized string
 */
function sanitizeString(value, options = {}) {
  if (typeof value !== "string") return value;

  // Decode entities before filtering so encoded HTML such as
  // &lt;img onerror=...&gt; is treated the same as raw HTML. Normalize before
  // and after filtering to catch fullwidth angle brackets and similar tricks.
  let sanitized = validator.unescape(value).normalize("NFKC");

  // Strip HTML using xss library. A second pass after entity decoding handles
  // values that become tag-like only after the first filter serializes them.
  sanitized = xss(sanitized, XSS_OPTIONS);
  sanitized = validator.unescape(sanitized).normalize("NFKC");
  sanitized = xss(sanitized, XSS_OPTIONS);

  // Defense in depth: this middleware is configured as plain-text only, so no
  // angle brackets should remain even when strict SQL checks are disabled.
  sanitized = sanitized.replace(/[<>]/g, "");

  // Check for SQL injection patterns in strict mode
  if (options.strict) {
    for (const pattern of SQL_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(sanitized)) {
        // Log suspicious input but don't block (could be legitimate content)
        console.warn("[sanitize] Suspicious SQL pattern detected:", sanitized.substring(0, 100));
      }
    }
  }

  return sanitized.trim();
}

/**
 * Recursively sanitize all string values in an object or array
 *
 * @param {*} obj - Object, array, or primitive to sanitize
 * @param {Object} options - Sanitization options
 * @param {WeakSet} visited - Tracks visited objects/arrays to prevent circular references
 * @returns {*} Sanitized object/array/primitive
 */
function sanitizeObject(obj, options = {}, visited = new WeakSet(), depth = 0) {
  const MAX_DEPTH = 20;
  if (depth > MAX_DEPTH) {
    throw new Error("Input nesting depth exceeds limit");
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return sanitizeString(obj, options);
  }

  if (Array.isArray(obj)) {
    if (visited.has(obj)) {
      return [];
    }
    visited.add(obj);
    return obj.map((item) => sanitizeObject(item, options, visited, depth + 1));
  }

  if (typeof obj === "object") {
    if (visited.has(obj)) {
      return {};
    }
    visited.add(obj);

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Sanitize the key as well to prevent prototype pollution
      const sanitizedKey = sanitizeString(key, { strict: false });
      
      // Skip dangerous keys
      if (sanitizedKey === "__proto__" || sanitizedKey === "constructor" || sanitizedKey === "prototype") {
        console.warn("[sanitize] Blocked dangerous key:", sanitizedKey);
        continue;
      }

      sanitized[sanitizedKey] = sanitizeObject(value, options, visited, depth + 1);
    }
    return sanitized;
  }

  // Return primitives as-is (numbers, booleans, etc.)
  return obj;
}

/**
 * Express middleware to sanitize req.body, req.query, and req.params
 *
 * @param {Object} options - Sanitization options
 * @param {boolean} options.body - Sanitize req.body (default: true)
 * @param {boolean} options.query - Sanitize req.query (default: true)
 * @param {boolean} options.params - Sanitize req.params (default: true)
 * @param {boolean} options.strict - Enable strict SQL pattern checking (default: false).
 *   HTML is always stripped regardless of this option.
 * @returns {Function} Express middleware function
 */
function sanitizeMiddleware(options = {}) {
  const {
    body = true,
    query = true,
    params = true,
    strict = false,
  } = options;

  return (req, res, next) => {
    try {
      if (body && req.body) {
        req.body = sanitizeObject(req.body, { strict });
      }

      if (query && req.query) {
        req.query = sanitizeObject(req.query, { strict });
      }

      if (params && req.params) {
        req.params = sanitizeObject(req.params, { strict });
      }

      next();
    } catch (error) {
      console.error("[sanitize] Error during sanitization:", error);
      res.status(400).json({
        success: false,
        error: "Invalid input data",
      });
    }
  };
}

module.exports = {
  sanitizeMiddleware,
  sanitizeString,
  sanitizeObject,
};
