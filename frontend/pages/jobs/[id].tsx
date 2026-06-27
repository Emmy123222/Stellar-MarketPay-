import TimeTracker from "@/components/TimeTracker";
import FeeEstimationModal from "@/components/FeeEstimationModal";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import ApplicationForm from "@/components/ApplicationForm";
import WalletConnect from "@/components/WalletConnect";
import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";
import {
  fetchJob,
  fetchApplications,
  acceptApplication,
  releaseEscrow,
  raiseDispute,
} from "@/lib/api";
import {
  formatXLM,
  formatDate,
  timeAgo,
  shortenAddress,
  statusLabel,
  statusClass,
} from "@/utils/format";
import {
  accountUrl,
  buildReleaseEscrowTransaction,
  submitSignedSorobanTransaction,
  buildPartialReleaseTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import type { Transaction } from "@stellar/stellar-sdk";
import type { Application, Job } from "@/utils/types";

interface JobDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

function badgeClass(status: string) {
  if (status === "accepted") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (status === "rejected") return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-market-500/10 text-market-400 border-market-500/20";
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function JobDetail({ publicKey, onConnect }: JobDetailProps) {
  const router = useRouter();
  const jobId = typeof router.query.id === "string" ? router.query.id : null;

  const [job, setJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [releasingEscrow, setReleasingEscrow] = useState(false);
  const [releaseSuccess, setReleaseSuccess] = useState(false);
  const [prefillData, setPrefillData] = useState<any>(null);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [raisingDispute, setRaisingDispute] = useState(false);
  // Escrow timeout state
  const [timeoutLedger, setTimeoutLedger] = useState<number | null>(null);
  const [currentLedger, setCurrentLedger] = useState(0);
  const [timeoutCountdown, setTimeoutCountdown] = useState<string | null>(null);
  const [timeoutRefundSuccess, setTimeoutRefundSuccess] = useState(false);
  const [pendingTimeoutRefund, setPendingTimeoutRefund] = useState<Transaction | null>(null);
  // Milestone/partial-release state
  const [releasingMilestoneIndex, setReleasingMilestoneIndex] = useState<number | null>(null);
  const [pendingRelease, setPendingRelease] = useState<{ transaction: Transaction; fnName: string } | null>(null);

  const isClient = Boolean(publicKey && job?.clientAddress === publicKey);
  const isFreelancer = Boolean(publicKey && job?.freelancerAddress === publicKey);
  const hasApplied = applications.some((a) => a.freelancerAddress === publicKey);

  useEffect(() => {
    if (!jobId || !router.isReady) return;

    const { prefill } = router.query;
    if (typeof prefill === "string") {
      try {
        setPrefillData(JSON.parse(Buffer.from(prefill, "base64").toString("utf8")));
      } catch {
        setPrefillData(null);
      }
    }

    Promise.all([fetchJob(jobId), fetchApplications(jobId)])
      .then(([loadedJob, loadedApplications]) => {
        setJob(loadedJob);
        setApplications(loadedApplications);
      })
      .catch(() => router.push("/jobs"))
      .finally(() => setLoading(false));
  }, [jobId, router.isReady, router]);

  const handleAcceptApplication = async (applicationId: string) => {
    if (!publicKey || !jobId) return;
    try {
      setActionError(null);
      await acceptApplication(applicationId, publicKey);
      const [updatedJob, updatedApplications] = await Promise.all([
        fetchJob(jobId),
        fetchApplications(jobId),
      ]);
      setJob(updatedJob);
      setApplications(updatedApplications);
    } catch {
      setActionError("Failed to accept application.");
    }
  };

  const handleReleaseEscrow = async () => {
    if (!publicKey || !job) return;
    if (!job.escrowContractId) {
      setActionError("This job has no escrow contract ID.");
      return;
    }

    setReleasingEscrow(true);
    setActionError(null);

    try {
      const prepared = await buildReleaseEscrowTransaction(job.escrowContractId, job.id, publicKey);
      const { signedXDR, error: signError } = await signTransactionWithWallet(prepared.toXDR());

      if (signError || !signedXDR) {
        setActionError(signError || "Signing was cancelled.");
        return;
      }

      const { hash } = await submitSignedSorobanTransaction(signedXDR);
      await releaseEscrow(job.id, publicKey, hash);

      const refreshedJob = await fetchJob(job.id);
      setJob(refreshedJob);
      setReleaseSuccess(true);
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not complete escrow release.");
    } finally {
      setReleasingEscrow(false);
    }
  };

  const handlePartialRelease = async (index: number) => {
    if (!publicKey || !job) return;
    setActionError(null);
    setReleasingMilestoneIndex(index);
    setReleasingEscrow(true);
    try {
      const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
      if (!contractId) throw new Error("Contract ID not configured");
      const tx = await buildPartialReleaseTransaction(contractId, job.id, publicKey, index);
      setPendingRelease({ transaction: tx, fnName: "release_escrow" });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
      setReleasingEscrow(false);
      setReleasingMilestoneIndex(null);
    }
  };

  const handleRaiseDispute = async () => {
    if (!publicKey || !job) return;
    if (!disputeReason || !disputeDescription) {
      setActionError("Please provide both a reason and a description.");
      return;
    }

    setRaisingDispute(true);
    setActionError(null);

    try {
      await raiseDispute(job.id, { reason: disputeReason, description: disputeDescription });
      const refreshedJob = await fetchJob(job.id);
      setJob(refreshedJob);
      setShowDisputeModal(false);
    } catch (e: any) {
      setActionError(e.response?.data?.error || "Failed to raise dispute.");
    } finally {
      setRaisingDispute(false);
    }
  };

  const handleConfirmTimeoutRefundFee = () => {
    setPendingTimeoutRefund(null);
  };

  const handleCancelTimeoutRefundFee = () => {
    setPendingTimeoutRefund(null);
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
        {/* Back button */}
        <div className="h-6 w-24 bg-market-500/8 rounded mb-6" />

        {/* Job detail card */}
        <div className="card space-y-6">
          {/* Status badges */}
          <div className="flex gap-2">
            <div className="h-6 w-20 bg-market-500/10 rounded-full" />
            <div className="h-6 w-16 bg-market-500/10 rounded-full" />
          </div>

          {/* Title */}
          <div className="h-10 bg-market-500/10 rounded w-3/4" />

          {/* Meta info row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex gap-3">
              <div className="h-4 w-24 bg-market-500/8 rounded" />
              <div className="h-4 w-20 bg-market-500/8 rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-16 bg-market-500/8 rounded" />
              <div className="h-8 w-32 bg-market-500/10 rounded" />
            </div>
          </div>

          {/* Description section */}
          <div className="space-y-3 pt-4 border-t border-market-500/10">
            <div className="h-5 w-32 bg-market-500/10 rounded" />
            <div className="h-4 bg-market-500/8 rounded w-full" />
            <div className="h-4 bg-market-500/8 rounded w-11/12" />
            <div className="h-4 bg-market-500/8 rounded w-5/6" />
          </div>

          {/* Skills section */}
          <div className="space-y-3 pt-4 border-t border-market-500/10">
            <div className="h-5 w-28 bg-market-500/10 rounded" />
            <div className="flex flex-wrap gap-2">
              <div className="h-7 w-20 bg-market-500/10 rounded-full" />
              <div className="h-7 w-24 bg-market-500/10 rounded-full" />
              <div className="h-7 w-16 bg-market-500/10 rounded-full" />
            </div>
          </div>

          {/* Applications section */}
          <div className="space-y-3 pt-4 border-t border-market-500/10">
            <div className="h-5 w-36 bg-market-500/10 rounded" />
            <div className="space-y-3">
              <div className="h-16 bg-market-500/8 rounded" />
              <div className="h-16 bg-market-500/8 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!job) return null;

  return (
    <>
      <Head>
        <title>{job.title} - Stellar MarketPay</title>
        <meta name="description" content={job.description.substring(0, 160)} />
      </Head>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-amber-800 hover:text-amber-400 transition-colors mb-6 min-h-[44px]"
        >
          ← Back to Jobs
        </Link>

        {/* ── Job detail card ── */}
        <div className="card mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-5">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={statusClass(job.status)}>{statusLabel(job.status)}</span>
                <span className="text-xs text-amber-800 bg-ink-700 px-2.5 py-1 rounded-full border border-market-500/10">
                  {job.category}
                </span>
                {job.boosted && new Date(job.boostedUntil || "") > new Date() && (
                  <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                    Featured
                  </span>
                )}
              </div>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 leading-snug">
                {job.title}
              </h1>

                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex flex-wrap gap-3 text-xs sm:text-sm text-amber-700">
                    <span>Posted {timeAgo(job.createdAt)}</span>
                    <span>{applications.length} application{applications.length === 1 ? "" : "s"}</span>
                    {job.deadline && <span>Deadline: {formatDate(job.deadline)}</span>}
                  </div>

                  <div className="sm:text-right">
                    <p className="text-xs text-amber-800 mb-1">Budget</p>
                    <p className="font-mono font-bold text-xl sm:text-2xl text-market-400">{formatXLM(job.budget)} {job.currency}</p>
                    <a
                      href={accountUrl(job.clientAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-xs sm:text-sm text-amber-700 hover:text-market-400 transition-colors"
                    >
                      Client: {shortenAddress(job.clientAddress)} ↗
                    </a>
                  </div>
                </div>
            </div>
          </div>

          <div className="prose prose-sm max-w-none">
            <h3 className="font-display text-base font-semibold text-amber-300 mb-3">
              Description
            </h3>
            <p className="text-amber-700/90 leading-relaxed whitespace-pre-wrap font-body text-sm">
              {job.description}
            </p>
          </div>

          {job.skills?.length > 0 && (
            <div className="mt-5">
              <h3 className="font-display text-base font-semibold text-amber-300 mb-3">
                Required Skills
              </h3>
              <div className="flex flex-wrap gap-2">
                {job.skills.map((skill) => (
                  <span
                    key={skill}
                    className="text-sm bg-market-500/8 text-market-500/80 border border-market-500/15 px-3 py-1 rounded-full"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {actionError && (
            <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {actionError}
            </div>
          )}

          <div className="mt-5">
            <button
              onClick={() => setShowShareModal(true)}
              className="text-xs text-market-400 hover:text-market-300 underline"
            >
              Share job
            </button>
          </div>
        </div>

        {/* ── TimeTracker ── */}
        {(isFreelancer || isClient) && job.status === "in_progress" && (
          <TimeTracker jobId={job.id} isFreelancer={isFreelancer} isClient={isClient} />
        )}

        {/* ── Applications list (client only) ── */}
        {isClient && applications.length > 0 && (
          <div className="mb-6">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-4">
              Applications ({applications.length})
            </h2>

            <div className="space-y-4">
              {applications.map((application) => (
                <div key={application.id} className="card">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-3">
                    <a
                      href={accountUrl(application.freelancerAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="address-tag hover:border-market-500/40 transition-colors break-all text-xs"
                    >
                      {shortenAddress(application.freelancerAddress)} ↗
                    </a>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <span className="font-mono text-market-400 font-semibold text-xs sm:text-sm whitespace-nowrap">
                        {formatXLM(application.bidAmount)}
                      </span>
                      <span className={`text-xs px-2.5 py-1 rounded-full border flex-shrink-0 ${badgeClass(application.status)}`}>
                        {application.status}
                      </span>
                    </div>
                  </div>

                  <p className="text-amber-700/80 text-xs sm:text-sm leading-relaxed mb-4 break-words">
                    {application.proposal}
                  </p>

                  {application.status === "pending" && job.status === "open" && (
                    <button
                      onClick={() => handleAcceptApplication(application.id)}
                      className="btn-secondary text-xs sm:text-sm py-2 px-4 min-h-[44px] flex items-center w-full sm:w-auto"
                    >
                      Accept Proposal
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Apply section (non-client, open jobs) ── */}
        {job.status === "open" && !isClient && (
          <>
            {hasApplied ? (
              <div className="card text-center py-8 border-market-500/20 mb-6">
                <p className="text-market-400 font-medium mb-1">Application submitted</p>
                <p className="text-amber-800 text-sm">
                  The client will review your proposal shortly.
                </p>
              </div>
            ) : showApplyForm && publicKey ? (
              <ApplicationForm
                job={job}
                publicKey={publicKey}
                prefillData={prefillData}
                onSuccess={() => {
                  setShowApplyForm(false);
                  fetchApplications(job.id).then(setApplications);
                }}
              />
            ) : (
              <div className="text-center mb-6">
                <button
                  onClick={() => setShowApplyForm(true)}
                  className="btn-primary text-sm sm:text-base px-6 sm:px-10 py-2.5 sm:py-3.5 w-full sm:w-auto"
                >
                  Apply for this Job
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Escrow timeout countdown + refund UI ── */}
        {job.escrowContractId && timeoutLedger && job.status !== "completed" && job.status !== "cancelled" && (
          <div className="card mb-6">
            <h2 className="font-display text-lg font-bold text-amber-100 mb-3">Escrow Timeout</h2>

            {timeoutRefundSuccess ? (
              <div>
                <p className="text-market-400 font-medium">Timeout refund processed successfully.</p>
              </div>
            ) : timeoutCountdown && currentLedger < timeoutLedger ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-amber-700">Auto-refund available in:</span>
                <span className="font-mono text-sm text-market-400 bg-market-500/8 px-3 py-1 rounded border border-market-500/15">
                  {timeoutCountdown}
                </span>
              </div>
            ) : isClient && currentLedger >= timeoutLedger ? (
              <div>
                <p className="text-sm text-red-400 mb-3">
                  The freelancer did not start work within the timeout period. You can claim a refund.
                </p>
                <WalletConnect onConnect={onConnect} />
              </div>
            ) : (
              <p className="text-sm text-amber-700">
                Timeout period has expired. Only the client can claim a refund.
              </p>
            )}
          </div>
        )}

        {/* ── Escrow release (client, in_progress) ── */}
        {isClient && job.status === "in_progress" && (
          <div className="card mb-6">
            <h2 className="font-display text-lg sm:text-xl font-bold text-amber-100 mb-3">
              Escrow
            </h2>

            <button
              onClick={handleReleaseEscrow}
              disabled={releasingEscrow}
              className="btn-primary w-full sm:w-auto"
            >
              {releasingEscrow ? "Releasing..." : "Release Escrow"}
            </button>

            {releaseSuccess && (
              <p className="mt-3 text-emerald-400 text-sm">Escrow released successfully.</p>
            )}
          </div>
        )}

        {actionError && (
          <p className="mt-3 mb-6 text-red-400 text-sm">{actionError}</p>
        )}

        {/* ── Rating form (after completion) ── */}
        {job.status === "completed" && publicKey && !ratingSubmitted && (
          <div className="mt-6">
            {isClient && job.freelancerAddress && (
              <RatingForm
                jobId={job.id}
                ratedAddress={job.freelancerAddress}
                ratedLabel="the freelancer"
                onSuccess={() => setRatingSubmitted(true)}
              />
            )}
            {isFreelancer && (
              <RatingForm
                jobId={job.id}
                ratedAddress={job.clientAddress}
                ratedLabel="the client"
                onSuccess={() => setRatingSubmitted(true)}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showShareModal && (
        <ShareJobModal job={job} onClose={() => setShowShareModal(false)} />
      )}

      {pendingTimeoutRefund && publicKey && (
        <FeeEstimationModal
          transaction={pendingTimeoutRefund}
          functionName="timeout_refund"
          payerPublicKey={publicKey}
          onConfirm={handleConfirmTimeoutRefundFee}
          onCancel={handleCancelTimeoutRefundFee}
        />
      )}

      {/* ── Dispute modal ── */}
      {showDisputeModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => setShowDisputeModal(false)} />
          <div className="relative w-full max-w-md bg-ink-900 border border-market-500/20 rounded-2xl p-4 sm:p-6 shadow-2xl animate-scale-in max-h-[90vh] overflow-y-auto">
            <h3 className="font-display text-lg sm:text-xl font-bold text-amber-100 mb-2">Raise a Dispute</h3>
            <p className="text-xs sm:text-sm text-amber-800 mb-6">Flag this job for admin review. This will block escrow release until resolved.</p>
            
            <div className="space-y-4">
              <div>
                <label className="label">Reason</label>
                <select
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="input-field"
                >
                  <option value="">Select a reason</option>
                  <option value="Quality of work">Quality of work</option>
                  <option value="Non-delivery">Non-delivery</option>
                  <option value="Communication issues">Communication issues</option>
                  <option value="Unfair terms">Unfair terms</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="label">Description</label>
                <textarea
                  value={disputeDescription}
                  onChange={(e) => setDisputeDescription(e.target.value)}
                  placeholder="Explain the issue in detail..."
                  rows={3}
                  className="textarea-field"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mt-6 sm:mt-8">
              <button
                onClick={() => setShowDisputeModal(false)}
                className="btn-secondary text-sm py-2.5"
                disabled={raisingDispute}
              >
                Cancel
              </button>
              <button
                onClick={handleRaiseDispute}
                className="btn-primary text-sm py-2.5 flex items-center justify-center gap-2"
                disabled={raisingDispute || !disputeReason || !disputeDescription}
              >
                {raisingDispute ? <Spinner /> : "Raise Dispute"}
              </button>
            </div>
            {actionError && (
              <p className="mt-3 text-red-400 text-xs sm:text-sm text-center">{actionError}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
