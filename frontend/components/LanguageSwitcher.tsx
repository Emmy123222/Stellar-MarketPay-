/**
 * components/LanguageSwitcher.tsx
 * Navbar language selector with localStorage persistence (#282).
 */
import { useRouter } from "next/router";
import { useTranslation } from "@/lib/i18n";

const LOCALES = [
  { code: "en", labelKey: "language.english" },
  { code: "es", labelKey: "language.spanish" },
  { code: "fr", labelKey: "language.french" },
  { code: "pt", labelKey: "language.portuguese" },
] as const;

interface LanguageSwitcherProps {
  className?: string;
}

export default function LanguageSwitcher({ className = "" }: LanguageSwitcherProps) {
  const router = useRouter();
  const { t, i18n } = useTranslation("common");

  const switchLanguage = async (lang: string) => {
    await i18n.changeLanguage(lang);
    if (typeof window !== "undefined") {
      localStorage.setItem("preferredLocale", lang);
    }

    // Keep Next.js locale routing in sync with the next-i18next instance while
    // preserving the current path, query string, and hash.
    if (router.locale !== lang) {
      await router.push(router.asPath, router.asPath, { locale: lang });
    }
  };

  const baseLang = i18n.language?.split("-")[0] || "en";

  return (
    <select
      value={baseLang}
      onChange={(e) => switchLanguage(e.target.value)}
      className={
        className ||
        "bg-market-900/40 border border-amber-900/30 rounded px-2 py-1 text-xs text-amber-100 cursor-pointer"
      }
      aria-label={t("language.switch")}
    >
      {LOCALES.map(({ code, labelKey }) => (
        <option key={code} value={code}>
          {t(labelKey)}
        </option>
      ))}
    </select>
  );
}
