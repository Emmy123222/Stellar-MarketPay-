import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchJob } from "@/lib/api";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { formatXLM, CATEGORY_ICONS } from "@/utils/format";
import type { Job } from "@/utils/types";

function RecentlyViewedCard({
  job,
  onRemove,
}: {
  job: Job;
  onRemove: () => void;
}) {
  const isClosed =
    job.status === "completed" ||
    job.status === "cancelled" ||
    job.status === "disputed";

  const content = (
    <div className="card group hover:border-market-500/25 transition-all h-full flex flex-col w-[260px] sm:w-[280px] flex-shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl" aria-hidden="true">
          {CATEGORY_ICONS[job.category] ?? "💼"}
        </span>
        <span className="text-xs text-amber-800 font-body truncate">
          {job.category}
        </span>
        {isClosed ? (
          <span className="ml-auto flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-500/10 border border-slate-500/20 px-2 py-0.5 rounded-full">
            Closed
          </span>
        ) : job.status === "in_progress" ? (
          <span className="ml-auto flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
            In Progress
          </span>
        ) : null}
      </div>
      <h3 className="font-display font-semibold text-amber-200 text-sm leading-snug group-hover:text-market-300 transition-colors line-clamp-2 mb-3 flex-1">
        {job.title}
      </h3>
      <div className="pt-2 border-t border-[rgba(251,191,36,0.07)]">
        <p className="text-xs text-amber-800 mb-0.5">Budget</p>
        <p className="font-mono font-semibold text-market-400 text-sm">
          {formatXLM(job.budget)}
        </p>
      </div>
    </div>
  );

  if (isClosed) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          onRemove();
        }}
        className="text-left"
      >
        {content}
      </button>
    );
  }

  return <Link href={`/jobs/${job.id}`}>{content}</Link>;
}

export default function RecentlyViewedJobs() {
  const { recentIds, removeRecentJob } = useRecentlyViewed();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (recentIds.length === 0) {
      setJobs([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const doFetch = async () => {
      const results = await Promise.allSettled(
        recentIds.map((id) => fetchJob(id)),
      );

      if (cancelled) return;

      const valid: Job[] = [];
      const deletedIds: string[] = [];

      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          valid.push(r.value);
        } else {
          deletedIds.push(recentIds[i]);
        }
      });

      if (deletedIds.length > 0) {
        deletedIds.forEach((id) => removeRecentJob(id));
      }

      setJobs(valid);
      setLoading(false);
    };

    doFetch();

    return () => {
      cancelled = true;
    };
  }, [recentIds, removeRecentJob]);

  if (loading) {
    return (
      <div className="mb-20">
        <h2 className="font-display text-3xl font-bold text-amber-100 mb-6">
          Recently Viewed
        </h2>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="card w-[260px] sm:w-[280px] flex-shrink-0 animate-pulse"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="h-6 w-6 rounded bg-market-500/8" />
                <div className="h-3 w-20 rounded bg-market-500/8" />
              </div>
              <div className="h-4 w-full rounded bg-market-500/8 mb-2" />
              <div className="h-4 w-3/4 rounded bg-market-500/8 mb-3" />
              <div className="pt-2 border-t border-[rgba(251,191,36,0.07)]">
                <div className="h-3 w-10 rounded bg-market-500/8 mb-0.5" />
                <div className="h-4 w-16 rounded bg-market-500/8" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (jobs.length === 0) return null;

  return (
    <div className="mb-20">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display text-3xl font-bold text-amber-100 mb-1">
            Recently Viewed
          </h2>
          <p className="text-amber-800 text-sm font-body">
            Pick up where you left off.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            jobs.forEach((j) => removeRecentJob(j.id));
          }}
          className="text-sm text-amber-800 hover:text-market-400 transition-colors font-body whitespace-nowrap"
        >
          Clear history
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-2 scroll-smooth snap-x snap-mandatory"
      >
        {jobs.map((job) => (
          <div key={job.id} className="snap-start">
            <RecentlyViewedCard
              job={job}
              onRemove={() => removeRecentJob(job.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
