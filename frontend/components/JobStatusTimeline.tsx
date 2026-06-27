/**
 * components/JobStatusTimeline.tsx
 * Visual stepper showing job lifecycle progression.
 */
import { formatDate } from "@/utils/format";
import type { Job, JobStatus } from "@/utils/types";

interface JobStatusTimelineProps {
  job: Job;
  compact?: boolean;
}

type StepState = "complete" | "current" | "upcoming" | "branch";

interface TimelineStep {
  id: string;
  label: string;
  date?: string;
  state: StepState;
}

function buildSteps(job: Job): { steps: TimelineStep[]; branch?: TimelineStep } {
  const hiredDate =
    job.freelancerAddress && job.status !== "open" ? job.updatedAt : undefined;
  const doneDate = job.status === "completed" ? job.updatedAt : undefined;
  const branchDate =
    job.status === "cancelled" || job.status === "disputed"
      ? job.disputedAt || job.updatedAt
      : undefined;

  const steps: TimelineStep[] = [
    {
      id: "posted",
      label: "Posted",
      date: job.createdAt,
      state: "complete",
    },
    {
      id: "hired",
      label: "Hired",
      date: hiredDate,
      state: "upcoming",
    },
    {
      id: "in_progress",
      label: "In Progress",
      date:
        job.status === "in_progress" || job.status === "disputed"
          ? job.updatedAt
          : hiredDate,
      state: "upcoming",
    },
    {
      id: "done",
      label: "Done",
      date: doneDate,
      state: "upcoming",
    },
  ];

  if (job.status === "open") {
    steps[0].state = "current";
  } else if (job.status === "in_progress") {
    steps[0].state = "complete";
    steps[1].state = "complete";
    steps[2].state = "current";
  } else if (job.status === "completed") {
    steps.forEach((s) => {
      s.state = "complete";
    });
  } else if (job.status === "cancelled") {
    steps[0].state = "complete";
    return {
      steps,
      branch: {
        id: "cancelled",
        label: "Cancelled",
        date: branchDate,
        state: "branch",
      },
    };
  } else if (job.status === "disputed") {
    steps[0].state = "complete";
    steps[1].state = "complete";
    steps[2].state = "complete";
    return {
      steps,
      branch: {
        id: "disputed",
        label: "Disputed",
        date: branchDate,
        state: "branch",
      },
    };
  }

  return { steps };
}

function circleClasses(state: StepState) {
  if (state === "complete") return "bg-market-400 border-market-400 text-ink-900";
  if (state === "current") return "bg-ink-900 border-market-400 text-market-400 ring-2 ring-market-400/30";
  if (state === "branch") return "bg-red-500/20 border-red-400 text-red-300";
  return "bg-ink-800 border-market-500/20 text-amber-700";
}

function StepCircle({ state }: { state: StepState }) {
  return (
    <div
      className={[
        "flex items-center justify-center rounded-full border-2 font-bold transition-all duration-500 w-7 h-7 text-xs",
        circleClasses(state),
        state === "current" ? "motion-safe:animate-pulse-soft" : "",
      ].join(" ")}
    >
      {state === "complete" ? (
        <span className="inline-block motion-safe:animate-scale-in">✓</span>
      ) : state === "branch" ? (
        "!"
      ) : (
        ""
      )}
    </div>
  );
}

function Connector({ complete, vertical }: { complete: boolean; vertical?: boolean }) {
  if (vertical) {
    return (
      <div className={["w-0.5 h-6 mx-auto", complete ? "bg-market-400" : "bg-market-500/15"].join(" ")} />
    );
  }
  return (
    <div className={["flex-1 h-0.5 min-w-[1rem]", complete ? "bg-market-400" : "bg-market-500/15"].join(" ")} />
  );
}

export default function JobStatusTimeline({ job, compact = false }: JobStatusTimelineProps) {
  const { steps, branch } = buildSteps(job);

  if (compact) {
    const currentStep = branch || steps.find((s) => s.state === "current");
    const progressIdx = branch
      ? steps.length - 1
      : Math.max(
          steps.findIndex((s) => s.state === "current"),
          steps.filter((s) => s.state === "complete").length - 1,
        );

    return (
      <div className="mt-3 pt-3 border-t border-[rgba(251,191,36,0.07)]">
        <div className="flex items-center gap-1">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <div
                title={step.label}
                className={[
                  "w-2 h-2 rounded-full flex-shrink-0",
                  step.state === "complete" || step.state === "current"
                    ? "bg-market-400"
                    : "bg-market-500/20",
                  step.state === "current" ? "ring-2 ring-market-400/40" : "",
                ].join(" ")}
              />
              {i < steps.length - 1 && (
                <div
                  className={[
                    "flex-1 h-0.5 mx-0.5",
                    i < progressIdx ? "bg-market-400" : "bg-market-500/15",
                  ].join(" ")}
                />
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-amber-800/70 mt-1.5">{currentStep?.label}</p>
      </div>
    );
  }

  return (
    <div className="mt-5 pt-5 border-t border-[rgba(251,191,36,0.07)]">
      <p className="text-xs uppercase tracking-wider text-amber-800/70 mb-4">Job Progress</p>

      <div className="hidden sm:flex items-start">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-start flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5 min-w-[4.5rem]">
              <StepCircle state={step.state} />
              <span
                className={[
                  "text-xs font-medium text-center",
                  step.state === "complete" || step.state === "current"
                    ? "text-market-400"
                    : "text-amber-700",
                ].join(" ")}
              >
                {step.label}
              </span>
              {step.date && (
                <span className="text-[10px] text-amber-800/60 whitespace-nowrap">
                  {formatDate(step.date)}
                </span>
              )}
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 flex items-center pt-3.5 px-1">
                <Connector complete={step.state === "complete"} />
              </div>
            )}
          </div>
        ))}

        {branch && (
          <div className="flex items-start ml-2 pl-2 border-l border-dashed border-red-400/40">
            <div className="flex flex-col items-center gap-1.5 min-w-[4.5rem]">
              <StepCircle state="branch" />
              <span className="text-xs font-medium text-red-400 text-center">{branch.label}</span>
              {branch.date && (
                <span className="text-[10px] text-amber-800/60 whitespace-nowrap">
                  {formatDate(branch.date)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="sm:hidden space-y-0">
        {steps.map((step, i) => (
          <div key={step.id}>
            <div className="flex items-start gap-3">
              <StepCircle state={step.state} />
              <div className="pt-0.5 pb-1">
                <p
                  className={[
                    "text-sm font-medium",
                    step.state === "complete" || step.state === "current"
                      ? "text-market-400"
                      : "text-amber-700",
                  ].join(" ")}
                >
                  {step.label}
                </p>
                {step.date && (
                  <p className="text-xs text-amber-800/60">{formatDate(step.date)}</p>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="ml-3.5">
                <Connector complete={step.state === "complete"} vertical />
              </div>
            )}
          </div>
        ))}

        {branch && (
          <div className="flex items-start gap-3 mt-2 pt-2 border-t border-dashed border-red-400/30">
            <StepCircle state="branch" />
            <div className="pt-0.5">
              <p className="text-sm font-medium text-red-400">{branch.label}</p>
              {branch.date && (
                <p className="text-xs text-amber-800/60">{formatDate(branch.date)}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
