#!/usr/bin/env node
/**
 * scripts/audit-filter.mjs
 *
 * Runs `npm audit --json` and filters out known-unfixable advisories
 * (no patched version in the current major version range).
 * Exits 1 if any HIGH/CRITICAL vulnerabilities remain after filtering.
 *
 * Usage: node scripts/audit-filter.mjs
 */

import { execSync } from "child_process";

// GHSAs that have no fix available within next@^14.x.
// Remove when the project upgrades to next@>=15.5.27.
const KNOWN_UNFIXABLE = new Set([
  "GHSA-2xp9-vwfh-vxw4",
  "GHSA-36qx-fr4f-26g5",
  "GHSA-3g8h-86w9-wvmq",
  "GHSA-3x4c-7xq6-9pq8",
  "GHSA-4633-3j49-mh5q",
  "GHSA-4c39-4ccg-62r3",
  "GHSA-68g3-v927-f742",
  "GHSA-89xv-2m56-2m9x",
  "GHSA-8h8q-6873-q5fj",
  "GHSA-955p-x3mx-jcvp",
  "GHSA-9g9p-9gw9-jx7f",
  "GHSA-c4j6-fc7j-m34r",
  "GHSA-ffhc-5mcf-pf4q",
  "GHSA-ggv3-7p47-pfv8",
  "GHSA-gx5p-jg67-6x7h",
  "GHSA-h25m-26qc-wcjf",
  "GHSA-h64f-5h5j-jqjh",
  "GHSA-m99w-x7hq-7vfj",
  "GHSA-p293-qw3h-jr36",
  "GHSA-p9j2-gv94-2wf4",
  "GHSA-q4gf-8mx6-v5v3",
  "GHSA-vfv6-92ff-j949",
  "GHSA-wfc6-r584-vfw7",
]);

let raw;
try {
  raw = execSync("npm audit --omit=dev --json", { encoding: "utf-8" });
} catch (err) {
  // npm audit exits non-zero when vulns are found; capture stdout
  raw = err.stdout ?? "{}";
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error("Failed to parse npm audit JSON output");
  process.exit(1);
}

const vulns = report.vulnerabilities ?? {};
const actionable = [];

function getRootAdvisoryIds(pkgName, seen = new Set()) {
  if (seen.has(pkgName)) return [];
  seen.add(pkgName);
  
  const info = vulns[pkgName];
  if (!info || !info.via) return [];
  
  const ids = [];
  for (const via of info.via) {
    if (typeof via === "object" && via.url) {
      ids.push(via.url.split("/").pop());
    } else if (typeof via === "string") {
      ids.push(...getRootAdvisoryIds(via, seen));
    }
  }
  return ids;
}

for (const [pkg, info] of Object.entries(vulns)) {
  if (!["high", "critical"].includes(info.severity)) continue;

  const advisoryIds = getRootAdvisoryIds(pkg);
  
  // If the package has advisories and ALL of them are in the ignored list, skip it.
  const allIgnored = advisoryIds.length > 0 && advisoryIds.every((id) => KNOWN_UNFIXABLE.has(id));
  if (!allIgnored) {
    actionable.push({ pkg, severity: info.severity, advisoryIds: [...new Set(advisoryIds)] });
  }
}

if (actionable.length === 0) {
  console.log("✅  npm audit passed — no actionable HIGH/CRITICAL vulnerabilities.");
  process.exit(0);
} else {
  console.error("❌  npm audit found actionable HIGH/CRITICAL vulnerabilities:");
  for (const { pkg, severity, advisoryIds } of actionable) {
    console.error(`  ${severity.toUpperCase()}: ${pkg} (${advisoryIds.join(", ")})`);
  }
  process.exit(1);
}
