/**
 * Babel config for Jest.
 *
 * Several runtime dependencies (e.g. htmlparser2 v12, domhandler v6 and the
 * rest of the sanitize-html parse chain) ship ESM-only builds. Jest runs the
 * test suite in CommonJS mode, so those packages are transpiled here —
 * babel-jest applies this config to any module matched by the
 * `transformIgnorePatterns` allow-list in package.json.
 */
module.exports = {
  presets: [
    [
      "@babel/preset-env",
      {
        // Match whatever Node version Jest is running under (Node 20 in CI).
        targets: { node: "current" },
      },
    ],
  ],
};
