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
    "/node_modules/(?!(.*/node_modules/)?(@stellar|@exodus|@noble|uint8array-extras|eventsource|smol-toml|isomorphic-dompurify|dompurify|uuid|@react-pdf|react-pdf)/)",
  ],
};

module.exports = createJestConfig(customJestConfig);
