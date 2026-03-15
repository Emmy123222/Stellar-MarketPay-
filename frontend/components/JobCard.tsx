/**
 * components/JobCard.tsx
 * Displays a single job listing in the browse grid.
 */
import Link from "next/link";
import type { Job } from "@/utils/types";
import { formatXLM, timeAgo, statusLabel, statusClass, shortenAddress } from "@/utils/format";

interface JobCardProps { job: Job; }

export default function JobCard({ job }: JobCardProps) {
  return (
    <Link href={`/jobs/${job.id}`}>
      <div className="card-hover group animate-fade-in">
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
          <div>
            <p className="text-xs text-amber-800 mb-0.5">Budget</p>
            <p className="font-mono font-semibold text-market-400 text-sm">{formatXLM(job.budget)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-amber-800 mb-0.5">{job.applicantCount} applicant{job.applicantCount !== 1 ? "s" : ""}</p>
            <p className="text-xs text-amber-800/60">{timeAgo(job.createdAt)}</p>
          </div>
        </div>

        {/* Category pill */}
        <div className="mt-3">
          <span className="text-xs text-amber-700 bg-ink-700 px-2.5 py-1 rounded-full border border-[rgba(251,191,36,0.08)]">
            {job.category}
          </span>
        </div>
      </div>
    </Link>
  );
}
