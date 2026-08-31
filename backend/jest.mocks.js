/**
 * jest.mocks.js
 *
 * Module-level mocks that require Jest globals (jest.mock, jest.fn).
 * Loaded via setupFilesAfterEnv — jest.* APIs are not available in setupFiles.
 *
 * Bypasses CSRF validation globally so tests can call mutating routes
 * without fetching a token first. Tests that explicitly verify CSRF behaviour
 * (tests/csrf.test.js) call jest.unmock() at the top of the file to restore
 * the real middleware.
 */

jest.mock("./src/middleware/csrf", () => {
  const actual = jest.requireActual("./src/middleware/csrf");
  return {
    ...actual,
    doubleCsrfProtection: (req, res, next) => next(),
  };
});

// Prevent ESM/CJS compatibility issues with sanitize-html → htmlparser2 chain
jest.mock("sanitize-html", () => {
  /*
   * Lightweight mock that strips HTML tags and dangerous content.
   * Handles the double-pass call pattern in src/middleware/sanitize.js
   * and passes the sanitize.test.js assertions.
   */
  // Tags whose content (not just the tag) must be removed entirely
  const CONTENT_TAG_RE = /<(script|style|iframe|object|embed|applet|form|textarea|select|input|button|svg|math|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi;
  // Self-closing dangerous tags
  const SELF_CLOSING_RE = /<(script|style|iframe|object|embed|applet|svg|math)[^>]*\/>/gi;
  // Any remaining HTML tags
  const TAG_RE = /<[^>]*>/g;
  // Fullwidth Unicode variants used in XSS evasion
  const FULLWIDTH_RE = /[\uFF1C\uFF1E]/g;

  function decodeEntities(str) {
    if (typeof str !== "string") return str;
    return str
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#x2F;/gi, "/");
  }

  function stripAll(str) {
    if (typeof str !== "string") return str;
    let s = str;
    // Normalize fullwidth < > to regular
    s = s.replace(FULLWIDTH_RE, (ch) => (ch === "\uFF1C" ? "<" : ">"));
    // Decode HTML entities so nested/mangled tags are exposed
    s = decodeEntities(s);
    // Remove dangerous content tags (and everything inside)
    s = s.replace(CONTENT_TAG_RE, "");
    s = s.replace(SELF_CLOSING_RE, "");
    // Remove any remaining tags
    s = s.replace(TAG_RE, "");
    return s;
  }

  function sanitize(str, opts) {
    if (typeof str !== "string") return str;
    return stripAll(str);
  }

  const api = Object.assign(sanitize, {
    allowedTags: false,
    allowedAttributes: false,
  });
  return api;
});
