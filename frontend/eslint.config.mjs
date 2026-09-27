/**
 * eslint.config.mjs
 *
 * Flat config for ESLint.
 * Mirrors the legacy `.eslintrc.json` setup: Next core-web-vitals rules,
 * jsx-a11y recommended, and the custom SRI rule.
 */
import { FlatCompat } from "@eslint/eslintrc";
import path from "path";
import { fileURLToPath } from "url";
import jsxA11y from "eslint-plugin-jsx-a11y";
import sri from "eslint-plugin-sri";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  ...compat.extends("next/core-web-vitals"),
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
    },
  },
  {
    ignores: [
      // Default ignores of eslint-config-next:
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
