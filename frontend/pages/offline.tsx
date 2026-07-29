/**
 * pages/offline.tsx
 * Offline fallback page (Issue #292).
 *
 * Served by the service worker when a navigation request fails and no cached
 * version of the requested page is available.  Reads last-viewed jobs from
 * localStorage so users can still browse previously seen listings.
 */
import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Job } from "@/utils/types";
import { formatXLM, timeAgo } from "@/utils/format";
import { getLastViewedJobs } from "@/lib/offlineJobs";

// ── Component ─────────────────────────────────────────────────────────────────

export default function OfflinePage() {
  const [lastViewed, setLastViewed] = useState<Job[]>([]);
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    setLastViewed(getLastViewedJobs());
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Auto-redirect to /jobs once connectivity is restored
  useEffect(() => {
    if (isOnline) {
      const timer = setTimeout(() => {
        window.location.href = "/jobs";
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline]);

  return (
    <>
      <Head>
        <title>You are offline — Stellar MarketPay</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 animate-fade-in">
        {/* ── Status banner ── */}
        {isOnline ? (
          <div
            role="status"
            aria-live="polite"
            className="mb-8 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <p className="text-sm font-medium text-emerald-300">
              You&apos;re back online — redirecting to jobs&hellip;
            </p>
          </div>
        ) : (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-8 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-5 py-4"
          >
            <OfflineIcon className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-yellow-300">
                You are offline — your last-viewed jobs are shown below
              </p>
              <p className="mt-1 text-xs text-yellow-600">
                New data will sync automatically when your connection is
                restored.
              </p>
            </div>
          </div>
        )}

        {/* ── Last-viewed jobs ── */}
        {lastViewed.length > 0 ? (
          <section aria-labelledby="cached-jobs-heading">
            <h2
              id="cached-jobs-heading"
              className="font-display text-xl font-bold text-amber-100 mb-5"
            >
              Recently viewed jobs
            </h2>

            <ul className="space-y-3" role="list">
              {lastViewed.map((job) => (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="block card-hover group animate-fade-in"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="font-display font-semibold text-amber-100 text-sm leading-snug group-hover:text-market-300 transition-colors line-clamp-2">
                        {job.title}
                      </h3>
                      <span className="flex-shrink-0 text-xs bg-ink-700 text-amber-700 border border-amber-900/30 px-2 py-0.5 rounded-full">
                        {job.category}
                      </span>
                    </div>

                    <p className="text-amber-800/80 text-xs leading-relaxed line-clamp-2 mb-3">
                      {job.description}
                    </p>

                    {job.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {job.skills.slice(0, 4).map((s) => (
                          <span
                            key={s}
                            className="text-[10px] bg-market-500/8 text-market-500/80 border border-market-500/15 px-2 py-0.5 rounded-md"
                          >
                            {s}
                          </span>
                        ))}
                        {job.skills.length > 4 && (
                          <span className="text-[10px] text-amber-800 px-1">
                            +{job.skills.length - 4} more
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-[rgba(251,191,36,0.07)]">
                      <p className="font-mono font-semibold text-market-400 text-xs">
                        {formatXLM(job.budget)}
                      </p>
                      <p className="text-[10px] text-amber-800/60">
                        {timeAgo(job.createdAt)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="text-center py-16">
            <NoJobsIcon className="mx-auto mb-4 h-12 w-12 text-amber-900/40" />
            <p className="text-amber-700 text-sm">
              No cached jobs yet. Browse some jobs while online and they&apos;ll
              appear here when you&apos;re offline.
            </p>
            <Link
              href="/jobs"
              className="mt-6 inline-block btn-primary text-sm py-2.5 px-5"
            >
              Browse Jobs
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function OfflineIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function NoJobsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 14.15v4.073a2.25 2.25 0 01-2.25 2.25h-12a2.25 2.25 0 01-2.25-2.25V6a2.25 2.25 0 012.25-2.25h4.5M19.5 4.5l-9 9m0 0H15m-4.5 0V9"
      />
    </svg>
  );
}
