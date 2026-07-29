import clsx from "clsx";
import type { FreelancerTier } from "@/utils/types";

const tierClassNames: Record<FreelancerTier, string> = {
  Newcomer: "border-slate-400/20 bg-slate-400/10 text-slate-200",
  "Rising Talent": "border-sky-400/25 bg-sky-400/10 text-sky-300",
  "Top Rated": "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  Expert: "border-amber-400/30 bg-amber-400/10 text-amber-200",
};

interface FreelancerTierBadgeProps {
  tier?: FreelancerTier;
  className?: string;
}

export default function FreelancerTierBadge({
  tier = "Newcomer",
  className,
}: FreelancerTierBadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-wide",
        tierClassNames[tier],
        className
      )}
    >
      {tier}
    </span>
  );
}
