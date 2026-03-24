/**
* pages/jobs/index.tsx
* Browse all open jobs with category filtering.
*/
import JobCard, { JobCardSkeleton } from "@/components/JobCard";
import { fetchJobs } from "@/lib/api";
import { JOB_CATEGORIES } from "@/utils/format";
import type { Job } from "@/utils/types";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function JobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const category = (router.query.category as string) || "";
  const status = (router.query.status as string) || "open";

  useEffect(() => {
    setLoading(true);
    fetchJobs({ category: category || undefined, status: status || undefined, limit: 50 })
      .then(setJobs)
      .catch(() => setError("Could not load jobs."))
      .finally(() => setLoading(false));
  }, [category, status]);

  const filtered = search.trim()
    ? jobs.filter((j) =>
      j.title.toLowerCase().includes(search.toLowerCase()) ||
      j.description.toLowerCase().includes(search.toLowerCase()) ||
      j.skills.some((s) => s.toLowerCase().includes(search.toLowerCase()))
    )
    : jobs;

  const setFilter = (key: string, val: string) => {
    router.push({ pathname: "/jobs", query: { ...router.query, [key]: val || undefined } }, undefined, { shallow: true });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-amber-100 mb-1">Browse Jobs</h1>
          <p className="text-amber-800 text-sm">{loading ? "Loading..." : `${filtered.length} job${filtered.length !== 1 ? "s" : ""} found`}</p>
        </div>
        <Link href="/post-job" className="btn-primary text-sm py-2.5 px-5 flex-shrink-0">+ Post a Job</Link>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-800" />
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, skill, or keyword..."
          className="input-field pl-10"
        />
      </div>

      <div className="flex gap-6">
        {/* Sidebar filters */}
        <aside className="hidden lg:block w-52 flex-shrink-0 space-y-6">
          {/* Status */}
          <div>
            <p className="label">Status</p>
            <div className="space-y-1">
              {["open", "in_progress", "completed", ""].map((s) => (
                <button key={s}
                  onClick={() => setFilter("status", s)}
                  className={clsx(
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body",
                    status === s ? "bg-market-500/15 text-market-300 font-medium" : "text-amber-700 hover:text-amber-400 hover:bg-market-500/8"
                  )}>
                  {s === "" ? "All" : s === "open" ? "Open" : s === "in_progress" ? "In Progress" : "Completed"}
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div>
            <p className="label">Category</p>
            <div className="space-y-1">
              <button onClick={() => setFilter("category", "")}
                className={clsx("w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body",
                  !category ? "bg-market-500/15 text-market-300 font-medium" : "text-amber-700 hover:text-amber-400 hover:bg-market-500/8")}>
                All Categories
              </button>
              {JOB_CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => setFilter("category", cat)}
                  className={clsx("w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body",
                    category === cat ? "bg-market-500/15 text-market-300 font-medium" : "text-amber-700 hover:text-amber-400 hover:bg-market-500/8")}>
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Job grid */}
        <div className="flex-1">
          {loading ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <JobCardSkeleton key={`job-skeleton-${i}`} />
              ))}
            </div>
          ) : error ? (
            <div className="card text-center py-12">
              <p className="text-red-400 mb-3">{error}</p>
              <button onClick={() => window.location.reload()} className="btn-secondary text-sm">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card text-center py-16">
              <p className="font-display text-xl text-amber-100 mb-2">No jobs found</p>
              <p className="text-amber-800 text-sm mb-6">Try adjusting your filters or search term</p>
              <Link href="/post-job" className="btn-primary text-sm">Post the first job →</Link>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {filtered.map((job) => <JobCard key={job.id} job={job} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}
