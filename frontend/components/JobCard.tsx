/**
 * components/JobCard.tsx
 * Displays a single job listing in the browse grid.
 */
import { useState, useEffect, useRef } from "react";
import Link from "next/link";

export function useSNS(address: string | undefined) {
    const [name, setName] = useState<string | null>(null);
    useEffect(() => {
        if (!address) return;
        const cached = sessionStorage.getItem(`sns_${address}`);
        if (cached) { setName(cached); return; }
        // mock stellar federation fetch
        setTimeout(() => {
            const snsName = address.startsWith("G") ? `user*stellar.org` : null;
            if (snsName) {
                sessionStorage.setItem(`sns_${address}`, snsName);
                setName(snsName);
            }
        }, 500);
    }, [address]);
    return name;
}
import {
  formatDeadline,
  formatMoney,
  getDeadlineState,
  statusClass,
  statusLabel,
  timeAgo,
  formatUSDEquivalent,
  formatPrice,
} from "@/utils/format";
import type { Job } from "@/utils/types";
import { usePriceContext } from "@/contexts/PriceContext";
import { useBookmarks } from "@/hooks/useBookmarks";
import JobStatusTimeline from "@/components/JobStatusTimeline";
import SanitizedHtml from "@/components/SanitizedHtml";

interface JobCardProps {
  job: Job;
  isFocused?: boolean;
  onFocus?: () => void;
}

function getClientReputationBadge(score?: number | null) {
  if (score == null) return null;
  if (score >= 4.5) {
    return {
      label: `Trusted client ${score.toFixed(1)}`,
      className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
      hint: "High on-time payment and completion history",
    };
  }
  if (score < 3.0) {
    return {
      label: `Caution ${score.toFixed(1)}`,
      className: "bg-amber-500/10 text-amber-300 border-amber-500/30",
      hint: "Lower reliability based on dispute/payment history",
    };
  }
  return {
    label: `Client ${score.toFixed(1)}`,
    className: "bg-market-500/10 text-market-300 border-market-500/30",
    hint: "Score blends payment release, disputes, completion, and response time",
  };
}

function CountdownTimer({ deadline }: { deadline: string }) {
  const [timeLeft, setTimeLeft] = useState<{
    hours: number;
    minutes: number;
    totalMinutes: number;
  } | null>(null);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      const end = new Date(deadline);
      const diffMs = end.getTime() - now.getTime();

      if (diffMs <= 0) return null;

      const totalMinutes = Math.floor(diffMs / (1000 * 60));
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      return { hours, minutes, totalMinutes };
    };

    const initial = calculateTimeLeft();
    if (initial && initial.totalMinutes <= 2880) {
      // 48 hours
      setTimeLeft(initial);
      const timer = setInterval(() => {
        const updated = calculateTimeLeft();
        if (!updated || updated.totalMinutes > 2880) {
          setTimeLeft(null);
          clearInterval(timer);
        } else {
          setTimeLeft(updated);
        }
      }, 60000); // Update every minute
      return () => clearInterval(timer);
    }
  }, [deadline]);

  if (!timeLeft) return null;

  const isCritical = timeLeft.totalMinutes < 1440; // 24 hours
  const colorClass = isCritical
    ? "bg-red-500/20 text-red-300 border-red-400/40"
    : "bg-orange-500/20 text-orange-300 border-orange-400/40";

  return (
    <div
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide mb-1 ${colorClass} ${isCritical ? "animate-pulse" : ""}`}
      aria-live="polite"
      role="timer"
    >
      {isCritical && <span className="mr-1">Closing Soon:</span>}
      Closes in {timeLeft.hours}h {timeLeft.minutes}m
    </div>
  );
}

export default function JobCard({ job, isFocused = false, onFocus }: JobCardProps) {
  const { xlmPriceUsd, currencyMode, priceLoading } = usePriceContext();
  const { isSaved, toggleBookmark } = useBookmarks();
  const saved = isSaved(job.id);
  const usdEquivalent = formatUSDEquivalent(job.budget, xlmPriceUsd, job.currency);
  const price = formatPrice(job.budget, xlmPriceUsd, currencyMode, job.currency);
  const clientRepBadge = getClientReputationBadge(job.clientReputationScore);

  // ── ISSUE #78: Hover Card State & Logic ──────────────────────────────────────────
  const [showPreview, setShowPreview] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clientSns = useSNS(job.clientAddress);
  const handleMouseEnter = () => {
    // Check if device has a mouse/pointer (Acceptance Criteria: No popover on touch)
    if (window.matchMedia("(pointer: fine)").matches) {
      hoverTimeoutRef.current = setTimeout(() => {
        setShowPreview(true);
      }, 500); // 500ms delay requirement
    }
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setShowPreview(false);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);
  // ──────────────────────────────────────────────────────────────────────────────────

  const hasValidDeadline = Boolean(job.deadline && formatDeadline(job.deadline));
  const formattedDeadline = job.deadline ? formatDeadline(job.deadline) : "";
  const deadlineState = getDeadlineState(job.deadline);
  const isStatusClosed =
    job.status === "cancelled" || job.status === "completed";
  const showClosedBadge = isStatusClosed || deadlineState === "closed";
  const showClosingSoonBadge = !showClosedBadge && deadlineState === "closing_soon";

  // Helper to get monthly estimate (keeping original logic intact)
  const getMonthlyEstimate = (budget: string, price: number | null, cur: string) => {
    const est = formatUSDEquivalent(budget, price, cur);
    return est ? `Estimated monthly: ${est}` : null;
  };

  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const handleDownloadInvoice = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (downloadingInvoice) return;
    setDownloadingInvoice(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/invoice`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `invoice-${job.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        console.error("Failed to download invoice");
      }
    } catch (err) {
      console.error("Error downloading invoice:", err);
    } finally {
      setDownloadingInvoice(false);
    }
  };

  return (
      <div
        className={[
          "card-hover group animate-fade-in relative cursor-pointer outline-none",
          isFocused ? "ring-2 ring-market-400/50" : "",
          job.isInvited ? "ring-2 ring-market-400/30 bg-market-500/5" : "",
        ].join(" ")}
        tabIndex={-1}
        data-job-card-focus={isFocused ? "true" : undefined}
        onFocus={onFocus}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            {job.isInvited && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-market-500/20 text-market-300 text-[10px] font-semibold border border-market-500/30">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Invited
              </span>
            )}
            <Link href={`/jobs/${job.id}`}>
              <h3 className="font-display font-semibold text-amber-100 text-base leading-snug group-hover:text-market-300 transition-colors line-clamp-2">
                {job.searchHeadline ? (
                  <SanitizedHtml html={job.searchHeadline} />
                ) : (
                  job.title
                )}
              </h3>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {clientRepBadge && (
              <span
                className={`group/rep relative inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${clientRepBadge.className}`}
              >
                ★ {clientRepBadge.label}
                <span className="pointer-events-none absolute bottom-full right-0 mb-1 hidden whitespace-nowrap rounded-md border border-market-500/20 bg-ink-900 px-2 py-1 text-[10px] text-amber-200 shadow-lg group-hover/rep:block">
                  {clientRepBadge.hint}
                </span>
              </span>
            )}
            <span className={statusClass(job.status) + " flex-shrink-0 text-xs"}>
              {statusLabel(job.status)}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-amber-800/80 text-sm leading-relaxed line-clamp-3 mb-4">
          {job.descriptionHeadline ? (
            <SanitizedHtml html={job.descriptionHeadline} />
          ) : (
            job.description
          )}
        </p>

        {/* Skills */}
        {job.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {job.skills.slice(0, 4).map((s) => (
              <span
                key={s}
                className="text-xs bg-market-500/8 text-market-500/80 border border-market-500/15 px-2 py-0.5 rounded-md"
              >
                {s}
              </span>
            ))}
            {job.skills.length > 4 && (
              <span className="text-xs text-amber-800 px-2 py-0.5">
                +{job.skills.length - 4} more
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-[rgba(251,191,36,0.07)] relative">
          <div>
            <p className="text-xs text-amber-800 mb-0.5">Budget</p>
            <p className="font-mono font-semibold text-market-400 text-sm">
              {price.display}
            </p>
            {currencyMode === "XLM" && price.usdEquiv && (
              <p className="text-[10px] text-amber-700 mt-0.5">
                ≈ {price.usdEquiv} USD
              </p>
            )}
            {priceLoading && (
              <span className="inline-block ml-1 w-3 h-3 border border-market-400/40 border-t-transparent rounded-full animate-spin align-middle" />
            )}
          </div>
          <div className="text-right flex items-center gap-2">
            {job.status === "completed" && (
              <button
                type="button"
                onClick={handleDownloadInvoice}
                disabled={downloadingInvoice}
                className="p-1.5 rounded-md transition-all flex items-center justify-center hover:bg-market-500/10 text-market-400 min-h-[44px] min-w-[44px] group/invoice"
                title="Download Invoice"
                aria-label="Download Invoice"
              >
                {downloadingInvoice ? (
                  <span className="w-4 h-4 border-2 border-market-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-4 h-4 transition-transform group-hover/invoice:scale-110"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                )}
              </button>
            )}
            {/* Bookmark Button */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleBookmark(job.id);
              }}
              className="p-2 sm:p-1.5 rounded-md transition-all flex items-center justify-center hover:bg-amber-500/10 group/bookmark min-h-[44px] min-w-[44px]"
              title={saved ? "Remove bookmark" : "Save job"}
              aria-label={saved ? "Remove bookmark" : "Save job"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill={isSaved(job.id) ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-colors group-hover/bookmark:text-amber-400 ${isSaved(job.id) ? 'text-amber-400' : 'text-amber-700/60 group-hover/bookmark:text-amber-400'}`}
              >
                <path d="m14 20 4-6H4l4 6z"/>
                <path d="M18 8a4 4 0 1 0-8 0 4 4 0 0 0 8 0z"/>
              </svg>
            </button>
            <div className="text-right">
              <p className="text-xs text-amber-800 mb-0.5">
                {job.applicantCount} applicant
                {job.applicantCount !== 1 ? "s" : ""}
                {hasValidDeadline ? ` | Due ${formattedDeadline}` : ""}
              </p>
            </div>
            {showClosedBadge && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide bg-slate-500/20 text-slate-300 border-slate-400/30 mb-0.5">
                Closed
              </span>
            )}
            {!showClosedBadge && job.deadline && (
              <CountdownTimer deadline={job.deadline} />
            )}
            {showClosingSoonBadge && !showClosedBadge && !job.deadline && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide bg-red-500/20 text-red-300 border-red-400/40 mb-0.5">
                Closing soon
              </span>
            )}
            <p className="text-xs text-amber-800/60">
              {timeAgo(job.createdAt)}
            </p>
          </div>
        </div>

        {/* Category pill */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-amber-700 bg-ink-700 px-2.5 py-1 rounded-full border border-[rgba(251,191,36,0.08)]">
            {job.category}
          </span>
          {job.boosted && job.boostedUntil && new Date(job.boostedUntil) > new Date() && (
            <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 font-medium">
              ⚡ Featured · until {new Date(job.boostedUntil).toLocaleDateString()}
            </span>
          )}
        </div>

        <JobStatusTimeline job={job} compact />

        {/* ── ISSUE #78: Floating Hover Preview Card ── */}
        {showPreview && (
          <div className="absolute z-50 left-0 top-full mt-2 w-full md:left-full md:top-0 md:mt-0 md:ml-4 md:w-80 animate-in fade-in zoom-in duration-200">
            <div className="bg-ink-900 border border-market-500/40 p-4 rounded-xl shadow-2xl backdrop-blur-lg">
              <h4 className="text-market-300 font-semibold text-sm mb-2">Job Preview</h4>
              <p className="text-amber-100/90 text-xs leading-relaxed mb-3">
                {job.description.substring(0, 300)}
                {job.description.length > 300 ? "..." : ""}
              </p>
              
              <div className="mb-3">
                <p className="text-[10px] text-amber-800 uppercase font-bold mb-1">Required Skills</p>
                <div className="flex flex-wrap gap-1">
                  {job.skills.map((s) => (
                    <span key={s} className="text-[10px] bg-market-500/10 text-market-400 border border-market-500/20 px-1.5 py-0.5 rounded">
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-market-500/20">
                <p className="text-[10px] text-amber-800 mb-0.5 font-bold uppercase">Client Address</p>
                <p className="text-[10px] font-mono text-amber-100/70 truncate">{clientSns || job.clientAddress || "Not specified"}</p>
              </div>
            </div>
          </div>
        )}
        {/* ───────────────────────────────────────────── */}
      </div>
  );
}

// Export the standalone JobCardSkeleton from its own file for better discoverability
// (see frontend/components/JobCardSkeleton.tsx)
export { default as JobCardSkeleton } from "./JobCardSkeleton";
