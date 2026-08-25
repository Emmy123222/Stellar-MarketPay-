/**
 * next-i18next configuration.
 * Resources are bundled so every Pages Router page can translate immediately;
 * serverSideTranslations is therefore not required on each existing page.
 */
const resources = {
  en: { common: require("./public/locales/en/common.json") },
  es: { common: require("./public/locales/es/common.json") },
  fr: { common: require("./public/locales/fr/common.json") },
  pt: { common: require("./public/locales/pt/common.json") },
};

module.exports = {
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es", "fr", "pt"],
  },
  localePath: typeof window === "undefined" ? "./public/locales" : "/locales",
  defaultNS: "common",
  fallbackLng: "en",
  resources,
  interpolation: {
    escapeValue: false,
  },
  detection: {
    order: ["localStorage", "navigator"],
    lookupLocalStorage: "preferredLocale",
    caches: ["localStorage"],
  },
};
