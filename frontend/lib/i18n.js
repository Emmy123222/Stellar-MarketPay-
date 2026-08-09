/**
 * Shared next-i18next exports.
 *
 * `appWithTranslation` in pages/_app.tsx supplies the configured i18next
 * instance to these hooks. Keeping this small adapter preserves the existing
 * application import path while ensuring components re-render on locale changes.
 */
export { appWithTranslation, useTranslation } from "next-i18next/pages";
