/**
 * lib/direction.ts
 * Locale -> text direction. Single source of truth for <html dir>, used by
 * pages/_document.tsx (SSR), pages/_app.tsx (client-side language switch) and
 * the Storybook direction toggle.
 */

export type TextDirection = "ltr" | "rtl";

/** ISO 639-1/-3 language subtags written right-to-left. */
const RTL_LANGUAGES = new Set([
  "ar", // Arabic
  "he", // Hebrew
  "fa", // Persian
  "ur", // Urdu
  "ps", // Pashto
  "sd", // Sindhi
  "yi", // Yiddish
  "dv", // Dhivehi
  "ckb", // Central Kurdish
]);

/** Right-to-left scripts, for tags like "pa-Arab" or "az-Arab". */
const RTL_SCRIPTS = new Set(["arab", "hebr", "thaa", "syrc", "nkoo"]);

/**
 * Pseudo-locale for exercising RTL layouts before a real RTL translation
 * exists (same convention as Android's en-XB): English text, mirrored layout.
 */
export const PSEUDO_RTL_LOCALE = "en-XB";

export function getDirection(locale?: string | null): TextDirection {
  if (!locale) return "ltr";
  const parts = locale.toLowerCase().replace(/_/g, "-").split("-");
  if (locale.toLowerCase() === PSEUDO_RTL_LOCALE.toLowerCase()) return "rtl";
  if (RTL_LANGUAGES.has(parts[0])) return "rtl";
  if (parts.slice(1).some((part) => RTL_SCRIPTS.has(part))) return "rtl";
  return "ltr";
}

export function isRtl(locale?: string | null): boolean {
  return getDirection(locale) === "rtl";
}
