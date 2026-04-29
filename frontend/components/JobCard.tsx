/**
 * components/JobCard.tsx
 * Displays a single job listing in the browse grid.
 */
import Link from "next/link";
import { useState, useRef, useEffect } from "react"; // Added for hover logic
import {
  formatDeadline,
  formatXLM,
  getDeadlineState,
  getMonthlyEstimate,
  statusClass,
  statusLabel,
  timeAgo,
  formatUSDEquivalent,
  getMonthlyEstimate,
} from "@/utils/format";
import type { Job } from "@/utils/types";
import { usePriceContext } from "@/contexts/PriceContext";
import { useState, useEffect } from "react";

interface JobCardProps { job: Job; }

function CountdownTimer({ deadline }: { deadline: string }) {
  const [timeLeft, setTimeLeft] = useState<{ hours: number; minutes: number; totalMinutes: number } | null>(null);

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
    if (initial && initial.totalMinutes <= 2880) { // 48 hours
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
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide mb-1 ${colorClass} ${isCritical ? 'animate-pulse' : ''}`}
      aria-live="polite"
      role="timer"
    >
      {isCritical && <span className="mr-1">Closing Soon:</span>}
      Closes in {timeLeft.hours}h {timeLeft.minutes}m
    </div>
  );
}

export default function JobCard({ job }: JobCardProps) {
  const { xlmPriceUsd } = usePriceContext();
  const usdEquivalent = formatUSDEquivalent(job.budget, xlmPriceUsd);

  // ── ISSUE #78: Hover Card State & Logic ──────────────────────────────────────────
  const [showPreview, setShowPreview] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
  const isStatusClosed = job.status === "cancelled" || job.status === "completed";
  const showClosedBadge = isStatusClosed || deadlineState === "closed";
  const showClosingSoonBadge = !showClosedBadge && deadlineState === "closing_soon";

  // Helper to get monthly estimate (keeping original logic intact)
  const getMonthlyEstimate = (budget: string, price: number | null) => {
    return "Estimated monthly: " + formatUSDEquivalent(budget, price);
  };

  return (
    <Link href={`/jobs/${job.id}`}>
      {/* ── ISSUE #78: Added relative positioning and hover handlers ── */}
      <div 
        className="card-hover group animate-fade-in relative cursor-pointer" 
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-display font-semibold text-amber-100 text-base leading-snug group-hover:text-market-300 transition-colors line-clamp-2">
            {job.title}
          </h3>
          <span className={statusClass(job.status) + " flex-shrink-0 text-xs"}>
            {statusLabel(job.status)}
          </span>
        </div>

        {/* Description */}
        <p className="text-amber-800/80 text-sm leading-relaxed line-clamp-3 mb-4">
          {job.description}
        </p>

        {/* Skills */}
        {job.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {job.skills.slice(0, 4).map((s) => (
              <span key={s} className="text-xs bg-market-500/8 text-market-500/80 border border-market-500/15 px-2 py-0.5 rounded-md">
                {s}
              </span>
            ))}
            {job.skills.length > 4 && (
              <span className="text-xs text-amber-800 px-2 py-0.5">+{job.skills.length - 4} more</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-[rgba(251,191,36,0.07)]">
          <div className="group/tooltip relative">
            <p className="text-xs text-amber-800 mb-0.5">Budget</p>
            <p className="font-mono font-semibold text-market-400 text-sm cursor-help">{formatXLM(job.budget)}</p>
            {usdEquivalent && (
              <div className="absolute bottom-full left-0 mb-2 hidden group-hover/tooltip:block z-20">
                <div className="bg-ink-800 border border-market-500/30 text-amber-100 text-[10px] py-1.5 px-2.5 rounded shadow-xl whitespace-nowrap backdrop-blur-md">
                  <p className="font-semibold text-market-300">{usdEquivalent}</p>
                  <p className="text-amber-800/80 mt-0.5">{getMonthlyEstimate(job.budget, xlmPriceUsd)}</p>
                </div>
                <div className="w-2 h-2 bg-ink-800 border-r border-b border-market-500/30 rotate-45 -mt-1 ml-3" />
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-amber-800 mb-0.5">
              {job.applicantCount} applicant{job.applicantCount !== 1 ? "s" : ""}
              {hasValidDeadline ? ` | Due ${formattedDeadline}` : ""}
            </p>
            {showClosedBadge && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide bg-slate-500/20 text-slate-300 border-slate-400/30 mb-0.5">
                Closed
              </span>
            )}
            {!showClosedBadge && job.deadline && <CountdownTimer deadline={job.deadline} />}
            {showClosingSoonBadge && !showClosedBadge && !job.deadline && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide bg-red-500/20 text-red-300 border-red-400/40 mb-0.5">
                Closing soon
              </span>
            )}
            <p className="text-xs text-amber-800/60">{timeAgo(job.createdAt)}</p>
          </div>
        </div>

        {/* Category pill */}
        <div className="mt-3">
          <span className="text-xs text-amber-700 bg-ink-700 px-2.5 py-1 rounded-full border border-[rgba(251,191,36,0.08)]">
            {job.category}
          </span>
        </div>

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
                <p className="text-[10px] font-mono text-amber-100/70 truncate">{job.clientAddress || "Not specified"}</p>
              </div>
            </div>
          </div>
        )}
        {/* ───────────────────────────────────────────── */}
      </div>
    </Link>
  );
}

// ... JobCardSkeleton remains exactly as you shared it below ...
export function JobCardSkeleton() {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="h-5 w-3/5 rounded bg-market-500/8 animate-pulse" />
        <div className="h-5 w-16 rounded-full bg-market-500/12 animate-pulse flex-shrink-0" />
      </div>

      <div className="space-y-2 mb-4">
        <div className="h-3 w-full rounded bg-market-500/8 animate-pulse" />
        <div className="h-3 w-11/12 rounded bg-market-500/8 animate-pulse" />
        <div className="h-3 w-4/5 rounded bg-market-500/8 animate-pulse" />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <div className="h-5 w-16 rounded-md bg-market-500/10 border border-market-500/15 animate-pulse" />
        <div className="h-5 w-20 rounded-md bg-market-500/10 border border-market-500/15 animate-pulse" />
        <div className="h-5 w-14 rounded-md bg-market-500/10 border border-market-500/15 animate-pulse" />
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-[rgba(251,191,36,0.07)]">
        <div className="space-y-1">
          <div className="h-3 w-10 rounded bg-market-500/8 animate-pulse" />
          <div className="h-4 w-20 rounded bg-market-500/12 animate-pulse" />
        </div>
        <div className="space-y-1.5 flex flex-col items-end">
          <div className="h-3 w-24 rounded bg-market-500/8 animate-pulse" />
          <div className="h-3 w-16 rounded bg-market-500/8 animate-pulse" />
        </div>
      </div>

      <div className="mt-3">
        <div className="h-6 w-24 rounded-full bg-market-500/8 border border-[rgba(251,191,36,0.08)] animate-pulse" />
      </div>
    </div>
  );
}