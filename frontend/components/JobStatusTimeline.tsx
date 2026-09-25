/**
 * components/JobStatusTimeline.tsx
 * Visual stepper showing job lifecycle progression with on-chain event anchoring (Issue #876).
 */
import { useState } from "react";
import { formatDate } from "@/utils/format";
import { explorerUrl } from "@/lib/stellar";
import { rejectMilestone } from "@/lib/api";
import { anchorMilestoneProof, uploadMilestoneProof } from "@/lib/api/milestoneProof";
import type { Job, JobStatus, JobMilestone, TimelineEvent } from "@/utils/types";

interface JobStatusTimelineProps {
  job: Job;
  compact?: boolean;
  /**
   * When provided, a "Reject" button is shown per milestone so the client can
   * reject (and refund) an individual milestone. Should be the connected
   * client's wallet address.
   */
  clientAddress?: string;
  /** Assigned freelancer wallet; enables milestone proof uploads. */
  freelancerAddress?: string;
  /** Called after a milestone is successfully rejected, to refresh the job. */
  onMilestoneRejected?: () => void;
  /** On-chain timeline events (Issue #876). When provided, steps with txHash show a "View on Stellar Expert" link. */
  timeline?: TimelineEvent[];
}

type StepState = "complete" | "current" | "upcoming" | "branch";

interface TimelineStep {
  id: string;
  label: string;
  date?: string;
  state: StepState;
  txHash?: string | null;
}

/**
 * Resolve a timeline event's tx_hash for a given step id.
 */
function findTxHash(timeline: TimelineEvent[] | undefined, eventType: string): string | null {
  if (!timeline) return null;
  const event = timeline.find((e) => e.eventType === eventType);
  return event?.txHash || null;
}

function buildSteps(job: Job, timeline?: TimelineEvent[]): { steps: TimelineStep[]; branch?: TimelineStep } {
  const hiredDate =
    job.freelancerAddress && job.status !== "open" ? job.updatedAt : undefined;
  const doneDate = job.status === "completed" ? job.updatedAt : undefined;
  const branchDate =
    job.status === "cancelled" || job.status === "disputed"
      ? job.disputedAt || job.updatedAt
      : undefined;

  // Look up on-chain tx hashes from timeline events
  const escrowFundedTxHash = findTxHash(timeline, "escrow_funded");
  const escrowReleasedTxHash = findTxHash(timeline, "escrow_released");

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
      label: "Escrow Funded",
      date:
        job.status === "in_progress" || job.status === "disputed"
          ? job.updatedAt
          : hiredDate,
      state: "upcoming",
      txHash: escrowFundedTxHash,
    },
    {
      id: "done",
      label: "Released",
      date: doneDate,
      state: "upcoming",
      txHash: escrowReleasedTxHash,
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

/** Render a "View on Stellar Expert" link for steps with a tx hash. */
function StellarExpertLink({ txHash }: { txHash: string }) {
  return (
    <a
      href={explorerUrl(txHash)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[10px] text-market-400 hover:text-market-300 hover:underline transition-colors mt-0.5"
      title={`View transaction ${txHash} on Stellar Expert`}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
      View on Stellar Expert ↗
    </a>
  );
}

function MilestoneRejectionList({
  job,
  clientAddress,
  onMilestoneRejected,
  freelancerAddress,
}: {
  job: Job;
  clientAddress?: string;
  onMilestoneRejected?: () => void;
  freelancerAddress?: string;
}) {
  const milestones = job.milestones ?? [];
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofPendingIndex, setProofPendingIndex] = useState<number | null>(null);
  const [proofs, setProofs] = useState<Record<number, { cid: string; gatewayUrl: string; txHash: string }>>({});

  const canReject = Boolean(clientAddress) &&
    clientAddress === job.clientAddress && job.status === "in_progress";

  if (!milestones.length || (!canReject && !freelancerAddress)) return null;

  async function handleReject(index: number) {
    setError(null);
    setPendingIndex(index);
    try {
      if (!clientAddress) return;
      await rejectMilestone(job.id, clientAddress, index);
      onMilestoneRejected?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to reject milestone",
      );
    } finally {
      setPendingIndex(null);
    }
  }

  async function handleProof(index: number, file: File) {
    setProofError(null);
    setProofPendingIndex(index);
    try {
      if (!freelancerAddress) throw new Error("Connect the assigned freelancer wallet to upload proof");
      const proof = await uploadMilestoneProof(job.id, index, freelancerAddress, file);
      const txHash = await anchorMilestoneProof(job.id, index, freelancerAddress, proof.cid);
      setProofs((current) => ({ ...current, [index]: { ...proof, txHash } }));
    } catch (e) {
      setProofError(e instanceof Error ? e.message : "Failed to upload proof");
    } finally {
      setProofPendingIndex(null);
    }
  }

  return (
    <div className="mt-5 pt-5 border-t border-[rgba(251,191,36,0.07)]">
      <p className="text-xs uppercase tracking-wider text-amber-800/70 mb-3">
        Milestones
      </p>
      <ul className="space-y-2">
        {milestones.map((milestone: JobMilestone, index: number) => {
          const resolved =
            milestone.status === "released" ||
            milestone.status === "rejected" ||
            milestone.status === "disputed";
          return (
            <li
              key={index}
              className="flex items-center justify-between gap-3 rounded-lg border border-market-500/15 bg-ink-800/40 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm text-market-100 truncate">
                  {milestone.description}
                </p>
                <p className="text-[11px] text-amber-800/60">
                  {milestone.amount} {job.currency} · {milestone.status}
                </p>
                {(proofs[index]?.cid || milestone.proofCid) && (
                  <p className="mt-1 text-[11px] text-market-300 break-all">
                    Proof CID: {proofs[index]?.cid || milestone.proofCid}
                    <a
                      className="ml-2 underline hover:text-market-100"
                      href={proofs[index]?.gatewayUrl || milestone.proofGatewayUrl || `https://gateway.pinata.cloud/ipfs/${proofs[index]?.cid || milestone.proofCid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Verify on IPFS
                    </a>
                  </p>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {freelancerAddress && !resolved && (
                  <label className="cursor-pointer rounded-md border border-market-400/40 px-2.5 py-1 text-xs font-medium text-market-300 hover:bg-market-400/10">
                    {proofPendingIndex === index ? "Anchoring..." : "Upload proof"}
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,application/pdf"
                      disabled={proofPendingIndex !== null}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleProof(index, file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                )}
                <button
                  type="button"
                  disabled={resolved || pendingIndex !== null}
                  onClick={() => handleReject(index)}
                  className="flex-shrink-0 rounded-md border border-red-400/40 px-2.5 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pendingIndex === index ? "Rejecting..." : "Reject"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {proofError && <p className="mt-2 text-xs text-red-400">{proofError}</p>}
    </div>
  );
}

export default function JobStatusTimeline({
  job,
  compact = false,
  clientAddress,
  freelancerAddress,
  onMilestoneRejected,
  timeline,
}: JobStatusTimelineProps) {
  const { steps, branch } = buildSteps(job, timeline);

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
              {step.txHash && (
                <StellarExpertLink txHash={step.txHash} />
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

      {/* Mobile vertical layout */}
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
                {step.txHash && (
                  <StellarExpertLink txHash={step.txHash} />
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

      {(clientAddress || freelancerAddress) && (
        <MilestoneRejectionList
          job={job}
          clientAddress={clientAddress}
          freelancerAddress={freelancerAddress}
          onMilestoneRejected={onMilestoneRejected}
        />
      )}
    </div>
  );
}
