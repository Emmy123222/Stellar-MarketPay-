#!/usr/bin/env node
/**
 * Cross-platform script to copy sw.src.js to sw.js for development mode.
 * Replaces platform-specific shell commands (such as POSIX `cp`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public", "sw.src.js");
const dest = path.join(root, "public", "sw.js");

try {
  fs.copyFileSync(src, dest);
} catch (err) {
  console.error("Failed to copy service worker source file:", err);
  process.exit(1);
}
