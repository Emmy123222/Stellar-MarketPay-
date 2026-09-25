/**
 * components/dashboard-tabs/AnalyticsTab.tsx
 * Tab for viewing job analytics
 */
import dynamic from "next/dynamic";
import type { Job } from "@/utils/types";

const JobAnalytics = dynamic(() => import("@/components/JobAnalytics"), {
  loading: () => <div className="animate-pulse bg-market-900/30 h-64 rounded-xl" />,
  ssr: false,
});

interface Props {
  myJobs: Job[];
  selectedJob: Job | null;
  extendingJob: string | null;
  onSelectJob: (job: Job) => void;
  onExtend: (job: Job) => void;
}

export default function AnalyticsTab({
  myJobs,
  selectedJob,
  extendingJob,
  onSelectJob,
  onExtend,
}: Props) {
  if (selectedJob) {
    return (
      <JobAnalytics
        job={selectedJob}
        onExtend={() => onExtend(selectedJob)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {myJobs.map((job) => (
        <button
          key={job.id}
          onClick={() => onSelectJob(job)}
          className="btn-secondary text-sm px-3 py-2 mr-2 mb-2"
        >
          {job.title}
          {extendingJob === job.id ? " (Extending...)" : ""}
        </button>
      ))}
    </div>
  );
}
