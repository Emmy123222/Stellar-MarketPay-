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

// Node.js 18+ exposes navigator.language reflecting the OS locale. If we
// run LanguageDetector on the server it picks up the OS locale (e.g. "es")
// and SSR renders translated text in that language, while the client (which
// starts from fallbackLng "en" before the detector fires) renders "en" —
// causing a React hydration mismatch. Skip the detector during SSR and pin
// the server to "en"; the detector only runs in the browser where it can
// safely read localStorage/navigator without affecting the SSR output.
const isBrowser = typeof window !== "undefined";

if (isBrowser) {
  i18next.use(LanguageDetector);
}

i18next.use(initReactI18next).init({
  resources,
  lng: isBrowser ? undefined : "en",
  fallbackLng: "en",
  supportedLngs: ["en", "es", "fr", "pt"],
  ns: ["common"],
  defaultNS: "common",
  detection: isBrowser
    ? {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: "preferredLocale",
        caches: ["localStorage"],
      }
    : undefined,
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
  const t = (key, options) => {
      if (typeof i18n.getFixedT === 'function') {
          return i18n.getFixedT(null, ns)(key, options);
      }
      return key;
  };
  return { t, i18n, ready: i18n.isInitialized };
}

export function appWithTranslation(Component) {
  return function WrappedComponent(props) {
    return Component(props);
  };
}
