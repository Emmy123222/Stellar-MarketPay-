/**
 * pages/referrals.tsx
 *
 * Issue #1559: Referral dashboard showing referral earnings and pipeline.
 *
 * Shows:
 *  - Total referred users, pending credits, paid credits, active bonus rate
 *  - Unique referral link for sharing (copy, social share, QR code)
 *  - Visual pipeline (registered → first job completed → credit paid)
 *  - Filterable, paginated table of referees with status badges
 */
import { useState, useEffect, useCallback, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import WalletConnect from "@/components/WalletConnect";
import { fetchMyReferralStats } from "@/lib/api";
import type { MyReferralStats, PipelineStatus } from "@/utils/types";
import { shortenAddress, copyToClipboard, formatXLM } from "@/utils/format";
import { useToast } from "@/components/Toast";
import clsx from "clsx";

interface ReferralsPageProps {
  publicKey: string | null;
  onConnect: () => void;
}

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "https://stellar-marketpay.com");

function PipelineBadge({ status }: { status: PipelineStatus }) {
  if (status === "credit_paid") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 shadow-[0_0_12px_rgba(16,185,129,0.15)]">
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
        Credit Paid
      </span>
    );
  }

  if (status === "first_job_completed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.15)]">
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
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        First Job Completed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-market-500/10 text-market-300 border border-market-500/20">
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
          d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
        />
      </svg>
      Registered
    </span>
  );
}

export default function ReferralsPage({
  publicKey,
  onConnect,
}: ReferralsPageProps) {
  const router = useRouter();
  const toast = useToast();

  const [stats, setStats] = useState<MyReferralStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Filters & Pagination
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(10);

  const isMountedRef = useRef(true);

  const loadData = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyReferralStats({
        page,
        limit,
        status: filterStatus === "all" ? undefined : filterStatus,
      });
      if (isMountedRef.current) {
        setStats(data);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(
          err?.response?.data?.error ||
            err.message ||
            "Failed to load referral pipeline.",
        );
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [publicKey, page, limit, filterStatus]);

  useEffect(() => {
    isMountedRef.current = true;
    loadData();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadData]);

  const referralLink = publicKey
    ? `${BASE_URL}/?ref=${publicKey}`
    : `${BASE_URL}/?ref=YOUR_ADDRESS`;

  const handleCopyLink = async () => {
    if (!publicKey) return;
    const ok = await copyToClipboard(referralLink);
    if (ok) {
      setCopied(true);
      toast.success("Referral link copied to clipboard!");
      setTimeout(() => setCopied(false), 2500);
    } else {
      toast.error("Failed to copy link.");
    }
  };

  const handleShareTwitter = () => {
    const text = encodeURIComponent(
      "Join Stellar MarketPay — the premier non-custodial decentralized freelance marketplace on Stellar & Soroban! Sign up with my link to get started:",
    );
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(referralLink)}`,
      "_blank",
    );
  };

  const handleShareTelegram = () => {
    const text = encodeURIComponent(
      "Check out Stellar MarketPay! Freelance with smart contract escrow:",
    );
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${text}`,
      "_blank",
    );
  };

  const bonusPercent = ((stats?.bonusBps || 200) / 100).toFixed(0);

  return (
    <>
      <Head>
        <title>Referral Dashboard | Stellar MarketPay</title>
        <meta
          name="description"
          content="Earn rewards by referring freelancers and clients to Stellar MarketPay. Track your referral pipeline and earnings."
        />
      </Head>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {/* Hero Header */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-market-500/10 text-market-400 border border-market-500/20 mb-3">
                <span className="w-2 h-2 rounded-full bg-market-400 animate-pulse" />
                Affiliate & Partner Program
              </div>
              <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-amber-100 tracking-tight">
                Referral Pipeline & Earnings
              </h1>
              <p className="mt-2 text-sm sm:text-base text-amber-700 max-w-2xl">
                Earn{" "}
                <span className="text-market-400 font-semibold">
                  {bonusPercent}%
                </span>{" "}
                of the first released escrow when you invite friends,
                colleagues, or clients to Stellar MarketPay.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="btn-secondary text-sm">
                ← Back to Dashboard
              </Link>
            </div>
          </div>
        </div>

        {!publicKey ? (
          <div className="card text-center py-16 px-6 border-market-500/20 shadow-2xl bg-gradient-to-b from-market-900/20 to-transparent">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-market-500/10 border border-market-500/20 flex items-center justify-center text-market-400">
              <svg
                className="w-8 h-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <h2 className="font-display text-xl font-bold text-amber-100 mb-2">
              Connect Your Wallet
            </h2>
            <p className="text-amber-700 text-sm max-w-md mx-auto mb-6">
              Connect your Stellar wallet to view your personalized referral
              link, pipeline metrics, and claimable XLM bonuses.
            </p>
            <div className="flex justify-center">
              <WalletConnect onConnect={onConnect} />
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Top Metrics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card border-market-500/20 bg-gradient-to-br from-market-500/5 to-transparent relative overflow-hidden">
                <div className="flex items-center justify-between text-amber-700 text-xs font-semibold uppercase tracking-wider mb-2">
                  <span>Total Referred</span>
                  <svg
                    className="w-4 h-4 text-market-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                  </svg>
                </div>
                <div className="font-display text-3xl font-bold text-amber-100">
                  {stats ? stats.totalReferred : "—"}
                </div>
                <div className="mt-1 text-xs text-amber-700">
                  Total referees registered
                </div>
              </div>

              <div className="card border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent">
                <div className="flex items-center justify-between text-amber-700 text-xs font-semibold uppercase tracking-wider mb-2">
                  <span>Pending Credits</span>
                  <svg
                    className="w-4 h-4 text-amber-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div className="font-display text-3xl font-bold text-amber-300">
                  {stats?.pendingCreditsXlm
                    ? formatXLM(stats.pendingCreditsXlm)
                    : "0 XLM"}
                </div>
                <div className="mt-1 text-xs text-amber-700">
                  Pending job completion/release
                </div>
              </div>

              <div className="card border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent">
                <div className="flex items-center justify-between text-emerald-400/80 text-xs font-semibold uppercase tracking-wider mb-2">
                  <span>Paid Credits</span>
                  <svg
                    className="w-4 h-4 text-emerald-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div className="font-display text-3xl font-bold text-emerald-400">
                  {stats?.paidCreditsXlm
                    ? formatXLM(stats.paidCreditsXlm)
                    : "0 XLM"}
                </div>
                <div className="mt-1 text-xs text-amber-700">
                  Disbursed referral earnings
                </div>
              </div>

              <div className="card border-market-500/20 bg-gradient-to-br from-market-500/5 to-transparent">
                <div className="flex items-center justify-between text-amber-700 text-xs font-semibold uppercase tracking-wider mb-2">
                  <span>Bonus Rate</span>
                  <svg
                    className="w-4 h-4 text-market-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                    />
                  </svg>
                </div>
                <div className="font-display text-3xl font-bold text-amber-100">
                  {bonusPercent}%
                </div>
                <div className="mt-1 text-xs text-amber-700">
                  Applied on 1st completed escrow
                </div>
              </div>
            </div>

            {/* Referral Link & Sharing Section */}
            <div className="card border-market-500/25 bg-market-900/30 p-6">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                <div className="space-y-1">
                  <h2 className="font-display text-lg font-bold text-amber-100">
                    Your Unique Referral Link
                  </h2>
                  <p className="text-xs sm:text-sm text-amber-700">
                    Share this link with freelancers and clients. When they sign
                    up and complete their first escrow, you automatically earn
                    2% in XLM!
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleShareTwitter}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-market-500/10 text-market-300 border border-market-500/20 hover:bg-market-500/20 text-xs font-medium transition-colors"
                  >
                    Share on X
                  </button>
                  <button
                    onClick={handleShareTelegram}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-market-500/10 text-market-300 border border-market-500/20 hover:bg-market-500/20 text-xs font-medium transition-colors"
                  >
                    Share on Telegram
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    readOnly
                    value={referralLink}
                    aria-label="Your referral link"
                    className="w-full bg-ink-900/80 border border-market-500/25 rounded-xl px-4 py-3 text-xs sm:text-sm font-mono text-amber-200 select-all focus:outline-none focus:ring-2 focus:ring-market-400"
                  />
                </div>
                <button
                  onClick={handleCopyLink}
                  className="btn-primary text-xs sm:text-sm py-3 px-6 whitespace-nowrap flex items-center justify-center gap-2"
                >
                  {copied ? (
                    <>
                      <svg
                        className="w-4 h-4 text-emerald-400"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                        />
                      </svg>
                      Copy Referral Link
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Pipeline Stage Visual Progression */}
            <div className="card border-market-500/20 bg-ink-900/40 p-6">
              <h2 className="font-display text-base sm:text-lg font-bold text-amber-100 mb-4">
                Referral Conversion Pipeline
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
                {/* Stage 1 */}
                <div className="rounded-xl border border-market-500/15 bg-market-500/5 p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-market-400">
                      Step 1
                    </span>
                    <span className="text-xl font-bold text-amber-100">
                      {stats?.pipeline ? stats.pipeline.registered : 0}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-amber-200">
                      Registered
                    </h3>
                    <p className="text-xs text-amber-700 mt-1">
                      Referees who signed up using your link but haven&apos;t
                      completed their first escrow.
                    </p>
                  </div>
                </div>

                {/* Stage 2 */}
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                      Step 2
                    </span>
                    <span className="text-xl font-bold text-amber-300">
                      {stats?.pipeline ? stats.pipeline.firstJobCompleted : 0}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-amber-200">
                      First Job Completed
                    </h3>
                    <p className="text-xs text-amber-700 mt-1">
                      Referee successfully released their first escrow. Bonus is
                      queued for disbursement.
                    </p>
                  </div>
                </div>

                {/* Stage 3 */}
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                      Step 3
                    </span>
                    <span className="text-xl font-bold text-emerald-400">
                      {stats?.pipeline ? stats.pipeline.creditPaid : 0}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-300">
                      Credit Paid
                    </h3>
                    <p className="text-xs text-amber-700 mt-1">
                      2% referral bonus has been confirmed and paid out to your
                      wallet.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Paginated Referees Table */}
            <div className="card border-market-500/20 p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-amber-100">
                    Referred Users & Pipeline Status
                  </h2>
                  <p className="text-xs text-amber-700">
                    Track individual users, their milestones, and payout status.
                  </p>
                </div>

                {/* Filter Pills */}
                <div className="flex flex-wrap items-center gap-1.5 p-1 bg-ink-900 rounded-xl border border-market-500/20">
                  {[
                    { id: "all", label: "All" },
                    { id: "registered", label: "Registered" },
                    { id: "first_job_completed", label: "1st Job Done" },
                    { id: "credit_paid", label: "Credit Paid" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setFilterStatus(tab.id);
                        setPage(1);
                      }}
                      className={clsx(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                        filterStatus === tab.id
                          ? "bg-market-400 text-ink-950 font-semibold shadow-sm"
                          : "text-amber-700 hover:text-amber-200",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-market-500/15 text-xs text-amber-700 uppercase tracking-wider">
                      <th className="py-3 px-4">Referee</th>
                      <th className="py-3 px-4">Joined Date</th>
                      <th className="py-3 px-4">First Job</th>
                      <th className="py-3 px-4">Est. / Earned XLM</th>
                      <th className="py-3 px-4">Pipeline Status</th>
                      <th className="py-3 px-4">Paid Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-market-500/10">
                    {loading ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-12 text-center text-amber-700"
                        >
                          <div className="inline-flex items-center gap-2">
                            <svg
                              className="animate-spin h-5 w-5 text-market-400"
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
                            Loading referral pipeline data...
                          </div>
                        </td>
                      </tr>
                    ) : !stats?.referees || stats.referees.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-12 text-center text-amber-700"
                        >
                          <p className="text-amber-200 font-medium mb-1">
                            No referees found
                          </p>
                          <p className="text-xs text-amber-700">
                            {filterStatus === "all"
                              ? "Share your referral link above to start onboarding friends and earning rewards."
                              : `No referees currently match the "${filterStatus}" pipeline status.`}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      stats.referees.map((r) => (
                        <tr
                          key={r.id}
                          className="hover:bg-market-500/5 transition-colors"
                        >
                          <td className="py-3 px-4 font-mono text-xs text-amber-100">
                            {r.refereeDisplayName ? (
                              <div>
                                <span className="font-sans font-semibold text-amber-100 block">
                                  {r.refereeDisplayName}
                                </span>
                                <span className="text-[11px] text-amber-700">
                                  {shortenAddress(r.refereeAddress, 4)}
                                </span>
                              </div>
                            ) : (
                              <span>{shortenAddress(r.refereeAddress, 4)}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs text-amber-700">
                            {new Date(r.registeredAt).toLocaleDateString(
                              undefined,
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              },
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs text-amber-200 max-w-[200px] truncate">
                            {r.firstJobId ? (
                              <Link
                                href={`/jobs/${r.firstJobId}`}
                                className="hover:text-market-400 hover:underline"
                              >
                                {r.firstJobTitle || "View Job"}
                              </Link>
                            ) : (
                              <span className="text-amber-800">
                                No escrow yet
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-amber-100">
                            {r.creditXlm
                              ? `${formatXLM(r.creditXlm)} XLM`
                              : "—"}
                          </td>
                          <td className="py-3 px-4">
                            <PipelineBadge status={r.status} />
                          </td>
                          <td className="py-3 px-4 text-xs text-amber-700">
                            {r.paidAt
                              ? new Date(r.paidAt).toLocaleDateString(
                                  undefined,
                                  {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                  },
                                )
                              : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {stats?.pagination && stats.pagination.totalPages > 1 && (
                <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-market-500/15">
                  <div className="text-xs text-amber-700">
                    Showing Page{" "}
                    <span className="font-semibold text-amber-200">
                      {stats.pagination.page}
                    </span>{" "}
                    of{" "}
                    <span className="font-semibold text-amber-200">
                      {stats.pagination.totalPages}
                    </span>{" "}
                    ({stats.pagination.total} total referees)
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={stats.pagination.page <= 1 || loading}
                      className="px-3 py-1.5 rounded-lg border border-market-500/20 text-xs text-amber-200 hover:bg-market-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      ← Previous
                    </button>
                    <span className="text-xs font-mono text-amber-400 px-2">
                      {stats.pagination.page} / {stats.pagination.totalPages}
                    </span>
                    <button
                      onClick={() =>
                        setPage((p) =>
                          Math.min(stats.pagination.totalPages, p + 1),
                        )
                      }
                      disabled={
                        stats.pagination.page >= stats.pagination.totalPages ||
                        loading
                      }
                      className="px-3 py-1.5 rounded-lg border border-market-500/20 text-xs text-amber-200 hover:bg-market-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
