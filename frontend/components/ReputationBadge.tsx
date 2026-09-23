/**
 * components/ReputationBadge.tsx
 *
 * Issue #1561: On-chain reputation score visible to all parties before a job starts.
 *
 * Displays a reputation score (0–100) badge with dynamic tier styling and
 * an informative breakdown tooltip (completed jobs, dispute rate, response time,
 * ratings, and referral quality).
 */
import { useState, useEffect, useRef } from "react";
import { fetchReputation } from "@/lib/api";
import type { ReputationScore, ReputationLabel } from "@/utils/types";
import clsx from "clsx";

interface ReputationBadgeProps {
  userId: string;
  initialScore?: number | null;
  initialLabel?: ReputationLabel | null;
  size?: "sm" | "md" | "lg";
  showTooltip?: boolean;
  className?: string;
}

export function getReputationTier(score: number | null | undefined): {
  label: ReputationLabel;
  colorClass: string;
  borderClass: string;
  glowClass: string;
} {
  if (score == null) {
    return {
      label: "New",
      colorClass: "text-amber-700 bg-ink-800/80",
      borderClass: "border-market-500/15",
      glowClass: "",
    };
  }

  if (score >= 85) {
    return {
      label: "Excellent",
      colorClass: "text-emerald-400 bg-emerald-500/10",
      borderClass: "border-emerald-500/30",
      glowClass: "shadow-[0_0_12px_rgba(16,185,129,0.2)]",
    };
  }

  if (score >= 70) {
    return {
      label: "Trusted",
      colorClass: "text-market-300 bg-market-500/10",
      borderClass: "border-market-500/30",
      glowClass: "shadow-[0_0_12px_rgba(251,191,36,0.2)]",
    };
  }

  if (score >= 50) {
    return {
      label: "Established",
      colorClass: "text-cyan-300 bg-cyan-500/10",
      borderClass: "border-cyan-500/25",
      glowClass: "shadow-[0_0_10px_rgba(6,182,212,0.15)]",
    };
  }

  return {
    label: "Building",
    colorClass: "text-amber-400/90 bg-amber-500/10",
    borderClass: "border-amber-500/20",
    glowClass: "",
  };
}

export default function ReputationBadge({
  userId,
  initialScore,
  initialLabel,
  size = "md",
  showTooltip = true,
  className,
}: ReputationBadgeProps) {
  const [reputation, setReputation] = useState<ReputationScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const popoverTimeout = useRef<NodeJS.Timeout | null>(null);

  // Lazy fetch full breakdown on hover or if no initial score
  const loadReputation = async () => {
    if (reputation || loading || !userId) return;
    setLoading(true);
    try {
      const data = await fetchReputation(userId);
      setReputation(data);
    } catch {
      // Graceful fallback to initialScore
    } finally {
      setLoading(false);
    }
  };

  const handleMouseEnter = () => {
    if (!showTooltip) return;
    popoverTimeout.current = setTimeout(() => {
      setShowPopover(true);
      loadReputation();
    }, 200);
  };

  const handleMouseLeave = () => {
    if (popoverTimeout.current) clearTimeout(popoverTimeout.current);
    setShowPopover(false);
  };

  const score = reputation ? reputation.score : initialScore;
  const tier = getReputationTier(score);
  const label = reputation?.label || initialLabel || tier.label;

  const sizeClasses = {
    sm: "text-[10px] px-2 py-0.5 gap-1",
    md: "text-xs px-2.5 py-1 gap-1.5",
    lg: "text-sm px-3.5 py-1.5 gap-2 font-semibold",
  }[size];

  return (
    <div
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        className={clsx(
          "inline-flex items-center rounded-full font-medium border transition-all cursor-default select-none",
          tier.colorClass,
          tier.borderClass,
          tier.glowClass,
          sizeClasses,
          className,
        )}
      >
        <svg
          className={clsx(
            "flex-shrink-0 fill-current",
            size === "sm"
              ? "w-2.5 h-2.5"
              : size === "md"
                ? "w-3 h-3"
                : "w-4 h-4",
          )}
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>

        <span>{score != null ? Math.round(score) : "—"}</span>
        <span className="opacity-80">·</span>
        <span>{label}</span>
      </span>

      {/* Breakdown Tooltip / Popover */}
      {showTooltip && showPopover && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-4 rounded-xl border border-market-500/25 bg-ink-950/95 backdrop-blur-xl shadow-2xl text-left animate-fade-in pointer-events-none">
          <div className="flex items-center justify-between border-b border-market-500/15 pb-2 mb-3">
            <div>
              <div className="text-xs font-semibold text-amber-200">
                On-Chain Reputation
              </div>
              <div className="text-[10px] text-amber-700">
                Multi-signal credibility index
              </div>
            </div>
            <div className="text-right">
              <span className="font-display font-bold text-base text-market-400">
                {score != null ? Number(score).toFixed(1) : "—"}
              </span>
              <span className="text-[10px] text-amber-700"> / 100</span>
            </div>
          </div>

          {loading ? (
            <div className="py-4 text-center text-xs text-amber-700">
              Loading metrics...
            </div>
          ) : reputation ? (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-amber-700">Completed Jobs:</span>
                <span className="font-semibold text-amber-200">
                  {reputation.completedJobs}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-amber-700">Dispute Rate:</span>
                <span
                  className={clsx(
                    "font-semibold",
                    reputation.disputeRate > 0.05
                      ? "text-amber-400"
                      : "text-emerald-400",
                  )}
                >
                  {(reputation.disputeRate * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-amber-700">Avg. Response Time:</span>
                <span className="font-semibold text-amber-200">
                  {reputation.avgResponseHours != null
                    ? `${reputation.avgResponseHours.toFixed(1)} hrs`
                    : "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-amber-700">Star Rating:</span>
                <span className="font-semibold text-amber-200">
                  {reputation.avgRating != null
                    ? `${reputation.avgRating.toFixed(1)} ★ (${reputation.ratingCount})`
                    : "No ratings"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-amber-700">Referral Quality:</span>
                <span className="font-semibold text-emerald-400">
                  {(reputation.referralQuality * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-amber-700">
              Blends completed jobs, dispute history, response times, star
              ratings, and referral success.
            </div>
          )}

          {/* Micro arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-ink-950" />
        </div>
      )}
    </div>
  );
}
