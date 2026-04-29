/**
 * pages/dashboard/transactions.tsx
 * Transaction history page with Stellar explorer deep links
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import WalletConnect from "@/components/WalletConnect";
import { server, explorerUrl, accountUrl, fetchMarketPayTransactions, type MarketPayTransaction } from "@/lib/stellar";
import { formatXLM, shortenAddress, timeAgo } from "@/utils/format";
import clsx from "clsx";

// Using MarketPayTransaction from stellar.ts

type TransactionFilter = "all" | "sent" | "received" | "escrow";

interface DashboardProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

export default function TransactionHistory({ publicKey, onConnect }: DashboardProps) {
  const router = useRouter();
  const [transactions, setTransactions] = useState<MarketPayTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TransactionFilter>("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ITEMS_PER_PAGE = 20;

  const fetchTransactions = async (reset: boolean = false) => {
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
  };

  useEffect(() => {
    if (publicKey) {
      fetchTransactions(true);
    }
  }, [publicKey, filter]);

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
        <Link href="/dashboard" className="btn-secondary text-sm py-2.5 px-5 flex-shrink-0">
          Back to Dashboard
        </Link>
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
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card animate-pulse h-20" />
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
