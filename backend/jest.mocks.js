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

jest.mock("sanitize-html", () => {
  return jest.fn((html) => html);
});
