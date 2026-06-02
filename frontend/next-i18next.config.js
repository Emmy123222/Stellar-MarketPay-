/**
 * next-i18next configuration (#282).
 * Locales are loaded client-side via lib/i18n.js; Next.js routing locales are in next.config.mjs.
 */
module.exports = {
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es", "fr", "pt"],
  },
  localePath: typeof window === "undefined" ? "./public/locales" : "/locales",
  defaultNS: "common",
  fallbackLng: "en",
};
