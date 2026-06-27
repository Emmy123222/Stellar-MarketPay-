/**
 * components/insights/CompetitiveJobs.tsx
 * List of low competition jobs
 */
import type { InsightCompetitiveJob } from "@/lib/api";

interface Props {
  competitiveJobs: InsightCompetitiveJob[];
}

function formatBudget(value: number) {
  return `${value.toFixed(2)} XLM`;
}

export default function CompetitiveJobs({ competitiveJobs }: Props) {
  return (
    <section className="card">
      <h2 className="section-title">Low competition jobs</h2>
      <p className="mt-2 text-sm text-amber-800">
        Open jobs with fewer than five applications.
      </p>

      <div className="mt-5 space-y-3">
        {competitiveJobs.map((job) => (
          <article
            key={job.id}
            className="rounded-2xl border border-[rgba(251,191,36,0.08)] bg-ink-800/80 p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-amber-100">{job.title}</p>
                <p className="mt-1 text-xs text-amber-800">{job.category}</p>
              </div>
              <span className="rounded-full border border-market-500/20 bg-market-500/10 px-2.5 py-1 text-xs font-semibold text-market-300">
                {job.competitionLevel}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-amber-800">
              <div>
                <p className="uppercase tracking-[0.2em]">Budget</p>
                <p className="mt-1 text-amber-100">{formatBudget(job.budget)}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.2em]">Applications</p>
                <p className="mt-1 text-amber-100">{job.applicationCount}</p>
              </div>
              <div>
                <p className="uppercase tracking-[0.2em]">Client</p>
                <p className="mt-1 truncate text-amber-100">{job.clientAddress.slice(0, 8)}…</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
