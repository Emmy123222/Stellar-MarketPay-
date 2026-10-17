#!/usr/bin/env node
/**
 * scripts/rtl-audit.mjs
 *
 * Finds Tailwind utilities that are tied to a physical direction (ml-, pr-,
 * text-left, left-0, rounded-l, …) and, with --write, rewrites the mechanical
 * ones to their logical equivalents (ms-, pe-, text-start, start-0, rounded-s, …)
 * so layouts mirror automatically when <html dir="rtl">.
 *
 *   node scripts/rtl-audit.mjs                       # report across components/ + pages/
 *   node scripts/rtl-audit.mjs components/Navbar.tsx # report specific files
 *   node scripts/rtl-audit.mjs --write components/JobCard.tsx
 *   node scripts/rtl-audit.mjs --check components/Navbar.tsx   # exit 1 if any remain
 *
 * See docs/RTL.md for the conversion table and the cases that need a human
 * (centering with left-1/2, directional icons, translate-x, absolute carets).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** physical prefix -> logical prefix. Order matters: longest first. */
const PREFIX_MAP = [
  ["rounded-tl", "rounded-ss"],
  ["rounded-tr", "rounded-se"],
  ["rounded-bl", "rounded-es"],
  ["rounded-br", "rounded-ee"],
  ["rounded-l", "rounded-s"],
  ["rounded-r", "rounded-e"],
  ["border-l", "border-s"],
  ["border-r", "border-e"],
  ["text-left", "text-start"],
  ["text-right", "text-end"],
  ["float-left", "float-start"],
  ["float-right", "float-end"],
  ["clear-left", "clear-start"],
  ["clear-right", "clear-end"],
  ["scroll-ml", "scroll-ms"],
  ["scroll-mr", "scroll-me"],
  ["scroll-pl", "scroll-ps"],
  ["scroll-pr", "scroll-pe"],
  ["ml", "ms"],
  ["mr", "me"],
  ["pl", "ps"],
  ["pr", "pe"],
  ["left", "start"],
  ["right", "end"],
];

/** Utilities that cannot be converted mechanically; reported only. */
const MANUAL = [
  { re: /^space-x(-|$)/, hint: "space-x uses physical margins; prefer gap-* on flex/grid parents" },
  { re: /^divide-x(-|$)/, hint: "divide-x is physical; use a logical border-s on children" },
  { re: /^-?translate-x-/, hint: "translate-x does not mirror; add an rtl: variant (e.g. rtl:-translate-x-…)" },
  { re: /^(rotate-|-rotate-)/, hint: "directional icons/chevrons need rtl:rotate-180 or rtl:-scale-x-100" },
];

const SKIP_CENTERING = /^-?(left|right)-1\/2$/; // paired with -translate-x-1/2

/** Splits "md:hover:ml-2" into ["md:hover:", "ml-2"]. */
function splitVariants(token) {
  const idx = token.lastIndexOf(":");
  return idx === -1 ? ["", token] : [token.slice(0, idx + 1), token.slice(idx + 1)];
}

export function convertToken(token) {
  const [variants, rawBase] = splitVariants(token);
  const important = rawBase.startsWith("!") ? "!" : "";
  const negative = rawBase.replace(/^!/, "").startsWith("-") ? "-" : "";
  const base = rawBase.replace(/^!/, "").replace(/^-/, "");
  if (SKIP_CENTERING.test(rawBase.replace(/^!/, ""))) return null;
  for (const [physical, logical] of PREFIX_MAP) {
    if (base === physical || base.startsWith(`${physical}-`)) {
      // "left"/"right" are inset utilities only when followed by a value.
      if ((physical === "left" || physical === "right") && base === physical) return null;
      return `${variants}${important}${negative}${logical}${base.slice(physical.length)}`;
    }
  }
  return null;
}

function manualHint(token) {
  const base = splitVariants(token)[1].replace(/^!/, "");
  return MANUAL.find((m) => m.re.test(base))?.hint ?? null;
}

// Tailwind tokens only ever live inside string/template literals in these files.
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const CLASS_LIKE = /^[\w\s:/\-[\].!%#(),'"&>*~=+]+$/;

function collectFiles(target) {
  const abs = join(ROOT, target);
  if (statSync(abs).isFile()) return [abs];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__tests__") continue;
    const child = join(abs, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(relative(ROOT, child)));
    else if ([".tsx", ".jsx"].includes(extname(entry.name))) out.push(child);
  }
  return out;
}

function processFile(file, write) {
  const source = readFileSync(file, "utf8");
  const findings = [];
  const next = source.replace(STRING_LITERAL, (match, quote, body) => {
    if (!CLASS_LIKE.test(body) || !/[a-z]/.test(body)) return match;
    const rewritten = body.replace(/[^\s]+/g, (token) => {
      const converted = convertToken(token);
      if (converted) {
        findings.push({ token, fix: converted });
        return converted;
      }
      const hint = manualHint(token);
      if (hint) findings.push({ token, hint });
      return token;
    });
    return `${quote}${rewritten}${quote}`;
  });
  if (write && next !== source) writeFileSync(file, next);
  return findings;
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const check = args.includes("--check");
const targets = args.filter((a) => !a.startsWith("--"));
const files = (targets.length ? targets : ["components", "pages"]).flatMap(collectFiles);

let mechanical = 0;
let manual = 0;
for (const file of files) {
  const findings = processFile(file, write);
  if (!findings.length) continue;
  const name = relative(ROOT, file).replace(/\\/g, "/");
  const fixable = findings.filter((f) => f.fix);
  const review = findings.filter((f) => f.hint);
  mechanical += fixable.length;
  manual += review.length;
  console.log(`${name}: ${fixable.length} physical, ${review.length} need review`);
  for (const f of review) console.log(`    review  ${f.token}  — ${f.hint}`);
  if (!write && targets.length) for (const f of fixable) console.log(`    ${f.token} -> ${f.fix}`);
}
console.log(
  `\n${write ? "rewrote" : "found"} ${mechanical} physical utilities; ${manual} need manual review`,
);
// --check gates on mechanical findings only; "review" items need human judgement.
if (check && !write && mechanical > 0) process.exit(1);
