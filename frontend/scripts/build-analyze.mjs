#!/usr/bin/env node
/**
 * Cross-platform script to run Next.js build with bundle analyzer enabled.
 * Replaces platform-specific env var assignment (such as POSIX `ANALYZE=true`
 * or Windows PowerShell `$env:ANALYZE='true'`).
 */
import { spawn } from "node:child_process";

process.env.ANALYZE = "true";

const isWindows = process.platform === "win32";
const npxCmd = isWindows ? "npx.cmd" : "npx";

const child = spawn(npxCmd, ["next", "build"], {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (err) => {
  console.error("Failed to start build analyzer process:", err);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
