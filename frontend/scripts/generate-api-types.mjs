#!/usr/bin/env node
/**
 * scripts/generate-api-types.mjs
 * Generates typed API schemas from backend/docs/openapi.json using openapi-typescript.
 * Supports `--check` for detecting drift in CI.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specPath = path.resolve(root, "../backend/docs/openapi.json");
const outputPath = path.resolve(root, "lib/api/schema.ts");

const isCheck = process.argv.includes("--check");
const isWindows = process.platform === "win32";
const npxCmd = isWindows ? "npx.cmd" : "npx";

const args = ["-y", "openapi-typescript", specPath, "-o", outputPath];
if (isCheck) {
  args.push("--check");
}

const child = spawn(npxCmd, args, {
  stdio: "inherit",
});

child.on("error", (err) => {
  console.error("Failed to run openapi-typescript:", err);
  process.exit(1);
});

child.on("exit", (code) => {
  if (code !== 0 && isCheck) {
    console.error(
      "\n❌ OpenAPI type drift detected! The backend OpenAPI specification has changed without regenerating frontend/lib/api/schema.ts.\nRun 'npm run api:generate' in frontend to update the types.\n",
    );
  }
  process.exit(code ?? 0);
});
