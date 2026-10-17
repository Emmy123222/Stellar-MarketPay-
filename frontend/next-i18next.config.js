/**
 * next-i18next configuration.
 * Resources are bundled so every Pages Router page can translate immediately;
 * serverSideTranslations is therefore not required on each existing page.
 *
 * Both the `common` UI namespace and the `invoice` namespace (used by invoice
 * PDF generation and invoice previews) are registered in `resources` and `ns`
 * across all supported locales (en, es, fr, pt, de) ensuring consistent loading.
 */
const resources = {
  en: {
    common: require("./public/locales/en/common.json"),
    invoice: require("./public/locales/en/invoice.json"),
  },
  es: {
    common: require("./public/locales/es/common.json"),
    invoice: require("./public/locales/es/invoice.json"),
  },
  fr: {
    common: require("./public/locales/fr/common.json"),
    invoice: require("./public/locales/fr/invoice.json"),
  },
  pt: {
    common: require("./public/locales/pt/common.json"),
    invoice: require("./public/locales/pt/invoice.json"),
  },
  de: {
    common: require("./public/locales/en/common.json"),
    invoice: require("./public/locales/de/invoice.json"),
  },
};

module.exports = {
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es", "fr", "pt", "de"],
  },
  localePath: typeof window === "undefined" ? "./public/locales" : "/locales",
  defaultNS: "common",
  ns: ["common", "invoice"],
  fallbackLng: "en",
  resources,
  interpolation: {
    escapeValue: false,
  },
  detection: {
    order: ["localStorage", "navigator"],
    lookupLocalStorage: "stellar-marketpay:locale",
    caches: ["localStorage"],
  },
};
