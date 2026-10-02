"use strict";

const packageConfig = require("./package.json").jest;

module.exports = {
  ...packageConfig,
  // Mutation testing targets the service layer. Contract harnesses bootstrap
  // the full application and require external infrastructure, so they are
  // not part of the deterministic Stryker test run.
  projects: undefined,
  testPathIgnorePatterns: [
    ...packageConfig.testPathIgnorePatterns,
    "/src/tests/contract/",
    "/tests/contract/",
    "/src/routes/admin\\.test\\.js$",
  ],
  testMatch: [
    "**/src/services/escrowService*.test.js",
    "**/src/services/disputeService.test.js",
  ],
};
