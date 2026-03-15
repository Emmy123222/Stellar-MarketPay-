/**
 * components/Navbar.tsx
 */
import Link from "next/link";
import { useRouter } from "next/router";
import { shortenAddress } from "@/utils/format";
import clsx from "clsx";

interface NavbarProps {
  publicKey: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

const links = [
  { href: "/",            label: "Home" },
  { href: "/jobs",        label: "Browse Jobs" },
  { href: "/dashboard",   label: "Dashboard" },
  { href: "/post-job",    label: "Post a Job" },
];

export default function Navbar({ publicKey, onConnect, onDisconnect }: NavbarProps) {
  const router = useRouter();

  return (
    <nav className="sticky top-0 z-50 border-b border-[rgba(251,191,36,0.10)] bg-ink-900/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-market-500/15 border border-market-500/25 flex items-center justify-center group-hover:border-market-500/50 transition-colors">
            <BriefcaseIcon className="w-4 h-4 text-market-400" />
          </div>
          <span className="font-display font-bold text-amber-100 text-lg tracking-tight">
            Stellar<span className="text-market-400">MarketPay</span>
          </span>
        </Link>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={clsx(
                "px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                router.pathname === l.href
                  ? "bg-market-500/12 text-market-300"
                  : "text-amber-700 hover:text-amber-300 hover:bg-market-500/8"
              )}
            >{l.label}</Link>
          ))}
        </div>

        {/* Wallet */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {publicKey ? (
            <>
              <div className="flex items-center gap-1.5 address-tag">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {shortenAddress(publicKey)}
              </div>
              <button onClick={onDisconnect} className="text-xs text-amber-800 hover:text-amber-500 transition-colors px-2 py-1">
                Disconnect
              </button>
            </>
          ) : (
            <button onClick={onConnect} className="btn-primary text-sm py-2 px-4">
              Connect Wallet
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
