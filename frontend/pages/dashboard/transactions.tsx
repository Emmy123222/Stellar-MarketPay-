/**
 * pages/dashboard/transactions.tsx
 * Transaction history page with Stellar explorer deep links
 */
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import WalletConnect from "@/components/WalletConnect";
import { server, explorerUrl, accountUrl, fetchMarketPayTransactions, type MarketPayTransaction } from "@/lib/stellar";
import { formatXLM, shortenAddress, timeAgo } from "@/utils/format";
import clsx from "clsx";
import { optionalClientEnv } from "@/lib/env";

// Using MarketPayTransaction from stellar.ts

type TransactionFilter = "all" | "sent" | "received" | "escrow";

interface DashboardProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

// ── CSV Export helpers ────────────────────────────────────────────────────────

const API_URL = optionalClientEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000");

/**
 * Download the CSV export using XMLHttpRequest so we can track progress via
 * the `progress` event.  Returns a cleanup function to abort in-flight requests.
 */
function downloadCsv(
  publicKey: string,
  filter: TransactionFilter,
  token: string | null,
  onProgress: (pct: number | null) => void,
  onDone: () => void,
  onError: (msg: string) => void
): () => void {
  const xhr = new XMLHttpRequest();
  const url = `${API_URL}/api/transactions/export?format=csv&account=${encodeURIComponent(publicKey)}&filter=${filter}`;

  xhr.open("GET", url, true);
  xhr.responseType = "blob";
  if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
  xhr.withCredentials = true;

  xhr.onprogress = (e) => {
    // Content-Length is not set for chunked responses — show indeterminate spinner
    // if lengthComputable is false, or a real percentage when it is.
    onProgress(e.lengthComputable && e.total > 0 ? Math.round((e.loaded / e.total) * 100) : null);
  };

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      const blob = xhr.response as Blob;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const date = new Date().toISOString().split("T")[0];
      a.download = `transactions-${publicKey.slice(0, 8)}-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      onDone();
    } else {
      onError(`Export failed (HTTP ${xhr.status})`);
    }
  };

  xhr.onerror = () => onError("Network error during export");
  xhr.onabort = () => onDone();

  xhr.send();
  return () => xhr.abort();
}

export default function TransactionHistory({ publicKey, onConnect }: DashboardProps) {
  const router = useRouter();
  const [transactions, setTransactions] = useState<MarketPayTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TransactionFilter>("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null); // null = indeterminate
  const [exportError, setExportError] = useState<string | null>(null);
  const abortExportRef = useRef<(() => void) | null>(null);

  function handleExport() {
    if (exporting || !publicKey) return;
    setExporting(true);
    setExportProgress(null);
    setExportError(null);

    // Retrieve stored JWT from cookie / localStorage to pass as Bearer token
    let token: string | null = null;
    if (typeof document !== "undefined") {
      const match = document.cookie.match(/(?:^|;\s*)token=([^;]*)/);
      token = match ? decodeURIComponent(match[1]) : null;
    }

    abortExportRef.current = downloadCsv(
      publicKey,
      filter,
      token,
      (pct) => setExportProgress(pct),
      () => { setExporting(false); setExportProgress(null); },
      (msg) => { setExporting(false); setExportProgress(null); setExportError(msg); }
    );
  }

  function cancelExport() {
    abortExportRef.current?.();
    setExporting(false);
    setExportProgress(null);
  }

  const ITEMS_PER_PAGE = 20;

  const fetchTransactions = useCallback(async (reset: boolean = false) => {
    if (!publicKey) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const currentPage = reset ? 1 : page;
      const limit = ITEMS_PER_PAGE;
      
      // Use enhanced MarketPay transaction fetching
      const response = await fetchMarketPayTransactions(
        publicKey,
        limit,
        reset ? undefined : transactions[transactions.length - 1]?.id
      );

      if (reset) {
        setTransactions(response.transactions);
        setPage(1);
      } else {
        setTransactions(prev => [...prev, ...response.transactions]);
      }

      setHasMore(response.hasMore);
    } catch (err) {
      console.error("Error fetching transactions:", err);
      setError("Failed to load transactions. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [publicKey, page, transactions]);

  useEffect(() => {
    if (publicKey) {
      fetchTransactions(true);
    }
  }, [publicKey, filter, fetchTransactions]);

  const loadMore = () => {
    setPage(prev => prev + 1);
    fetchTransactions(false);
  };

  const getTransactionType = (tx: MarketPayTransaction): string => {
    if (tx.from === publicKey && tx.to !== publicKey) return "sent";
    if (tx.to === publicKey && tx.from !== publicKey) return "received";
    if (tx.marketPayType === "escrow") return "escrow";
    return "other";
  };

  const filteredTransactions = transactions.filter(tx => {
    if (filter === "all") return true;
    return getTransactionType(tx) === filter;
  });

  const getTransactionIcon = (tx: MarketPayTransaction) => {
    const type = getTransactionType(tx);
    switch (type) {
      case "sent":
        return (
          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "received":
        return (
          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "escrow":
        return (
          <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-amber-100 mb-3">Transaction History</h1>
          <p className="text-amber-800">Connect your wallet to view your transaction history</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-amber-100 mb-1">Transaction History</h1>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="address-tag">{shortenAddress(publicKey)}</span>
            <a
              href={accountUrl(publicKey)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-600 hover:text-amber-300 transition-colors"
              title="View account on Stellar Expert"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Export CSV button */}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              {exporting ? (
                <button
                  onClick={cancelExport}
                  className="btn-secondary text-sm py-2.5 px-4 flex items-center gap-2"
                  title="Cancel export"
                >
                  <svg className="w-4 h-4 animate-spin text-market-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                  {exportProgress !== null ? `${exportProgress}%` : "Exporting…"}
                  <span className="text-xs text-amber-700">Cancel</span>
                </button>
              ) : (
                <button
                  onClick={handleExport}
                  disabled={!publicKey || loading}
                  className="btn-secondary text-sm py-2.5 px-4 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Export transactions as CSV"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export CSV
                </button>
              )}
            </div>

            {/* Progress bar — shown while exporting */}
            {exporting && (
              <div className="w-full h-1.5 bg-market-500/10 rounded-full overflow-hidden" style={{ minWidth: 120 }}>
                {exportProgress !== null ? (
                  <div
                    className="h-full bg-market-400 rounded-full transition-all duration-200"
                    style={{ width: `${exportProgress}%` }}
                  />
                ) : (
                  <div className="h-full bg-market-400 rounded-full animate-[progress-indeterminate_1.4s_ease-in-out_infinite] w-1/3" />
                )}
              </div>
            )}

            {exportError && (
              <p className="text-xs text-red-400">{exportError}</p>
            )}
          </div>

          <Link href="/dashboard" className="btn-secondary text-sm py-2.5 px-5 flex-shrink-0">
            Back to Dashboard
          </Link>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex border-b border-market-500/10 mb-6 overflow-x-auto">
          {(["all", "sent", "received", "escrow"] as TransactionFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "px-6 py-3 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap capitalize",
                filter === f
                  ? "border-market-400 text-market-300"
                  : "border-transparent text-amber-700 hover:text-amber-400"
              )}
            >
              {f === "all" ? "All Transactions" : f}
            </button>
          ))}
        </div>
      </div>

      {loading && transactions.length === 0 ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0 w-10 h-10 bg-market-500/10 rounded-full" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-16 bg-market-500/10 rounded-full" />
                    <div className="h-4 w-12 bg-market-500/8 rounded" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-20 bg-market-500/10 rounded" />
                    <div className="h-4 w-24 bg-market-500/8 rounded" />
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 text-right space-y-2">
                <div className="h-5 w-16 bg-market-500/10 rounded ml-auto" />
                <div className="h-4 w-20 bg-market-500/8 rounded ml-auto" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="card text-center py-16">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => fetchTransactions(true)}
            className="btn-primary text-sm"
          >
            Retry
          </button>
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="card text-center py-16">
          <div className="mb-6">
            <svg className="w-16 h-16 mx-auto text-amber-600 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p className="font-display text-xl text-amber-100 mb-2">No transactions found</p>
          <p className="text-amber-800 text-sm">
            {filter === "all" 
              ? "Your transaction history will appear here once you start using MarketPay"
              : `No ${filter} transactions found`
            }
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTransactions.map((tx) => (
            <div key={tx.id} className="card-hover flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0">
                  {getTransactionIcon(tx)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={clsx(
                      "text-xs px-2.5 py-0.5 rounded-full border capitalize",
                      getTransactionType(tx) === "sent" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                      getTransactionType(tx) === "received" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                      getTransactionType(tx) === "escrow" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                      "bg-gray-500/10 text-gray-400 border-gray-500/20"
                    )}>
                      {getTransactionType(tx)}
                    </span>
                    {tx.asset && (
                      <span className="text-xs text-amber-800">{tx.asset}</span>
                    )}
                    {!tx.successful && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/20">
                        Failed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {tx.amount && (
                      <p className="font-mono font-semibold text-market-400">
                        {tx.asset === "XLM" ? formatXLM(tx.amount) : tx.amount}
                      </p>
                    )}
                    {tx.from !== publicKey && tx.from && (
                      <p className="text-xs text-amber-700">
                        From: <span className="font-mono">{shortenAddress(tx.from)}</span>
                      </p>
                    )}
                    {tx.to !== publicKey && tx.to && (
                      <p className="text-xs text-amber-700">
                        To: <span className="font-mono">{shortenAddress(tx.to)}</span>
                      </p>
                    )}
                  </div>
                  {tx.memo && tx.memo_type !== "none" && (
                    <p className="text-xs text-amber-600 mt-1">
                      Memo: {tx.memo}
                    </p>
                  )}
                  <p className="text-xs text-amber-800 mt-1">
                    {timeAgo(tx.created_at)} · Ledger #{tx.ledger}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={explorerUrl(tx.hash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                  title="View transaction on Stellar Expert"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View
                </a>
              </div>
            </div>
          ))}
          
          {hasMore && (
            <div className="text-center pt-4">
              <button
                onClick={loadMore}
                disabled={loading}
                className="btn-secondary text-sm px-6 py-2"
              >
                {loading ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
