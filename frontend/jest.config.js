const nextJest = require("next/jest");

// Pin mock-mode flag so snapshot tests render identically to CI (which sets
// NEXT_PUBLIC_USE_CONTRACT_MOCK=true in the frontend job). Set here so the
// next/jest SWC transform inlines the same value in local and CI runs.
process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK = "true";

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.tsx"],
  testEnvironment: "jest-environment-jsdom",
  testMatch: ["**/__tests__/**/*.test.{ts,tsx}"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(isomorphic-dompurify|dompurify|@exodus|uuid|@react-pdf|@react-pdf/renderer|react-pdf)/)",
  ],
};

module.exports = createJestConfig(customJestConfig);
