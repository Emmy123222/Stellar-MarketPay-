/**
 * components/Navbar.tsx
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { shortenAddress } from "@/utils/format";
import clsx from "clsx";
import { useTranslation } from "@/lib/i18n";
import FaucetButton from "@/components/FaucetButton";

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
];

const STELLAR_NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";

export default function Navbar({ publicKey, onConnect, onDisconnect }: NavbarProps) {
  const router = useRouter();
  const { i18n } = useTranslation("common");
  const [hasNotification, setHasNotification] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const t = (key: string): string => i18n.t(key) as string;

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

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      return;
    }

    let cancelled = false;
    const fetchBalance = async () => {
      setBalanceLoading(true);
      try {
        const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
        const res = await fetch(`${horizonUrl}/accounts/${publicKey}`);
        if (!res.ok) throw new Error("Failed to fetch balance");
        const data = await res.json();
        const xlmBalance = data.balances?.find((b: any) => b.asset_type === "native");
        if (!cancelled && xlmBalance) {
          setBalance(parseFloat(xlmBalance.balance).toFixed(2));
        }
      } catch (err) {
        console.error("Balance fetch error:", err);
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [publicKey]);

  const switchLanguage = (locale: string) => {
    router.push(router.pathname, router.asPath, { locale });
    localStorage.setItem("preferredLocale", locale);
  };

  useEffect(() => {
    const savedLocale = localStorage.getItem("preferredLocale");
    if (savedLocale && savedLocale !== i18n.language) {
      switchLanguage(savedLocale);
    }
  }, []);

  return (
    <nav className="sticky top-0 z-50 border-b border-[rgba(251,191,36,0.10)] bg-ink-900/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link href="/" locale={false} className="flex items-center gap-2.5 group flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-market-500/15 border border-market-500/25 flex items-center justify-center group-hover:border-market-500/50 transition-colors">
            <BriefcaseIcon className="w-4 h-4 text-market-400" />
          </div>
          <span className="font-display font-bold text-amber-100 text-lg tracking-tight">
            Stellar<span className="text-market-400">MarketPay</span>
          </span>
        </Link>

        {/* Network badge */}
        <span className={clsx(
          "hidden md:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border flex-shrink-0",
          STELLAR_NETWORK === "mainnet"
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
        )}>
          {STELLAR_NETWORK === "mainnet" ? "Mainnet" : "Testnet"}
        </span>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href} locale={false}
              className={clsx(
                "px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 relative",
                router.pathname === l.href
                  ? "bg-market-500/12 text-market-300"
                  : "text-amber-700 hover:text-amber-300 hover:bg-market-500/8"
              )}
            >
              {t(l.labelKey)}
              {l.href === "/dashboard" && hasNotification && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-400 rounded-full border border-ink-900" />
              )}
            </Link>
          ))}
        </div>

        {/* Language Switcher */}
        <div className="hidden md:flex items-center">
          <select
            value={i18n.language}
            onChange={(e) => switchLanguage(e.target.value)}
            className="bg-market-900/40 border border-amber-900/30 rounded px-2 py-1 text-xs text-amber-100 cursor-pointer"
            aria-label={t("language.switch") as string}
          >
            <option value="en">{t("language.english")}</option>
            <option value="es">{t("language.spanish")}</option>
          </select>
        </div>

        {/* Wallet */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {publicKey ? (
            <>
              <button
                onClick={() => router.push("/dashboard/transactions")}
                className="flex items-center gap-1.5 address-tag cursor-pointer hover:opacity-80 transition-opacity"
                title={t("wallet.balance") as string}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {shortenAddress(publicKey)}
                {balanceLoading ? (
                  <span className="text-xs text-amber-800">{t("wallet.loading")}</span>
                ) : balance ? (
                  <span className="text-xs font-medium text-market-400">{balance} XLM</span>
                ) : null}
              </button>
              <button onClick={onDisconnect} className="text-xs text-amber-800 hover:text-amber-500 transition-colors px-2 py-1">
                {t("nav.disconnect")}
              </button>
            </>
          ) : (
            <button onClick={onConnect} className="btn-primary text-sm py-2 px-4">
              {t("nav.connectWallet")}
            </button>
          )}
        </div>
      </div>
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
