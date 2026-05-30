/**
 * lib/i18n.js
 * i18next setup with browser language detection and localStorage persistence (#282).
 */
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

const resources = {
  en: { common: require("../public/locales/en/common.json") },
  es: { common: require("../public/locales/es/common.json") },
  fr: { common: require("../public/locales/fr/common.json") },
  pt: { common: require("../public/locales/pt/common.json") },
};

if (typeof window !== "undefined") {
  const stored = localStorage.getItem("preferredLocale");
  if (stored && resources[stored]) {
    i18next.changeLanguage(stored);
  }
}

const resources = {
  en: { common: require("../public/locales/en/common.json") },
  es: { common: require("../public/locales/es/common.json") },
  fr: { common: require("../public/locales/fr/common.json") },
  pt: { common: require("../public/locales/pt/common.json") },
};

if (typeof window !== "undefined") {
  const stored = localStorage.getItem("preferredLocale");
  if (stored && resources[stored]) {
    i18next.changeLanguage(stored);
  }
}

i18next.use(LanguageDetector).init({
  resources,
  fallbackLng: "en",
  supportedLngs: ["en", "es", "fr", "pt"],
  ns: ["common"],
  defaultNS: "common",
  detection: {
    order: ["localStorage", "navigator"],
    lookupLocalStorage: "preferredLocale",
    caches: ["localStorage"],
  },
  interpolation: { escapeValue: false },
});

i18next.on("languageChanged", (lng) => {
  if (typeof window !== "undefined") {
    localStorage.setItem("preferredLocale", lng);
  }
});

export default i18next;

export function useTranslation(ns = "common") {
  const i18n = i18next;

  const t = (key, options) => i18n.getFixedT(null, ns)(key, options);

  return { t, i18n, ready: i18n.isInitialized };
}

export function appWithTranslation(Component) {
  return function WrappedComponent(props) {
    return Component(props);
  };
}
