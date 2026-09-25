/**
 * components/WalletAddressDisplay.tsx
 *
 * Reusable wallet chip for the connected Stellar account. It was first
 * referenced (and imported) by PR #936 but the file itself was never
 * committed, which broke the frontend build until the usage was reverted.
 *
 * Renders the shortened address, the live XLM/USDC balances, and a
 * copy-to-clipboard affordance. Clicking the chip navigates to the
 * transaction history, matching the behaviour of the button it replaced.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import { useTranslation } from "@/lib/i18n";
import { shortenAddress, copyToClipboard } from "@/utils/format";
import { getXLMBalance, getUSDCBalance } from "@/lib/stellar";

interface WalletAddressDisplayProps {
  /** Stellar public key to display. */
  address: string;
  /** Extra classes merged onto the chip container. */
  className?: string;
  /** Leading/trailing character count for the shortened address (default 6). */
  truncatedChars?: number;
  /** Override the default click behaviour (navigate to transaction history). */
  onClick?: () => void;
}

export default function WalletAddressDisplay({
  address,
  className,
  truncatedChars = 6,
  onClick,
}: WalletAddressDisplayProps) {
  const router = useRouter();
  const { t } = useTranslation("common");
  const [balance, setBalance] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBalanceLoading(true);
    Promise.all([getXLMBalance(address), getUSDCBalance(address)])
      .then(([xlm, usdc]) => {
        if (cancelled) return;
        setBalance(Number(xlm).toFixed(2));
        setUsdcBalance(Number(usdc).toFixed(2));
      })
      .catch(() => {
        if (cancelled) return;
        setBalance("0.00");
        setUsdcBalance("0.00");
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const handleNavigate = () => {
    if (onClick) {
      onClick();
    } else {
      router.push("/dashboard/transactions");
    }
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(address);
    if (ok) {
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
      window.setTimeout(() => setCopyFailed(false), 2000);
    }
  };

  return (
    <div
      className={clsx(
        "flex items-center gap-1 sm:gap-1.5 address-tag cursor-pointer hover:opacity-80 transition-opacity text-xs sm:text-sm px-2 py-2 sm:px-3 sm:py-2 min-h-[44px]",
        className,
      )}
    >
      <button
        type="button"
        onClick={handleNavigate}
        className="flex items-center gap-1 sm:gap-1.5 min-h-[44px]"
        title={t("wallet.balance")}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="hidden sm:inline">
          {shortenAddress(address, truncatedChars)}
        </span>
        <span className="sm:hidden text-[10px]">{shortenAddress(address, 6)}</span>
        {balanceLoading ? (
          <span className="text-xs text-amber-800">{t("wallet.loading")}</span>
        ) : balance !== null && usdcBalance !== null ? (
          <span className="text-xs font-medium text-market-400 hidden sm:inline">
            {balance} XLM / {usdcBalance} USDC
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={t("wallet.copyAddress")}
        title={t("wallet.copyAddress")}
        className={clsx(
          "p-1.5 rounded-md transition-all flex items-center justify-center h-7 min-w-[28px]",
          copied
            ? "text-emerald-400 bg-emerald-400/10 border border-emerald-400/20"
            : copyFailed
              ? "text-red-400 bg-red-400/10 border border-red-400/20"
              : "text-amber-600 hover:text-amber-300 hover:bg-amber-400/10 border border-transparent",
        )}
      >
        {copied ? (
          <span className="text-xs font-medium px-1">{t("wallet.copied")}</span>
        ) : copyFailed ? (
          <span className="text-xs font-medium px-1">{t("wallet.copyFailed")}</span>
        ) : (
          <CopyIcon className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
