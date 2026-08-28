/**
 * jest.config.js — Jest 30 config for contract tests.
 * Env vars are passed on the CLI or default within each test's beforeAll.
 * No setupFiles/globalSetup to avoid path resolution issues on Windows.
 */
"use strict";

module.exports = {
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "src/tests/integration"],
  collectCoverageFrom: [
    "src/middleware/sanitize.js",
    "src/services/profileService.js",
    "src/services/escrowService.js",
    "src/services/disputeService.js",
    "src/services/gas_estimator.js",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  coverageThreshold: { global: { lines: 60, branches: 50 } },
  transformIgnorePatterns: [
    "node_modules/(?!(isomorphic-dompurify|dompurify|@exodus|uuid|sanitize-html|htmlparser2|dom-serializer|entities|escape-string-regexp|parse-srcset)/)",
  ],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
};
