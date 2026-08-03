/**
 * jest.globalSetup.js
 *
 * Runs once before all test suites. Sets the same env vars that
 * jest.setup.js previously set via setupFiles, but runs in the main
 * Jest process so __dirname resolution is unambiguous on Windows.
 */
"use strict";

module.exports = async function globalSetup() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/marketpay_test";
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || "test-jwt-secret-with-enough-length-for-ci";
  process.env.CSRF_SECRET =
    process.env.CSRF_SECRET || "test-csrf-secret-with-enough-length-for-ci";
  process.env.PORT = process.env.PORT || "0";
};
