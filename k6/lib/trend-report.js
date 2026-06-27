/**
 * k6/lib/trend-report.js
 *
 * Compares the latest k6 run summaries (k6/results/*-summary.json) against the
 * previous run (k6/previous-results/*-summary.json, downloaded as a CI
 * artifact) and emits:
 *
 *   • k6/results/trend-report.md   — human-readable Markdown table
 *   • k6/results/trend-report.json — machine-readable deltas
 *
 * Metrics tracked (per endpoint):
 *   • p(95) latency (ms)        — SLA target: < 200 ms
 *   • error rate                — SLA target: 0 %
 *   • throughput (req/s)
 *
 * Exit code is non-zero if any current metric REGRESSES beyond its tolerance
 * (e.g. p(95) worsens by > 25 % or error rate rises above 1 %), so the CI gate
 * can fail on performance regressions even when absolute thresholds still pass.
 *
 * Usage:
 *   node k6/lib/trend-report.js \
 *     --current  k6/results \
 *     --previous k6/previous-results
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SCRIPTS = [
  { file: "get-jobs-summary.json", name: "GET /api/jobs" },
  { file: "get-profiles-summary.json", name: "GET /api/profiles/:key" },
  { file: "post-applications-summary.json", name: "POST /api/applications" },
];

const SLA = { P95_MS: 200, MAX_ERROR_RATE: 0.01 };
// A metric is a "regression" if it worsens by more than this fraction vs. prev.
const REGRESSION_TOLERANCE = 0.25;

function parseArgs(argv) {
  const args = { current: "k6/results", previous: "k6/previous-results" };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i] && argv[i].replace(/^--/, "");
    if (key && argv[i + 1]) args[key] = argv[i + 1];
  }
  return args;
}

function readSummary(dir, file) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

function extract(summary) {
  if (!summary || !summary.metrics) return null;
  const m = summary.metrics;
  const p95 = m.http_req_duration?.values?.["p(95)"];
  const errorRate = m.http_req_failed?.values?.rate;
  const rps = m.http_reqs?.values?.rate;
  if (p95 == null || errorRate == null) return null;
  return { p95, errorRate, rps };
}

function fmtMs(v) {
  return v == null ? "—" : `${v.toFixed(1)} ms`;
}
function fmtPct(v) {
  return v == null ? "—" : `${(v * 100).toFixed(2)} %`;
}
function fmtRps(v) {
  return v == null ? "—" : `${v.toFixed(1)} req/s`;
}

function deltaPct(curr, prev) {
  if (prev == null || prev === 0) return null;
  return (curr - prev) / prev;
}

function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.current, { recursive: true });

  const rows = [];
  let regressed = false;

  for (const s of SCRIPTS) {
    const cur = extract(readSummary(args.current, s.file));
    const prev = extract(readSummary(args.previous, s.file));

    if (!cur) {
      rows.push({ name: s.name, note: "no current result" });
      continue;
    }

    const p95Delta = deltaPct(cur.p95, prev?.p95);
    const errDelta = deltaPct(cur.errorRate, prev?.errorRate);

    // Regression heuristics (only when a previous baseline exists).
    let regressedP95 = prev && p95Delta != null && p95Delta > REGRESSION_TOLERANCE;
    let regressedErr = prev && cur.errorRate > SLA.MAX_ERROR_RATE;
    if (regressedP95 || regressedErr) regressed = true;

    rows.push({
      name: s.name,
      cur,
      prev,
      p95Delta,
      errDelta,
      regressedP95,
      regressedErr,
    });
  }

  // ── Markdown ───────────────────────────────────────────────────────────────
  const md = [];
  md.push("# 📈 k6 Load-Test Trend Report\n");
  md.push(`Generated: ${new Date().toISOString()}\n`);
  md.push(`**SLA targets:** p(95) < ${SLA.P95_MS} ms · error rate ≤ ${(SLA.MAX_ERROR_RATE * 100).toFixed(0)} %\n`);
  md.push("\n| Endpoint | p(95) now | p(95) prev | Δ p95 | Errors now | Errors prev | Throughput now | Status |");
  md.push("|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    if (r.note) {
      md.push(`| ${r.name} | _${r.note}_ | | | | | | ⚠️ |`);
      continue;
    }
    const arrow =
      r.p95Delta == null ? "" : r.p95Delta > 0.05 ? "🔴" : r.p95Delta < -0.05 ? "🟢" : "➖";
    const status =
      (r.regressedP95 ? "🔴 regressed " : "") +
      (r.regressedErr ? "🔴 high errors " : "") +
      (!r.regressedP95 && !r.regressedErr ? "🟢 ok" : "");
    md.push(
      `| ${r.name} | ${fmtMs(r.cur.p95)} | ${r.prev ? fmtMs(r.prev.p95) : "—"} | ${
        r.p95Delta == null ? "—" : `${(r.p95Delta * 100).toFixed(1)} % ${arrow}`
      } | ${fmtPct(r.cur.errorRate)} | ${r.prev ? fmtPct(r.prev.errorRate) : "—"} | ${fmtRps(
        r.cur.rps,
      )} | ${status} |`,
    );
  }
  md.push("\n> 🔴 = regression (p(95) worsened > 25 % vs. baseline, or error rate > 1 %).");
  md.push("> 🟢 = improvement. ➖ = within ±5 %.\n");

  fs.writeFileSync(
    path.join(args.current, "trend-report.md"),
    md.join("\n"),
  );

  // ── JSON ───────────────────────────────────────────────────────────────────
  const json = {
    generatedAt: new Date().toISOString(),
    sla: SLA,
    regressed,
    rows: rows.map((r) => ({
      endpoint: r.name,
      current: r.cur || null,
      previous: r.prev || null,
      p95Delta: r.p95Delta,
      errorDelta: r.errDelta,
      regressed: Boolean(r.regressedP95 || r.regressedErr),
    })),
  };
  fs.writeFileSync(
    path.join(args.current, "trend-report.json"),
    JSON.stringify(json, null, 2),
  );

  console.log(md.join("\n"));
  console.log(
    `\n[trend] ${regressed ? "REGRESSION DETECTED" : "no regression"} → ${
      path.join(args.current, "trend-report.md")
    }`,
  );

  process.exit(regressed ? 2 : 0);
}

main();
