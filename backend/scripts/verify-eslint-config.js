"use strict";

const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const legacyConfig = path.join(backendRoot, ".eslintrc.json");
const flatConfig = path.join(backendRoot, "eslint.config.js");

if (fs.existsSync(legacyConfig)) {
  throw new Error(
    "Remove backend/.eslintrc.json: ESLint must use the flat backend/eslint.config.js configuration."
  );
}

if (!fs.existsSync(flatConfig)) {
  throw new Error("Missing backend/eslint.config.js flat configuration.");
}

console.log("ESLint configuration is unambiguous: flat config only.");
