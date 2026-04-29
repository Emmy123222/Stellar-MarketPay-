/**
 * lib/i18n.js
 * Simple i18n implementation
 */
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";

i18next.use(LanguageDetector).init({
  resources: {
    en: {
      common: require("../public/locales/en/common.json"),
    },
    es: {
      common: require("../public/locales/es/common.json"),
    },
  },
  lng: typeof window !== "undefined" ? localStorage.getItem("preferredLocale") || "en" : "en",
  fallbackLng: "en",
  ns: ["common"],
  defaultNS: "common",
});

export default i18next;

export function useTranslation(ns = "common") {
  const i18n = i18next;
  
  const t = (key, options) => {
    return i18n.getFixedT(null, ns)(key, options);
  };

  return { t, i18n, ready: i18n.isInitialized };
}

export function appWithTranslation(Component) {
  return function WrappedComponent(props) {
    return Component(props);
  };
}
