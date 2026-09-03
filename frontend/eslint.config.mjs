/**
 * eslint.config.mjs
 *
 * Flat config for ESLint 9 (Next.js 16 removed `next lint`).
 * Mirrors the legacy `.eslintrc.json` setup: Next core-web-vitals rules,
 * jsx-a11y recommended, and the custom SRI rule.
 */
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import jsxA11y from "eslint-plugin-jsx-a11y";
import sri from "eslint-plugin-sri";

export default defineConfig([
  ...nextVitals,
  {
    // Storybook render() functions legitimately call hooks inside the render
    // callback; the rule is a known false positive for that pattern.
    files: ["stories/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    plugins: {
      sri,
    },
    rules: {
      // jsx-a11y recommended (the plugin itself is registered by eslint-config-next).
      ...jsxA11y.flatConfigs.recommended.rules,
      // Keep these as warnings, matching the previous .eslintrc.json overrides.
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
      "sri/no-external-script-without-sri": "error",
      // Rules introduced by eslint-plugin-react-hooks v6 (bundled with
      // eslint-config-next 16). They did not exist under eslint-config-next 14
      // and flag long-standing patterns across ~45 files; keep them
      // non-blocking so this security upgrade stays scoped.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);
