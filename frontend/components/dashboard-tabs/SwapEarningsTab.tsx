/**
 * components/dashboard-tabs/SwapEarningsTab.tsx
 *
 * Issue #1547: Dashboard "Swap earnings" flow.
 *
 * Prices the entered XLM amount with Horizon `strictSendPaths` (rate, estimated
 * USDC received and network fee), has the wallet sign a
 * `pathPaymentStrictSend` XLM → USDC via Freighter, then records the swap in
 * the payment history.
 */
import { useEffect, useRef, useState } from "react";
import {
  completeAutoConversion,
  createManualSwap,
  dismissAutoConversion,
  fetchAutoConvertHistory,
  fetchSwapQuote,
} from "@/lib/api";
import { executeAutoConvertSwap } from "@/lib/stellar";
import type { AutoConversion, SwapQuote } from "@/utils/types";
import { useToast } from "@/components/Toast";
import { formatXLM, shortenAddress, timeAgo } from "@/utils/format";
import clsx from "clsx";

interface Props {
  publicKey: string | null;
  xlmBalance?: string | null;
  usdcBalance?: string | null;
  onSwapComplete?: () => void;
}

const QUOTE_DEBOUNCE_MS = 500;

function formatUsdc(value: string | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4);
}

function statusClass(status: AutoConversion["status"]): string {
  switch (status) {
    case "completed":
      return "bg-green-500/10 text-green-400 border-green-500/20";
    case "failed":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "skipped":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    default:
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  }
}

export default function SwapEarningsTab({
  publicKey,
  xlmBalance,
  usdcBalance,
  onSwapComplete,
}: Props) {
  const toast = useToast();

  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);

  const [history, setHistory] = useState<AutoConversion[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(true);
  // Bumped after a confirmed swap so the payment history refetches.
  const [historyReloadKey, setHistoryReloadKey] = useState(0);

  const isMountedRef = useRef(true);
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    isMountedRef.current = true;
    fetchAutoConvertHistory({ page: historyPage, limit: 10 })
      .then((data) => {
        if (!isMountedRef.current) return;
        setHistory(data?.conversions || []);
        setHistoryTotalPages(data?.pagination?.totalPages || 1);
      })
      .catch((err) => console.error("Failed to load swap history:", err))
      .finally(() => {
        if (isMountedRef.current) setLoadingHistory(false);
      });
    return () => {
      isMountedRef.current = false;
    };
  }, [publicKey, historyPage, historyReloadKey]);

  // Debounced Horizon quote so the rate / receive / fee update while typing.
  useEffect(() => {
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    const trimmed = amount.trim();

    quoteTimerRef.current = setTimeout(async () => {
      const parsed = Number(trimmed);
      if (!trimmed || !Number.isFinite(parsed) || parsed <= 0) {
        setQuote(null);
        setQuoteError(null);
        setQuoting(false);
        return;
      }

      setQuoting(true);
      setQuoteError(null);
      try {
        const fresh = await fetchSwapQuote(trimmed);
        if (isMountedRef.current) setQuote(fresh);
      } catch (err: any) {
        if (isMountedRef.current) {
          setQuote(null);
          setQuoteError(
            err?.response?.data?.error ||
              "Could not fetch a swap quote right now.",
          );
        }
      } finally {
        if (isMountedRef.current) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    };
  }, [amount]);

  const amountIsValid = Number(amount.trim()) > 0;
  const canSwap = Boolean(
    publicKey && quote && amountIsValid && !swapping && !quoting,
  );

  const handleMax = () => {
    if (!xlmBalance) return;
    // Keep a small reserve for the network fee and the 1 XLM minimum balance.
    const max = Math.max(0, Number(xlmBalance) - 1);
    if (max > 0) setAmount(max.toFixed(7));
  };

  const handleSwap = async () => {
    if (!publicKey || !quote || swapping) return;
    setSwapping(true);
    let conversionId: string | null = null;
    try {
      toast.info("Please sign the XLM → USDC swap in your Stellar wallet...");

      const start = await createManualSwap(quote.sourceAmountXlm);
      conversionId = start.conversion.id;

      const swapResult = await executeAutoConvertSwap({
        fromPublicKey: publicKey,
        sourceAmountXlm: start.quote.sourceAmountXlm,
        destMinUsdc: start.conversion.destMinUsdc || start.quote.destMinUsdc,
        path: start.quote.path,
        destination: publicKey,
      });

      const completed = await completeAutoConversion(
        conversionId,
        swapResult.hash,
      );
      conversionId = null;

      toast.success(
        `Swapped ${completed.sourceAmountXlm} XLM for ${completed.receivedUsdc} USDC (1 XLM = ${completed.exchangeRate} USDC).`,
      );
      setAmount("");
      setQuote(null);
      setHistoryReloadKey((k) => k + 1);
      onSwapComplete?.();
    } catch (err: any) {
      // The on-chain swap did not complete — release the pending row so it
      // does not linger in the queue.
      if (conversionId) {
        await dismissAutoConversion(conversionId, {
          status: "failed",
          error: err?.message,
        }).catch(() => {});
      }
      toast.error(
        err?.message || "Failed to execute the swap. Please try again.",
      );
    } finally {
      if (isMountedRef.current) setSwapping(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="card">
        <h3 className="font-display text-lg font-bold text-amber-100 mb-1">
          Swap earnings
        </h3>
        <p className="text-amber-800 text-sm mb-6">
          Convert XLM earnings to USDC instantly on the Stellar decentralized
          exchange. The best available path is quoted live from Horizon.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="rounded-xl border border-market-500/15 bg-ink-900/40 p-4">
            <p className="text-xs uppercase tracking-wider text-amber-800 font-semibold mb-1">
              XLM balance
            </p>
            <p className="font-mono text-amber-100">
              {xlmBalance != null ? formatXLM(xlmBalance) : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-market-500/15 bg-ink-900/40 p-4">
            <p className="text-xs uppercase tracking-wider text-amber-800 font-semibold mb-1">
              USDC balance
            </p>
            <p className="font-mono text-amber-100">
              {usdcBalance != null ? `${formatUsdc(usdcBalance)} USDC` : "—"}
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <label htmlFor="swap-amount-xlm" className="label">
              Amount to swap (XLM)
            </label>
            <div className="flex gap-2">
              <input
                id="swap-amount-xlm"
                type="number"
                min="0"
                step="0.0000001"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0000000"
                className="input-field font-mono"
              />
              <button
                type="button"
                onClick={handleMax}
                disabled={!xlmBalance}
                className="btn-secondary px-4 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Max
              </button>
            </div>
          </div>

          {/* Live quote: rate, estimated receive and fee */}
          <div className="rounded-xl border border-market-500/20 bg-ink-900/40 p-4 space-y-3">
            {quoting && (
              <p className="text-xs text-amber-600 animate-pulse">
                Fetching best path…
              </p>
            )}
            {quoteError && !quoting && (
              <p className="text-xs text-red-400">{quoteError}</p>
            )}
            {!quote && !quoting && !quoteError && (
              <p className="text-xs text-amber-700">
                Enter an amount to see the live rate, estimated USDC and fee.
              </p>
            )}
            {quote && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-amber-800 font-semibold mb-1">
                    Rate
                  </dt>
                  <dd className="font-mono text-amber-100">
                    1 XLM = {formatUsdc(quote.rate)} USDC
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-amber-800 font-semibold mb-1">
                    Estimated receive
                  </dt>
                  <dd className="font-mono text-market-400 font-semibold">
                    {formatUsdc(quote.destinationAmount)} USDC
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-amber-800 font-semibold mb-1">
                    Network fee
                  </dt>
                  <dd className="font-mono text-amber-100">
                    {formatXLM(quote.feeXlm, 7)} XLM
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-amber-800 font-semibold mb-1">
                    Minimum received
                  </dt>
                  <dd className="font-mono text-amber-100">
                    {formatUsdc(quote.destMinUsdc)} USDC
                    <span className="ml-1 text-xs text-amber-700 font-sans">
                      ({(quote.slippageBps / 100).toFixed(1)}% slippage)
                    </span>
                  </dd>
                </div>
              </dl>
            )}
          </div>

          <button
            onClick={handleSwap}
            disabled={!canSwap}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {swapping ? (
              <>
                <Spinner />
                Swapping…
              </>
            ) : (
              "Swap earnings to USDC"
            )}
          </button>
        </div>
      </div>

      {/* Payment history — refreshed after each confirmed swap */}
      <div className="card">
        <h3 className="font-display text-lg font-bold text-amber-100 mb-4">
          Swap payment history
        </h3>
        {loadingHistory && history.length === 0 ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-market-500/8 rounded-lg" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <p className="text-amber-800 text-sm">
            No XLM → USDC swaps yet. Your conversions will appear here.
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-market-500/12 bg-ink-900/30 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-mono text-amber-100 text-sm">
                    {formatXLM(h.sourceAmountXlm)} XLM →{" "}
                    {h.receivedUsdc
                      ? `${formatUsdc(h.receivedUsdc)}`
                      : formatUsdc(h.quotedUsdc)}{" "}
                    USDC
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    {h.exchangeRate
                      ? `1 XLM = ${formatUsdc(h.exchangeRate)} USDC · `
                      : ""}
                    {timeAgo(h.createdAt)}
                    {h.txHash ? ` · ${shortenAddress(h.txHash, 6)}` : ""}
                  </p>
                </div>
                <span
                  className={clsx(
                    "self-start sm:self-center text-xs px-2.5 py-0.5 rounded-full border capitalize",
                    statusClass(h.status),
                  )}
                >
                  {h.status}
                </span>
              </div>
            ))}
            {historyTotalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => {
                    setLoadingHistory(true);
                    setHistoryPage((p) => Math.max(1, p - 1));
                  }}
                  disabled={historyPage <= 1}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-amber-700">
                  Page {historyPage} of {historyTotalPages}
                </span>
                <button
                  onClick={() => {
                    setLoadingHistory(true);
                    setHistoryPage((p) => Math.min(historyTotalPages, p + 1));
                  }}
                  disabled={historyPage >= historyTotalPages}
                  className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
