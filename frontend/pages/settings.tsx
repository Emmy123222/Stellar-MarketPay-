/**
 * pages/settings.tsx
 *
 * Issue #1560: Settings page with XLM earnings auto-convert to USDC option.
 *
 * Acceptance Criteria:
 *  - "Auto-convert earnings to USDC" toggle in the Settings page
 *  - When enabled, each escrow release triggers a pathPaymentStrictSend XLM→USDC swap
 *  - Conversion result and exchange rate stored in the payment history
 *  - User notified via notification + email of each auto-conversion
 */
import { useState, useEffect, useCallback, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import {
  fetchAutoConvertSettings,
  updateAutoConvertSettings,
  fetchPendingAutoConversions,
  completeAutoConversion,
  dismissAutoConversion,
  fetchAutoConvertHistory,
} from "@/lib/api";
import { executeAutoConvertSwap, accountUrl } from "@/lib/stellar";
import type { AutoConvertSettings, AutoConversion } from "@/utils/types";
import { shortenAddress, formatXLM } from "@/utils/format";
import { useToast } from "@/components/Toast";
import clsx from "clsx";

interface SettingsPageProps {
  publicKey: string | null;
  onConnect: () => void;
}

const STELLAR_EXPERT_TX_URL =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
    ? "https://stellar.expert/explorer/public/tx/"
    : "https://stellar.expert/explorer/testnet/tx/";

export default function SettingsPage({
  publicKey,
  onConnect,
}: SettingsPageProps) {
  const toast = useToast();

  const [settings, setSettings] = useState<AutoConvertSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [updatingSettings, setUpdatingSettings] = useState(false);

  // Pending conversions awaiting wallet signature
  const [pendingConversions, setPendingConversions] = useState<
    AutoConversion[]
  >([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [swappingId, setSwappingId] = useState<string | null>(null);

  // Payment conversion history
  const [history, setHistory] = useState<AutoConversion[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const isMountedRef = useRef(true);

  const loadSettingsAndPending = useCallback(async () => {
    if (!publicKey) return;
    setLoadingSettings(true);
    setLoadingPending(true);
    try {
      const [s, p] = await Promise.all([
        fetchAutoConvertSettings(),
        fetchPendingAutoConversions(),
      ]);
      if (isMountedRef.current) {
        setSettings(s);
        setPendingConversions(Array.isArray(p) ? p : []);
      }
    } catch (err: any) {
      console.error("Failed to load settings:", err);
    } finally {
      if (isMountedRef.current) {
        setLoadingSettings(false);
        setLoadingPending(false);
      }
    }
  }, [publicKey]);

  const loadHistory = useCallback(async () => {
    if (!publicKey) return;
    setLoadingHistory(true);
    try {
      const data = await fetchAutoConvertHistory({
        page: historyPage,
        limit: 10,
      });
      if (isMountedRef.current) {
        setHistory(data?.conversions || []);
        setHistoryTotalPages(data?.pagination?.totalPages || 1);
      }
    } catch (err: any) {
      console.error("Failed to load conversion history:", err);
    } finally {
      if (isMountedRef.current) {
        setLoadingHistory(false);
      }
    }
  }, [publicKey, historyPage]);

  useEffect(() => {
    isMountedRef.current = true;
    loadSettingsAndPending();
    loadHistory();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadSettingsAndPending, loadHistory]);

  const handleToggleAutoConvert = async () => {
    if (!settings || updatingSettings || !publicKey) return;
    const newEnabled = !settings.enabled;
    setUpdatingSettings(true);
    try {
      const updated = await updateAutoConvertSettings({ enabled: newEnabled });
      setSettings(updated);
      toast.success(
        newEnabled
          ? "Auto-convert enabled! Received XLM earnings will prompt for USDC conversion."
          : "Auto-convert disabled. XLM earnings will be kept in XLM.",
      );
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error || "Failed to update auto-convert settings.",
      );
    } finally {
      setUpdatingSettings(false);
    }
  };

  const handleUpdateSlippage = async (slippageBps: number) => {
    if (!settings || updatingSettings || !publicKey) return;
    setUpdatingSettings(true);
    try {
      const updated = await updateAutoConvertSettings({ slippageBps });
      setSettings(updated);
      toast.success(`Max slippage set to ${(slippageBps / 100).toFixed(1)}%`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to update slippage.");
    } finally {
      setUpdatingSettings(false);
    }
  };

  const handleExecuteSwap = async (item: AutoConversion) => {
    if (!publicKey) return;
    setSwappingId(item.id);
    try {
      if (!item.destMinUsdc) {
        throw new Error("Missing slippage quote. Please refresh quotes.");
      }

      toast.info(
        "Please sign the XLM → USDC conversion in your Stellar wallet...",
      );

      // Execute on-chain pathPaymentStrictSend XLM -> USDC to self
      const swapResult = await executeAutoConvertSwap({
        fromPublicKey: publicKey,
        sourceAmountXlm: item.sourceAmountXlm,
        destMinUsdc: item.destMinUsdc,
        path: item.path,
        destination: publicKey,
      });

      // Submit completed hash to backend for verification & notification
      const completed = await completeAutoConversion(item.id, swapResult.hash);

      toast.success(
        `Converted ${completed.sourceAmountXlm} XLM to ${completed.receivedUsdc} USDC! (Rate: 1 XLM = ${completed.exchangeRate} USDC)`,
      );

      // Refresh pending & history
      await Promise.all([loadSettingsAndPending(), loadHistory()]);
    } catch (err: any) {
      console.error("Auto-convert execution failed:", err);
      toast.error(err?.message || "Failed to execute swap transaction.");
    } finally {
      setSwappingId(null);
    }
  };

  const handleDismiss = async (
    item: AutoConversion,
    status: "failed" | "skipped",
  ) => {
    try {
      await dismissAutoConversion(item.id, { status });
      toast.info(
        status === "skipped"
          ? "Auto-conversion skipped for this payment."
          : "Marked as dismissed.",
      );
      await Promise.all([loadSettingsAndPending(), loadHistory()]);
    } catch (err: any) {
      toast.error(err?.message || "Failed to dismiss.");
    }
  };

  return (
    <>
      <Head>
        <title>Settings | Stellar MarketPay</title>
        <meta
          name="description"
          content="Configure your MarketPay account settings, payments, and USDC auto-conversion preferences."
        />
      </Head>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100">
                Account &amp; Payment Settings
              </h1>
              <p className="mt-1 text-sm text-amber-700">
                Manage your payment conversion rules, volatility hedging, and
                platform preferences.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="btn-secondary text-xs sm:text-sm self-start sm:self-auto"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        {!publicKey ? (
          <div className="card text-center py-16 px-6 border-market-500/20">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-2">
              Connect Your Wallet
            </h2>
            <p className="text-amber-700 text-sm max-w-md mx-auto mb-6">
              Connect your Stellar wallet to view and manage your payment
              auto-conversion settings.
            </p>
            <div className="flex justify-center">
              <WalletConnect onConnect={onConnect} />
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Auto-Convert Settings Card */}
            <div className="card border-market-500/25 bg-gradient-to-br from-market-950/40 via-ink-900 to-ink-950 p-6 sm:p-8">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-market-500/10 border border-market-500/20 flex items-center justify-center text-market-400 font-bold text-sm">
                      $
                    </span>
                    <h2 className="font-display text-xl font-bold text-amber-100">
                      Auto-Convert Earnings to USDC
                    </h2>
                  </div>
                  <p className="text-sm text-amber-700 leading-relaxed max-w-2xl">
                    Protect yourself against XLM price volatility. When enabled,
                    each escrow release for your completed jobs triggers an
                    automatic on-chain{" "}
                    <code className="px-1.5 py-0.5 rounded bg-ink-950 text-amber-300 font-mono text-xs">
                      pathPaymentStrictSend
                    </code>{" "}
                    swap from XLM to USDC directly on the Stellar decentralized
                    exchange (DEX).
                  </p>
                </div>

                {/* Toggle Switch */}
                <div className="flex items-center gap-3 self-start sm:self-auto">
                  <span className="text-xs font-semibold text-amber-300">
                    {settings?.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings?.enabled ?? false}
                    aria-label="Toggle auto-convert earnings to USDC"
                    disabled={loadingSettings || updatingSettings}
                    onClick={handleToggleAutoConvert}
                    className={clsx(
                      "relative inline-flex h-7 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-market-400 focus:ring-offset-2 focus:ring-offset-ink-900 disabled:opacity-50",
                      settings?.enabled ? "bg-market-500" : "bg-ink-700",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={clsx(
                        "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-amber-100 shadow ring-0 transition duration-200 ease-in-out",
                        settings?.enabled ? "translate-x-7" : "translate-x-0",
                      )}
                    />
                  </button>
                </div>
              </div>

              {/* Slippage Settings */}
              {settings?.enabled && (
                <div className="mt-6 pt-6 border-t border-market-500/15">
                  <label className="block text-xs font-semibold text-amber-200 uppercase tracking-wider mb-2">
                    Maximum Slippage Tolerance
                  </label>
                  <p className="text-xs text-amber-700 mb-3">
                    If the Stellar DEX exchange rate moves against you by more
                    than this amount during the swap, the transaction is
                    rejected to prevent unfavorable rates.
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { label: "0.5%", bps: 50 },
                      { label: "1.0% (Standard)", bps: 100 },
                      { label: "2.0%", bps: 200 },
                      { label: "3.0%", bps: 300 },
                    ].map((opt) => (
                      <button
                        key={opt.bps}
                        type="button"
                        onClick={() => handleUpdateSlippage(opt.bps)}
                        disabled={updatingSettings}
                        className={clsx(
                          "px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-all",
                          settings.slippageBps === opt.bps
                            ? "bg-market-400 text-ink-950 border-market-400 font-semibold shadow-md"
                            : "bg-ink-900 border-market-500/20 text-amber-300 hover:bg-market-500/10",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Pending Swaps Queue */}
            {(pendingConversions || []).length > 0 && (
              <div className="card border-amber-500/30 bg-amber-950/20 p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                    <h2 className="font-display text-lg font-bold text-amber-100">
                      Pending USDC Swaps ({pendingConversions.length})
                    </h2>
                  </div>
                  <span className="text-xs font-medium text-amber-400">
                    Awaiting 1-Click Signature
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-amber-700">
                  Escrow was released to your account. Your wallet can now
                  execute the swap from XLM to USDC on Stellar:
                </p>

                <div className="space-y-3">
                  {pendingConversions.map((conv) => (
                    <div
                      key={conv.id}
                      className="p-4 rounded-xl bg-ink-900/80 border border-market-500/20 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="font-semibold text-sm text-amber-100">
                          {conv.jobTitle || "Completed Escrow Release"}
                        </div>
                        <div className="text-xs text-amber-700 flex flex-wrap items-center gap-3">
                          <span>
                            Amount:{" "}
                            <strong className="text-amber-200">
                              {formatXLM(conv.sourceAmountXlm)} XLM
                            </strong>
                          </span>
                          <span>→</span>
                          <span>
                            Quoted:{" "}
                            <strong className="text-emerald-400">
                              {conv.quotedUsdc
                                ? `${conv.quotedUsdc} USDC`
                                : "Getting quote..."}
                            </strong>
                          </span>
                          <span>
                            (Min:{" "}
                            <span className="font-mono">
                              {conv.destMinUsdc || "—"} USDC
                            </span>
                            )
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleExecuteSwap(conv)}
                          disabled={swappingId === conv.id}
                          className="btn-primary text-xs py-2 px-4 whitespace-nowrap flex items-center gap-1.5"
                        >
                          {swappingId === conv.id ? (
                            <>
                              <svg
                                className="animate-spin h-3.5 w-3.5"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                  fill="none"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                />
                              </svg>
                              Converting...
                            </>
                          ) : (
                            <>
                              <svg
                                className="w-3.5 h-3.5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                                />
                              </svg>
                              Convert to USDC
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleDismiss(conv, "skipped")}
                          disabled={swappingId === conv.id}
                          className="btn-secondary text-xs py-2 px-3 text-amber-700 hover:text-amber-200"
                        >
                          Keep in XLM
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment & Conversion History */}
            <div className="card border-market-500/20 p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-bold text-amber-100">
                    Auto-Conversion Payment History
                  </h2>
                  <p className="text-xs text-amber-700">
                    Historical record of converted payments, exchange rates, and
                    on-chain swap transactions.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-market-500/15 text-xs text-amber-700 uppercase tracking-wider">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Job Title</th>
                      <th className="py-3 px-4">Sent XLM</th>
                      <th className="py-3 px-4">Received USDC</th>
                      <th className="py-3 px-4">Exchange Rate</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Transaction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-market-500/10">
                    {loadingHistory ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="py-10 text-center text-amber-700"
                        >
                          Loading conversion history...
                        </td>
                      </tr>
                    ) : history.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="py-10 text-center text-amber-700"
                        >
                          No auto-conversions recorded yet. Once an escrow
                          payment is converted, it will appear here.
                        </td>
                      </tr>
                    ) : (
                      history.map((h) => (
                        <tr
                          key={h.id}
                          className="hover:bg-market-500/5 transition-colors"
                        >
                          <td className="py-3 px-4 text-xs text-amber-700 whitespace-nowrap">
                            {new Date(h.createdAt).toLocaleDateString(
                              undefined,
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              },
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs font-medium text-amber-100 max-w-[200px] truncate">
                            {h.jobTitle ||
                              (h.jobId
                                ? shortenAddress(h.jobId, 4)
                                : "Payment")}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-amber-200">
                            {formatXLM(h.sourceAmountXlm)} XLM
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-emerald-400 font-semibold">
                            {h.receivedUsdc ? `${h.receivedUsdc} USDC` : "—"}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-amber-300">
                            {h.exchangeRate
                              ? `1 XLM = ${h.exchangeRate} USDC`
                              : "—"}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={clsx(
                                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold",
                                h.status === "completed" &&
                                  "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25",
                                h.status === "pending" &&
                                  "bg-amber-500/10 text-amber-300 border border-amber-500/30",
                                h.status === "failed" &&
                                  "bg-red-500/10 text-red-400 border border-red-500/25",
                                h.status === "skipped" &&
                                  "bg-ink-700 text-amber-700 border border-market-500/10",
                              )}
                            >
                              {h.status.charAt(0).toUpperCase() +
                                h.status.slice(1)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-xs font-mono">
                            {h.txHash ? (
                              <a
                                href={`${STELLAR_EXPERT_TX_URL}${h.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-market-400 hover:underline inline-flex items-center gap-1"
                              >
                                {shortenAddress(h.txHash, 4)} ↗
                              </a>
                            ) : (
                              <span className="text-amber-800">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {historyTotalPages > 1 && (
                <div className="pt-4 flex items-center justify-between border-t border-market-500/15 text-xs text-amber-700">
                  <span>
                    Page {historyPage} of {historyTotalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      disabled={historyPage <= 1 || loadingHistory}
                      className="btn-secondary text-xs py-1 px-3 disabled:opacity-40"
                    >
                      ← Prev
                    </button>
                    <button
                      onClick={() =>
                        setHistoryPage((p) =>
                          Math.min(historyTotalPages, p + 1),
                        )
                      }
                      disabled={
                        historyPage >= historyTotalPages || loadingHistory
                      }
                      className="btn-secondary text-xs py-1 px-3 disabled:opacity-40"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
