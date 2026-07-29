/**
 * components/dashboard-tabs/PostedJobsTab.tsx
 * Tab for displaying posted jobs in dashboard
 */
import Link from "next/link";
import { useRouter } from "next/router";
import { formatXLM, timeAgo, exportJobsToCSV } from "@/utils/format";
import type { Job } from "@/utils/types";
import JobStatusTimeline from "@/components/JobStatusTimeline";
import StateMessage from "@/components/StateMessage";
import ExtendJobModal from "@/components/ExtendJobModal";

interface Props {
  myJobs: Job[];
  onExtendJob: (jobId: string) => void;
  onRepost: (job: Job) => void;
  extendModalJob: Job | null;
  onJobExtended: (updated: Job) => void;
  onCloseExtendModal: () => void;
}

export default function PostedJobsTab({
  myJobs,
  onExtendJob,
  onRepost,
  extendModalJob,
  onJobExtended,
  onCloseExtendModal
}: Props) {
  const router = useRouter();

  const isRepostable = (status: Job["status"]) => status === "cancelled";

  if (myJobs.length === 0) {
    return (
      <StateMessage
        type="empty"
        title="You haven't posted any jobs yet"
        description="Post your first job and find a great freelancer"
        ctaLabel="Post a Job"
        onCta={() => router.push('/post-job')}
      />
    );
  }

  return (
    <>
      <div className="flex justify-end mb-2">
        <button
          onClick={() => exportJobsToCSV(myJobs)}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          Download CSV
        </button>
      </div>
      {myJobs.map((job) => (
        <div
          key={job.id}
          className="card-hover flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <Link
            href={`/jobs/${job.id}`}
            className="flex-1 min-w-0 block"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-400">
                {job.status}
              </span>
              <span className="text-xs text-amber-800">
                {job.category}
              </span>
            </div>
            <p className="font-display font-semibold text-amber-100 truncate">
              {job.title}
            </p>
            <p className="text-xs text-amber-800 mt-1">
              {job.applicantCount} applicant
              {job.applicantCount !== 1 ? "s" : ""} ·{" "}
              {timeAgo(job.createdAt)}
            </p>
            <JobStatusTimeline job={job} compact />
          </Link>
          <div className="text-right flex-shrink-0">
            <p className="font-mono font-semibold text-market-400">
              {formatXLM(job.budget)}
            </p>
            <div className="flex gap-1 mt-1 justify-end">
              {job.status === "open" && job.expiresAt && (
                (() => {
                  const daysUntilExpiry = Math.ceil(
                    (new Date(job.expiresAt).getTime() - Date.now()) /
                      (1000 * 60 * 60 * 24),
                  );
                  if (daysUntilExpiry <= 3) {
                    return (
                      <button
                        className="btn-secondary text-xs px-2 py-1"
                        onClick={(e) => {
                          e.preventDefault();
                          onExtendJob(job.id);
                        }}
                      >
                        Extend
                      </button>
                    );
                  }
                  return null;
                })()
              )}
              {isRepostable(job.status) && (
                <button
                  className="btn-secondary text-xs px-3 py-1.5"
                  onClick={() => onRepost(job)}
                >
                  Repost Job
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {extendModalJob && (
        <ExtendJobModal
          job={extendModalJob}
          onExtended={onJobExtended}
          onClose={onCloseExtendModal}
        />
      )}
    </>
  );
}
