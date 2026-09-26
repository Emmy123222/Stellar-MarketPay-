/**
 * components/FreelancerCard.tsx
 * Displays a single freelancer profile preview for browse listings.
 */
import Link from "next/link";
import FreelancerTierBadge from "@/components/FreelancerTierBadge";
import ReputationBadge from "@/components/ReputationBadge";
import { usePriceContext } from "@/contexts/PriceContext";
import {
  availabilityBadgeClass,
  availabilityStatusLabel,
  formatXLM,
  shortenAddress,
} from "@/utils/format";
import type { UserProfile } from "@/utils/types";

interface FreelancerCardProps {
  profile: UserProfile;
}

export default function FreelancerCard({ profile }: FreelancerCardProps) {
  const availabilityStatus = profile.availability?.status;
  // Shared XLM price from context — one fetch per minute app-wide, zero
  // requests per card even with dozens of cards on a listing page.
  const { xlmPriceUsd, change24hPercent } = usePriceContext();

  return (
    <Link href={`/freelancers/${encodeURIComponent(profile.publicKey)}`}>
      <div className="card-hover group flex h-full flex-col justify-between gap-4 p-5 transition-shadow hover:shadow-xl">
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h3 className="font-display font-semibold text-amber-100 text-base leading-snug line-clamp-2">
                {profile.displayName || shortenAddress(profile.publicKey)}
              </h3>
              <div className="text-amber-700 text-sm">
                <span className="inline-flex">
                  {shortenAddress(profile.publicKey, 4)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <ReputationBadge userId={profile.publicKey} size="sm" />
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${availabilityBadgeClass(availabilityStatus)}`}
              >
                {availabilityStatusLabel(availabilityStatus)}
              </span>
              {profile.tier ? (
                <FreelancerTierBadge
                  tier={profile.tier}
                  className="hidden sm:inline-flex"
                />
              ) : null}
              {xlmPriceUsd !== null ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-market-500/25 bg-market-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-market-300"
                  title="Current XLM/USD price (shared, refreshes every minute)"
                >
                  <span aria-hidden="true">✦</span>
                  <span>XLM ${xlmPriceUsd.toFixed(4)}</span>
                  {change24hPercent !== null ? (
                    <span
                      className={
                        change24hPercent >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      {change24hPercent >= 0 ? "▲" : "▼"}
                      {Math.abs(change24hPercent).toFixed(2)}%
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
          </div>

          {profile.bio ? (
            <p className="text-amber-800 text-sm leading-relaxed line-clamp-3">
              {profile.bio}
            </p>
          ) : null}

          {profile.skills && profile.skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {profile.skills.slice(0, 6).map((skill) => (
                <span
                  key={skill}
                  className="text-xs bg-market-500/8 text-market-500/80 border border-market-500/15 px-2 py-0.5 rounded-md"
                >
                  {skill}
                </span>
              ))}
              {profile.skills.length > 6 ? (
                <span className="text-xs text-amber-800 px-2 py-0.5">
                  +{profile.skills.length - 6} more
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid gap-2 text-sm text-amber-800 sm:grid-cols-3">
          <div className="rounded-2xl border border-[rgba(251,191,36,0.15)] bg-market-500/5 p-3">
            <p className="text-xs uppercase tracking-[0.15em] text-amber-700">
              Jobs
            </p>
            <p className="font-semibold text-amber-100">
              {profile.completedJobs ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-[rgba(251,191,36,0.15)] bg-market-500/5 p-3">
            <p className="text-xs uppercase tracking-[0.15em] text-amber-700">
              Earnings
            </p>
            <p className="font-semibold text-amber-100">
              {formatXLM(profile.totalEarnedXLM || "0")}
            </p>
          </div>
          {profile.rating !== undefined && profile.rating !== null ? (
            <div className="rounded-2xl border border-[rgba(251,191,36,0.15)] bg-market-500/5 p-3">
              <p className="text-xs uppercase tracking-[0.15em] text-amber-700">
                Rating
              </p>
              <p className="font-semibold text-amber-100">
                {profile.rating.toFixed(1)}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
