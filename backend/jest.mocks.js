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

// Mock sanitize-html to avoid loading htmlparser2 (ESM-only) under Jest CJS.
// htmlparser2 v12+ ships as ESM which Jest cannot parse without additional
// Babel plugins; the mock strips the same tags the real function does.
jest.mock("sanitize-html", () => {
  // Strip script/style tags *and* their content, then strip all remaining tags.
  const sanitize = (html) => {
    let result = html.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*(script|style)\s*>/gi, "");
    result = result.replace(/<[^>]*>/g, "");
    return result;
  };
  return Object.assign(sanitize, { default: sanitize });
});
