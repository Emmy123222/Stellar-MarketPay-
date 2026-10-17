/**
 * Shared i18n initialisation.
 *
 * next-i18next only initialises its i18next instance on the client (no page
 * calls serverSideTranslations), so prerendering crashed with `t is not a
 * function` / `changeLanguage is not a function`. This module initialises a
 * single i18next instance with the bundled locale resources and re-exports
 * react-i18next's `useTranslation`, so every importer gets a working
 * translator on both the server and the client.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../public/locales/en/common.json";
import es from "../public/locales/es/common.json";
import fr from "../public/locales/fr/common.json";
import pt from "../public/locales/pt/common.json";

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { common: en },
      es: { common: es },
      fr: { common: fr },
      pt: { common: pt },
    },
    lng: "en",
    fallbackLng: "en",
    supportedLngs: ["en", "es", "fr", "pt"],
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
  });
}

export { useTranslation } from "react-i18next";
export default i18n;
