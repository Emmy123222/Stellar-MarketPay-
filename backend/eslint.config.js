"use strict";

/**
 * ESLint flat configuration (ESLint 9+ / 10).
 *
 * Ported from the legacy .eslintrc.json, which ESLint 10 no longer reads.
 * Keeps the same three rules the repo relied on: recommended rules for all
 * CommonJS sources, ESM parsing for the two module-syntax files, and Jest
 * globals in test files.
 */

const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "reports/**",
      "docs/**",
      "prometheus/**",
    ],
  },

  // Baseline: CommonJS Node sources.
  {
    files: ["**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
  },

  // These two files use ESM syntax and must be parsed as modules.
  {
    files: ["src/services/store.js", "src/middleware/rateLimiter.js"],
    languageOptions: {
      sourceType: "module",
    },
  },

  // Severity tuning. no-undef stays an error — it catches the missing-import
  // class of bug that was breaking routes at runtime. The hygiene rules below
  // are warnings so real breakage is never buried under unused-variable noise.
  {
    files: ["**/*.js"],
    rules: {
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      }],
    },
  },

  // Test files additionally get the Jest globals.
  {
    files: ["**/*.test.js", "**/*.test.*.js", "**/__tests__/**/*.js", "tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];
