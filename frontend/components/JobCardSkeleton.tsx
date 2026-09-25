/**
 * components/JobCardSkeleton.tsx
 *
 * Skeleton placeholder for JobCard while job data is loading.
 * Animated with Tailwind's animate-pulse to improve perceived performance.
 * Mirrors the layout of the real JobCard to avoid layout shift.
 */
export default function JobCardSkeleton() {
  return (
    <div className="card animate-pulse" aria-busy="true" aria-label="Loading job card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="h-5 w-3/5 rounded bg-market-500/8" />
        <div className="h-5 w-16 rounded-full bg-market-500/12 flex-shrink-0" />
      </div>

      <div className="space-y-2 mb-4">
        <div className="h-3 w-full rounded bg-market-500/8" />
        <div className="h-3 w-11/12 rounded bg-market-500/8" />
        <div className="h-3 w-4/5 rounded bg-market-500/8" />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <div className="h-5 w-16 rounded-md bg-market-500/10 border border-market-500/15" />
        <div className="h-5 w-20 rounded-md bg-market-500/10 border border-market-500/15" />
        <div className="h-5 w-14 rounded-md bg-market-500/10 border border-market-500/15" />
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-[rgba(251,191,36,0.07)]">
        <div className="space-y-1">
          <div className="h-3 w-10 rounded bg-market-500/8" />
          <div className="h-4 w-20 rounded bg-market-500/12" />
        </div>
        <div className="space-y-1.5 flex flex-col items-end">
          <div className="h-3 w-24 rounded bg-market-500/8" />
          <div className="h-3 w-16 rounded bg-market-500/8" />
        </div>
      </div>

      <div className="mt-3">
        <div className="h-6 w-24 rounded-full bg-market-500/8 border border-[rgba(251,191,36,0.08)]" />
      </div>
    </div>
  );
}
