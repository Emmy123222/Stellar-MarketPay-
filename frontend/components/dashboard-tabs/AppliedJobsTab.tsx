/**
 * components/dashboard-tabs/AppliedJobsTab.tsx
 * Tab for displaying job applications in dashboard
 */
import Link from "next/link";
import { useRouter } from "next/router";
import { formatXLM, timeAgo, exportApplicationsToCSV } from "@/utils/format";
import type { Application } from "@/utils/types";
import StateMessage from "@/components/StateMessage";

interface Props {
  myApplications: Application[];
}

export default function AppliedJobsTab({ myApplications }: Props) {
  const router = useRouter();

  if (myApplications.length === 0) {
    return (
      <StateMessage
        type="empty"
        title="You haven't applied to any jobs yet"
        description="Browse open jobs and submit your first proposal"
        ctaLabel="Browse Jobs"
        onCta={() => router.push('/jobs')}
      />
    );
  }

  return (
    <>
      <div className="flex justify-end mb-2">
        <button
          onClick={() => exportApplicationsToCSV(myApplications)}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          Download CSV
        </button>
      </div>
      {myApplications.map((app) => (
        <Link
          key={app.id}
          href={`/jobs/${app.jobId}`}
          className="card-hover flex items-center justify-between gap-4"
        >
          <div className="flex-1">
            <p className="text-amber-700 text-sm line-clamp-1">
              {app.proposal}
            </p>
            <p className="text-xs text-amber-800 mt-1">
              {timeAgo(app.createdAt)}
            </p>
          </div>
          <p className="font-mono font-semibold text-market-400">
            {formatXLM(app.bidAmount)}
          </p>
        </Link>
      ))}
    </>
  );
}
