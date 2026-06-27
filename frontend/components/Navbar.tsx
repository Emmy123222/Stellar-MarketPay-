/**
 * components/Navbar.tsx
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { shortenAddress } from "@/utils/format";
import clsx from "clsx";
import { useTranslation } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import FaucetButton from "@/components/FaucetButton";
import i18next from "@/lib/i18n";
import { usePriceContext } from "@/contexts/PriceContext";
import NotificationBell from "@/components/NotificationBell";

interface NavbarProps {
  publicKey: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

const links = [
  { href: "/",            labelKey: "nav.home" },
  { href: "/jobs",        labelKey: "nav.browseJobs" },
  { href: "/dashboard",   labelKey: "nav.dashboard" },
  { href: "/post-job",    labelKey: "nav.postJob" },
  { href: "/insights",    labelKey: "nav.insights" },
  { href: "/developer",   labelKey: "nav.developer" },
  { href: "/dao",           labelKey: "nav.dao" },
];

const STELLAR_NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";

export default function Navbar({ publicKey, onConnect, onDisconnect }: NavbarProps) {
  const router = useRouter();
  const { t, i18n } = useTranslation("common");
  const [hasNotification, setHasNotification] = useState(false);
  const [hasJobAlertBadge, setHasJobAlertBadge] = useState(false);
  const { currencyMode, setCurrencyMode, priceLoading } = usePriceContext();
  const [darkMode, setDarkMode] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Dark mode initialization — respect OS preference on first visit
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "dark" || stored === "light") {
        setDarkMode(stored === "dark");
        document.documentElement.classList.toggle("dark", stored === "dark");
      } else {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setDarkMode(prefersDark);
        document.documentElement.classList.toggle("dark", prefersDark);
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const handleActivity = () => {
      if (router.pathname !== "/dashboard") {
        setHasNotification(true);
      }
    };

    window.addEventListener("stellar-activity", handleActivity);
    return () => window.removeEventListener("stellar-activity", handleActivity);
  }, [router.pathname]);

  useEffect(() => {
    if (router.pathname === "/dashboard") {
      setHasNotification(false);
    }
  }, [router.pathname]);

  // Job-alert badge on Browse Jobs
  useEffect(() => {
    const handleAlertMatches = (e: Event) => {
      const count = (e as CustomEvent<{ count: number }>).detail?.count ?? 0;
      if (router.pathname !== "/jobs") {
        setHasJobAlertBadge(count > 0);
      }
    };
    window.addEventListener("job-alert-matches", handleAlertMatches);
    return () => window.removeEventListener("job-alert-matches", handleAlertMatches);
  }, [router.pathname]);

  useEffect(() => {
    if (router.pathname === "/jobs") {
      setHasJobAlertBadge(false);
    }
  }, [router.pathname]);

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [router.pathname]);

  const switchLanguage = (lang: string) => {
    localStorage.setItem("preferredLocale", lang);
    i18next.changeLanguage(lang);
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-[rgba(251,191,36,0.10)] bg-ink-900/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-4">

        {/* Logo */}
        <Link href="/" locale={false} className="flex items-center gap-2.5 group flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-market-500/15 border border-market-500/25 flex items-center justify-center group-hover:border-market-500/50 transition-colors">
            <BriefcaseIcon className="w-4 h-4 text-market-400" />
          </div>
          <span className="hidden sm:inline font-display font-bold text-amber-100 text-lg tracking-tight">
            Stellar<span className="text-market-400">MarketPay</span>
          </span>
          <span className="sm:hidden font-display font-bold text-amber-100 text-sm tracking-tight">
            <span className="text-market-400">SMP</span>
          </span>
        </Link>

        {/* Network badge - hidden on mobile */}
        <span className={clsx(
          "hidden lg:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border flex-shrink-0",
          STELLAR_NETWORK === "mainnet"
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
        )}>
          {STELLAR_NETWORK === "mainnet" ? "Mainnet" : "Testnet"}
        </span>

        {/* Desktop Nav links */}
        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href} locale={false}
              className={clsx(
                "px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 relative min-h-[44px] flex items-center",
                router.pathname === l.href
                  ? "bg-market-500/12 text-market-300"
                  : "text-amber-700 hover:text-amber-300 hover:bg-market-500/8"
              )}
            >
              {t(l.labelKey)}
              {l.href === "/dashboard" && hasNotification && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-400 rounded-full border border-ink-900" />
              )}
              {l.href === "/jobs" && hasJobAlertBadge && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-market-400 rounded-full border border-ink-900" />
              )}
            </Link>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1 md:flex-none" />

        {/* Language Switcher - hidden on mobile, visible on tablet+ */}
        <div className="hidden sm:flex items-center">
          <select
            value={i18n.language}
            onChange={(e) => switchLanguage(e.target.value)}
            className="bg-market-900/40 border border-amber-900/30 rounded px-2 py-1 text-xs text-amber-100 cursor-pointer min-h-[44px]"
          >
            <option value="en">EN</option>
            <option value="es">ES</option>
            <option value="fr">FR</option>
            <option value="pt">PT</option>
          </select>
        </div>
        {/* Currency Toggle */}
        <div className="hidden md:flex items-center">
          <button
            onClick={() => setCurrencyMode(currencyMode === "XLM" ? "USD" : "XLM")}
            disabled={priceLoading}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-150",
              currencyMode === "USD"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-market-500/10 text-market-400 border-market-500/20",
              priceLoading && "opacity-50 cursor-not-allowed"
            )}
            title={currencyMode === "XLM" ? "Switch to USD" : "Switch to XLM"}
            aria-label={`Currency: ${currencyMode}. Click to switch`}
          >
            {priceLoading ? (
              <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="text-[10px] font-bold">{currencyMode === "XLM" ? "◎" : "$"}</span>
            )}
            {currencyMode}
          </button>
        </div>

        {/* Dark Mode Toggle */}
        <div className="hidden md:flex items-center">
          <button
            onClick={toggleDarkMode}
            className="p-1.5 rounded-lg text-amber-700 hover:text-amber-300 hover:bg-market-500/8 transition-colors"
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>

        {/* Language Switcher */}
        <div className="hidden md:flex items-center">
          <select
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="bg-market-900/40 border border-amber-900/30 rounded px-2 py-1 text-xs text-amber-100 cursor-pointer"
            aria-label={t("language.switch") as string}
          >
            <option value="en">{t("language.english")}</option>
            <option value="es">{t("language.spanish")}</option>
          </select>
        </div>

        {/* Wallet - responsive */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          {publicKey ? (
            <>
              <NotificationBell publicKey={publicKey} />
              <button
                onClick={() => router.push("/dashboard/transactions")}
                className="flex items-center gap-1 sm:gap-1.5 address-tag cursor-pointer hover:opacity-80 transition-opacity text-xs sm:text-sm px-2 py-2 sm:px-3 sm:py-2 min-h-[44px]"
                title={t("wallet.balance") as string}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="hidden sm:inline">{shortenAddress(publicKey)}</span>
                <span className="sm:hidden text-[10px]">{shortenAddress(publicKey, 6)}</span>
                {balanceLoading ? (
                  <span className="text-xs text-amber-800">{t("wallet.loading")}</span>
                ) : balance ? (
                  <span className="text-xs font-medium text-market-400 hidden sm:inline">{balance}</span>
                ) : null}
              </button>
              <button 
                onClick={onDisconnect} 
                className="hidden sm:inline text-xs text-amber-800 hover:text-amber-500 transition-colors px-2 py-1"
              >
                {t("nav.disconnect")}
              </button>
            </>
          ) : (
            <button 
              onClick={onConnect} 
              className="btn-primary text-xs sm:text-sm py-2 px-3 sm:px-4 min-h-[44px] flex items-center"
            >
              {t("nav.connectWallet")}
            </button>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden w-10 h-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-market-500/10 transition-colors"
          aria-label="Toggle menu"
          aria-expanded={mobileMenuOpen}
        >
          <HamburgerIcon className="w-5 h-5 text-amber-300" />
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[rgba(251,191,36,0.10)] bg-ink-900/95 backdrop-blur-xl">
          <div className="px-4 py-4 space-y-2">
            {/* Mobile Nav Links */}
            {links.map((l) => (
              <Link key={l.href} href={l.href} locale={false}
                className={clsx(
                  "px-3 py-3 rounded-lg text-sm font-medium transition-all duration-150 relative min-h-[44px] flex items-center",
                  router.pathname === l.href
                    ? "bg-market-500/12 text-market-300"
                    : "text-amber-700 hover:text-amber-300 hover:bg-market-500/8"
                )}
              >
                {t(l.labelKey)}
                {l.href === "/dashboard" && hasNotification && (
                  <span className="absolute top-3 right-3 w-2 h-2 bg-emerald-400 rounded-full border border-ink-900" />
                )}
                {l.href === "/jobs" && hasJobAlertBadge && (
                  <span className="absolute top-3 right-3 w-2 h-2 bg-market-400 rounded-full border border-ink-900" />
                )}
              </Link>
            ))}

            {/* Mobile Language Switcher */}
            <div className="flex items-center px-3 py-2">
              <select
                value={i18n.language}
                onChange={(e) => switchLanguage(e.target.value)}
                className="bg-market-900/40 border border-amber-900/30 rounded px-2 py-2 text-xs text-amber-100 cursor-pointer w-full min-h-[44px]"
                aria-label={t("language.switch") as string}
              >
                <option value="en">{t("language.english")}</option>
                <option value="es">{t("language.spanish")}</option>
              </select>
            </div>

            {/* Mobile Disconnect Button */}
            {publicKey && (
              <button 
                onClick={() => {
                  onDisconnect();
                  setMobileMenuOpen(false);
                }} 
                className="w-full text-left text-xs text-amber-800 hover:text-amber-500 transition-colors px-3 py-3 rounded-lg hover:bg-market-500/8 min-h-[44px] flex items-center"
              >
                {t("nav.disconnect")}
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

function BriefcaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
    </svg>
  );
}

function HamburgerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
    </svg>
  );
}
