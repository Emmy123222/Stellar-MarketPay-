/**
 * components/ReferralDashboard.tsx
 *
 * Referral dashboard tab shown on the user dashboard.
 * Features:
 *  - Unique referral link generator (copy to clipboard)
 *  - Summary stats: total invited, pending, paid, total XLM earned
 *  - Referee list with status badges
 *  - Payout history table
 */
import { useState, useEffect, useCallback } from "react";
import { fetchReferralStats } from "@/lib/api";
import type {
  ReferralStats,
  ReferralReferee,
  ReferralPayout,
} from "@/utils/types";
import { shortenAddress, copyToClipboard } from "@/utils/format";
import clsx from "clsx";

interface ReferralDashboardProps {
  publicKey: string;
}

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || "https://stellar-marketpay.com";

function StatusBadge({ status }: { status: ReferralReferee["status"] }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        status === "paid"
          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          : status === "pending"
            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
            : "bg-ink-700 text-amber-700 border border-market-500/10",
      )}
    >
      {status === "paid" && (
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M5 13l4 4L19 7"
          />
        </svg>
      )}
      {status === "pending" && (
        <svg
          className="w-3 h-3"
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
      )}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function ReferralDashboard({
  publicKey,
}: ReferralDashboardProps) {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"referees" | "payouts">(
    "referees",
  );

  const referralLink = `${BASE_URL}/?ref=${publicKey}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReferralStats(publicKey);
      setStats(data);
    } catch {
      setError("Failed to load referral data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(referralLink);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card animate-pulse h-20" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card text-center py-12">
        <p className="text-red-400 text-sm mb-4">{error}</p>
        <button onClick={load} className="btn-secondary text-sm">
          Retry
        </button>
      </div>
    );
  }

  const bonusPercent = stats ? (stats.bonusBps / 100).toFixed(0) : "2";

  return (
    <div className="space-y-6">
      {/* ── Referral link card ─────────────────────────────────────────── */}
      <div className="card bg-gradient-to-br from-ink-800 to-ink-900 border-market-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-market-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-amber-100 mb-1">
                Refer &amp; Earn
              </h2>
              <p className="text-sm text-amber-700">
                Share your link. Earn{" "}
                <span className="text-market-400 font-semibold">
                  {bonusPercent}%
                </span>{" "}
                of your referee's first job earnings — paid automatically
                on-chain.
              </p>
            </div>
            <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-market-500/10 border border-market-500/20 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-market-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
            </div>
          </div>

          {/* Link input + copy button */}
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-ink-950/60 border border-market-500/20 rounded-xl px-4 py-2.5 font-mono text-xs text-amber-400 truncate select-all">
              {referralLink}
            </div>
            <button
              onClick={handleCopy}
              className={clsx(
                "flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border",
                copied
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "btn-primary border-transparent",
              )}
            >
              {copied ? (
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
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Copied
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
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  Copy Link
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Summary stats ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Total Invited",
            value: stats?.totalReferrals ?? 0,
            color: "text-amber-100",
          },
          {
            label: "Pending",
            value: stats?.pendingReferrals ?? 0,
            color: "text-amber-400",
          },
          {
            label: "Paid Out",
            value: stats?.paidReferrals ?? 0,
            color: "text-emerald-400",
          },
          {
            label: "Total Earned",
            value: `${parseFloat(stats?.totalEarnedXlm ?? "0").toLocaleString("en-US", { maximumFractionDigits: 4 })} XLM`,
            color: "text-market-400",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="card bg-gradient-to-br from-ink-800 to-ink-900 border-market-500/15 text-center py-4"
          >
            <p className={clsx("font-display text-2xl font-bold", stat.color)}>
              {stat.value}
            </p>
            <p className="text-xs text-amber-700 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs: Referees / Payouts ────────────────────────────────────── */}
      {stats && stats.totalReferrals > 0 ? (
        <div className="card">
          <div className="flex border-b border-market-500/10 mb-5 -mx-6 px-6">
            {(["referees", "payouts"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={clsx(
                  "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all capitalize",
                  activeTab === t
                    ? "border-market-400 text-market-300"
                    : "border-transparent text-amber-700 hover:text-amber-400",
                )}
              >
                {t === "referees"
                  ? `Invited Users (${stats.totalReferrals})`
                  : `Payout History (${stats.payouts.length})`}
              </button>
            ))}
          </div>

          {activeTab === "referees" && (
            <div className="space-y-2">
              {stats.referees.map((referee) => (
                <RefereeRow key={referee.id} referee={referee} />
              ))}
            </div>
          )}

          {activeTab === "payouts" &&
            (stats.payouts.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-amber-700 text-sm">No payouts yet.</p>
                <p className="text-amber-800 text-xs mt-1">
                  You'll earn {bonusPercent}% when a referee completes their
                  first job.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-amber-700 border-b border-market-500/10">
                      <th className="pb-2 pr-4 font-medium">Referee</th>
                      <th className="pb-2 pr-4 font-medium">Job</th>
                      <th className="pb-2 pr-4 font-medium text-right">
                        Bonus
                      </th>
                      <th className="pb-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-market-500/8">
                    {stats.payouts.map((payout) => (
                      <PayoutRow key={payout.id} payout={payout} />
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </div>
      ) : (
        /* Empty state */
        <div className="card text-center py-14">
          <div className="w-14 h-14 rounded-2xl bg-market-500/10 border border-market-500/20 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-7 h-7 text-market-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <p className="font-display text-lg text-amber-100 mb-1">
            No referrals yet
          </p>
          <p className="text-sm text-amber-700 max-w-xs mx-auto">
            Share your referral link above. When someone signs up and completes
            their first job, you'll automatically receive {bonusPercent}% of
            their earnings.
          </p>
        </div>
      )}
    </div>
  );
}

function RefereeRow({ referee }: { referee: ReferralReferee }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-ink-900/40 border border-market-500/10">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-market-500/10 border border-market-500/20 flex items-center justify-center flex-shrink-0">
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
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-100 truncate">
            {referee.refereeDisplayName ||
              shortenAddress(referee.refereeAddress)}
          </p>
          <p className="text-xs text-amber-800 font-mono">
            {shortenAddress(referee.refereeAddress)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {referee.status === "paid" && referee.payoutAmount && (
          <span className="text-sm font-mono font-semibold text-emerald-400">
            +
            {parseFloat(referee.payoutAmount).toLocaleString("en-US", {
              maximumFractionDigits: 4,
            })}{" "}
            XLM
          </span>
        )}
        <StatusBadge status={referee.status} />
      </div>
    </div>
  );
}

function PayoutRow({ payout }: { payout: ReferralPayout }) {
  return (
    <tr className="text-sm">
      <td className="py-2.5 pr-4">
        <span className="font-mono text-xs text-amber-700">
          {shortenAddress(payout.refereeAddress)}
        </span>
      </td>
      <td className="py-2.5 pr-4 text-amber-100 truncate max-w-[160px]">
        {payout.jobTitle}
      </td>
      <td className="py-2.5 pr-4 text-right font-mono font-semibold text-emerald-400">
        +
        {parseFloat(payout.amountXlm).toLocaleString("en-US", {
          maximumFractionDigits: 4,
        })}{" "}
        XLM
      </td>
      <td className="py-2.5 text-xs text-amber-700 whitespace-nowrap">
        {new Date(payout.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </td>
    </tr>
  );
}
