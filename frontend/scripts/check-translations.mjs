#!/usr/bin/env node
/**
 * Reports locale keys that were added to English but not translated yet.
 *
 * The command intentionally has no side effects: it never writes placeholder
 * strings into a translator-maintained locale file. CI runs this command with
 * `--strict`, making a missing or placeholder translation actionable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesRoot = path.join(root, "public", "locales");
const sourceLocale = "en";
const requiredLocales = ["es", "fr", "pt"];
const strict = process.argv.includes("--strict");

function flatten(object, prefix = "") {
  return Object.entries(object).reduce((result, [key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flatten(value, fullKey));
    } else {
      result[fullKey] = value;
    }
    return result;
  }, {});
}

const english = flatten(JSON.parse(fs.readFileSync(path.join(localesRoot, sourceLocale, "common.json"), "utf8")));
let hasProblems = false;

for (const locale of requiredLocales) {
  const filename = path.join(localesRoot, locale, "common.json");
  if (!fs.existsSync(filename)) {
    console.warn(`::warning file=${filename}::Missing ${locale} locale file.`);
    hasProblems = true;
    continue;
  }

  const translated = flatten(JSON.parse(fs.readFileSync(filename, "utf8")));
  const missing = Object.keys(english).filter((key) => !(key in translated));
  const placeholders = Object.entries(translated)
    .filter(([, value]) => typeof value === "string" && value.includes("[TRANSLATE]"))
    .map(([key]) => key);

  for (const key of missing) {
    console.warn(`::warning file=${filename}::${locale} is missing translation key '${key}'.`);
  }
  for (const key of placeholders) {
    console.warn(`::warning file=${filename}::${locale} has an unfinished translation for '${key}'.`);
  }
  hasProblems ||= missing.length > 0 || placeholders.length > 0;
}

if (!hasProblems) {
  console.log("All required locale files contain every English key and no translation placeholders.");
}

if (hasProblems && strict) process.exitCode = 1;
