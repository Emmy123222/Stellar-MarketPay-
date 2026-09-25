import fs from "fs";
import path from "path";

const LOCALES_DIR = path.join(__dirname, "../public/locales");
const REQUIRED_LOCALES = ["es", "fr", "pt"];

function flattenObject(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  return Object.entries(obj).reduce((result: Record<string, unknown>, [key, value]) => {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, keyPath));
    } else {
      result[keyPath] = value;
    }
    return result;
  }, {});
}

describe("i18n translations completeness", () => {
  const english = flattenObject(
    JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, "en/common.json"), "utf-8")),
  );

  it.each(REQUIRED_LOCALES)("has every English key translated in %s", (locale) => {
    const translated = flattenObject(
      JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, "common.json"), "utf-8")),
    );

    const missing = Object.keys(english).filter((key) => !(key in translated));
    const placeholders = Object.entries(translated)
      .filter(([, value]) => typeof value === "string" && value.includes("[TRANSLATE]"))
      .map(([key]) => key);

    expect(missing).toEqual([]);
    expect(placeholders).toEqual([]);
  });
});
