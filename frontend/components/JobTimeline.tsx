/**
 * components/JobTimeline.tsx
 * Visual stepper/timeline for Job Status Progression.
 * Supports horizontal/vertical responsive layouts, dates, and branched paths for cancelled/disputed jobs.
 */
import type { JobStatus, Application } from "@/utils/types";
import { formatDate } from "@/utils/format";

interface JobTimelineProps {
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  applications?: Application[];
  disputedAt?: string | null;
  isCompact?: boolean;
}

export default function JobTimeline({
  status,
  createdAt,
  updatedAt,
  applications = [],
  disputedAt,
  isCompact = false,
}: JobTimelineProps) {
  // Find accepted application for "Hired" date
  const acceptedApp = applications.find((app) => app.status === "accepted");
  const hiredDate = acceptedApp?.acceptedAt || acceptedApp?.createdAt || null;

  // Determine active steps
  const isPosted = true;
  const isHired = ["in_progress", "completed", "disputed"].includes(status) || (status === "cancelled" && !!hiredDate);
  const isInProgress = ["in_progress", "completed", "disputed"].includes(status);
  const isCompleted = status === "completed";
  const isDisputed = status === "disputed";
  const isCancelled = status === "cancelled";

  // Build the list of steps based on job lifecycle and branches
  const steps = [
    {
      label: "Posted",
      description: "Job published to market",
      active: isPosted,
      date: createdAt,
      color: "border-market-500 text-market-400 bg-market-500/10",
    },
    {
      label: "Hired",
      description: "Freelancer selected",
      active: isHired,
      date: hiredDate,
      color: isHired
        ? "border-market-500 text-market-400 bg-market-500/10"
        : "border-ink-600 text-amber-900 bg-ink-950/20",
    },
    {
      label: "In Progress",
      description: "Work is under way",
      active: isInProgress,
      date: hiredDate, // typically starts around when hired
      color: isInProgress
        ? "border-market-500 text-market-400 bg-market-500/10"
        : "border-ink-600 text-amber-900 bg-ink-950/20",
    },
  ];

  // Append outcome branch
  if (isDisputed) {
    steps.push({
      label: "Disputed",
      description: "Dispute opened",
      active: true,
      date: disputedAt || updatedAt,
      color: "border-orange-500 text-orange-400 bg-orange-500/10 animate-pulse",
    });
  } else if (isCancelled) {
    steps.push({
      label: "Cancelled",
      description: "Job terminated",
      active: true,
      date: updatedAt,
      color: "border-red-500 text-red-400 bg-red-500/10",
    });
  } else {
    steps.push({
      label: "Done",
      description: "Escrow funds released",
      active: isCompleted,
      date: isCompleted ? updatedAt : null,
      color: isCompleted
        ? "border-emerald-500 text-emerald-400 bg-emerald-500/10"
        : "border-ink-600 text-amber-900 bg-ink-950/20",
    });
  }

  if (isCompact) {
    // Return a streamlined bar for list items
    return (
      <div className="flex items-center gap-1 mt-2 py-1 select-none w-full max-w-md">
        {steps.map((step, idx) => (
          <div key={step.label} className="flex items-center flex-1 last:flex-initial">
            <div className="flex flex-col items-center">
              <span
                className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center text-[7px] font-bold ${
                  step.active ? step.color : "border-ink-700 text-ink-700 bg-ink-950/50"
                }`}
                title={`${step.label}${step.date ? ` - ${formatDate(step.date)}` : ""}`}
              >
                {step.active && "✓"}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`h-[2px] flex-1 mx-1.5 rounded-full ${
                  steps[idx + 1].active ? "bg-market-500/60" : "bg-ink-800"
                }`}
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="w-full bg-ink-950/40 backdrop-blur-md border border-market-500/12 rounded-2xl p-6 my-6 shadow-xl">
      <h3 className="font-display font-bold text-sm text-amber-200 uppercase tracking-wider mb-6">
        Job Status Progression
      </h3>

      {/* Responsive timeline layout: Horizontal on Desktop, Vertical on Mobile */}
      <div className="flex flex-col md:flex-row items-stretch md:items-start justify-between gap-6 md:gap-4">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          const nextActive = !isLast && steps[idx + 1].active;

          return (
            <div key={step.label} className="flex flex-row md:flex-col items-start md:items-center flex-1 relative group">
              {/* Connector line for vertical layout (mobile) */}
              {!isLast && (
                <div
                  className={`absolute left-[11px] top-[24px] bottom-[-24px] w-[2px] md:hidden rounded-full ${
                    nextActive ? "bg-market-500/70" : "bg-ink-800/80"
                  }`}
                />
              )}

              {/* Connector line for horizontal layout (desktop) */}
              {!isLast && (
                <div
                  className={`hidden md:block absolute left-[50%] right-[-50%] top-[11px] h-[2px] rounded-full z-0 ${
                    nextActive ? "bg-market-500/70" : "bg-ink-800/80"
                  }`}
                />
              )}

              {/* Node bubble */}
              <div className="z-10 flex-shrink-0">
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all shadow-md ${
                    step.active
                      ? `${step.color} scale-110 shadow-market-500/5`
                      : "border-ink-700 text-amber-900 bg-ink-950/40"
                  }`}
                >
                  {step.active ? (isCompleted && idx === 3 ? "🏆" : "✓") : idx + 1}
                </div>
              </div>

              {/* Text metadata */}
              <div className="ml-4 md:ml-0 md:mt-3 md:text-center z-10">
                <p
                  className={`font-semibold text-sm transition-colors ${
                    step.active ? "text-amber-100" : "text-amber-900/60"
                  }`}
                >
                  {step.label}
                </p>
                <p className="text-[10px] text-amber-800/75 mt-0.5 max-w-[120px] leading-tight">
                  {step.description}
                </p>
                {step.active && step.date && (
                  <p className="text-[9px] font-mono text-market-400 mt-1.5 bg-market-500/5 border border-market-500/10 px-1.5 py-0.5 rounded-full inline-block">
                    {formatDate(step.date)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
