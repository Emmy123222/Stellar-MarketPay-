import TimeTracker from "@/components/TimeTracker";
import JobTimeline from "@/components/JobTimeline";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { recordViewedJob } from "@/lib/offlineJobs";
import Link from "next/link";
import Head from "next/head";
import ApplicationForm from "@/components/ApplicationForm";
import WalletConnect from "@/components/WalletConnect";
import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";
import RealtimeBidComparison from "@/components/RealtimeBidComparison";
import FeeEstimationModal from "@/components/FeeEstimationModal";
import { fetchJob, fetchApplications, acceptApplication, releaseEscrow, fetchClientReputation, raiseDispute, resolveDispute, timeoutRefund, releaseMilestone, disputeMilestone } from "@/lib/api";
import { formatXLM, formatDate, shortenAddress, statusLabel, statusClass, timeAgo } from "@/utils/format";
import {
  accountUrl,
  buildReleaseEscrowTransaction,
  submitSignedSorobanTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import Spinner from "@/components/Spinner";
import type { Application, Job, ClientReputation } from "@/utils/types";

interface JobDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
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
  const [activeMilestoneIndex, setActiveMilestoneIndex] = useState<number | null>(null);
  const [releaseSuccess, setReleaseSuccess] = useState(false);
  const [prefillData, setPrefillData] = useState<any>(null);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [raisingDispute, setRaisingDispute] = useState(false);
  const [resolvingDispute, setResolvingDispute] = useState(false);
  const [clientReputation, setClientReputation] = useState<ClientReputation | null>(null);
  const [pendingTimeoutRefund, setPendingTimeoutRefund] = useState<any>(null);

  const isClient = Boolean(publicKey && job?.clientAddress === publicKey);
  const isFreelancer = Boolean(publicKey && job?.freelancerAddress === publicKey);
  const hasApplied = (applications ?? []).some(
    (application) => application.freelancerAddress === publicKey,
  );

  useEffect(() => {
    if (!jobId || !router.isReady) return;

    const { prefill } = router.query;

    if (typeof prefill === "string") {
      try {
        setPrefillData(
          JSON.parse(Buffer.from(prefill, "base64").toString("utf8")),
        );
      } catch {
        setPrefillData(null);
      }
    }

    Promise.all([fetchJob(jobId as string), fetchApplications(jobId as string)])
      .then(async ([loadedJob, loadedApplications]) => {
        setJob(loadedJob);
        setApplications(loadedApplications);
        try {
          const rep = await fetchClientReputation(loadedJob.clientAddress);
          setClientReputation(rep);
        } catch {
          setClientReputation(null);
        }
        // Persist to localStorage so the offline page can show last-viewed jobs
        recordViewedJob(loadedJob);
      })
      .catch(() => router.push("/jobs"))
      .finally(() => setLoading(false));
  }, [jobId, router, router.isReady, router.query]);

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

  const handleReleaseMilestone = async (milestoneIndex: number) => {
    if (!publicKey || !job) return;
    setActiveMilestoneIndex(milestoneIndex);
    setActionError(null);
    try {
      await releaseMilestone(job.id, publicKey, milestoneIndex, `offchain-${Date.now()}`);
      setJob(await fetchJob(job.id));
      setReleaseSuccess(true);
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not release milestone.");
    } finally {
      setActiveMilestoneIndex(null);
    }
  };

  const handleDisputeMilestone = async (milestoneIndex: number) => {
    if (!publicKey || !job) return;
    setActiveMilestoneIndex(milestoneIndex);
    setActionError(null);
    try {
      await disputeMilestone(job.id, publicKey, milestoneIndex);
      setJob(await fetchJob(job.id));
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not dispute milestone.");
    } finally {
      setActiveMilestoneIndex(null);
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
      const prepared = await buildReleaseEscrowTransaction(
        job.escrowContractId,
        job.id,
        publicKey,
      );
      const { signedXDR, error: signError } = await signTransactionWithWallet(
        prepared.toXDR(),
      );

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
      setActionError(
        error instanceof Error ? error.message : "Could not complete escrow release.",
      );
    } finally {
      setReleasingEscrow(false);
    }
  };

  const handleRaiseDispute = async () => {
    if (!publicKey || !jobId) return;
    setRaisingDispute(true);
    try {
      await raiseDispute(jobId, { reason: disputeReason, description: disputeDescription });
      setShowDisputeModal(false);
      setDisputeReason("");
      setDisputeDescription("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to raise dispute.");
    } finally {
      setRaisingDispute(false);
    }
  };

  const handleConfirmTimeoutRefundFee = async () => {
    if (!publicKey || !jobId) return;
    setPendingTimeoutRefund(null);
    try {
      await timeoutRefund(jobId, publicKey);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Timeout refund failed.");
    }
  };

  const handleCancelTimeoutRefundFee = () => {
    setPendingTimeoutRefund(null);
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
        <div className="h-8 bg-market-500/8 rounded w-2/3 mb-4" />
        <div className="h-4 bg-market-500/5 rounded w-1/3 mb-8" />
        <div className="card space-y-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-4 bg-market-500/8 rounded w-full" />
          ))}
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
          className="inline-flex items-center gap-1.5 text-sm text-amber-800 hover:text-amber-400 transition-colors mb-6"
        >
          ← Back to Jobs
        </Link>

        <div className="card mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-5">
            <div className="flex-1 min-w-0">
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

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 leading-snug break-words">
                {job.title}
              </h1>

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-amber-700">
                <span>Posted {timeAgo(job.createdAt)}</span>
                <span>{applications.length} application{applications.length === 1 ? "" : "s"}</span>
                {job.deadline && <span>Deadline: {formatDate(job.deadline)}</span>}
              </div>
            </div>

            <div className="flex-shrink-0 sm:text-right">
              <p className="text-xs text-amber-800 mb-1">Budget</p>
              <p className="font-mono font-bold text-2xl text-market-400">
                {formatXLM(job.budget)} {job.currency}
              </p>
              <a
                href={accountUrl(job.clientAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-3 text-sm text-amber-700 hover:text-market-400 transition-colors"
              >
                Client: {shortenAddress(job.clientAddress)} ↗
              </a>
            </div>
          </div>

          <JobTimeline
            status={job.status}
            createdAt={job.createdAt}
            updatedAt={job.updatedAt}
            applications={applications}
            disputedAt={job.disputedAt}
          />

          <div className="prose prose-sm max-w-none">
            <h3 className="font-display text-base font-semibold text-amber-300 mb-3">
              Description
            </h3>
            <p className="text-amber-700/90 leading-relaxed whitespace-pre-wrap break-words font-body text-sm">
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

          {clientReputation && (
            <div className="mt-6 rounded-xl border border-market-500/20 bg-ink-900/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-base font-semibold text-amber-100">Client Reputation</h3>
                <span className="inline-flex items-center rounded-full border border-market-500/30 bg-market-500/10 px-2.5 py-1 text-xs font-semibold text-market-300">
                  ★ {clientReputation.score.toFixed(1)} / 5.0
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-amber-700">
                <p>Payment release rate: {clientReputation.paymentReleaseRate}%</p>
                <p>Dispute rate: {clientReputation.disputeRate}%</p>
                <p>Completion rate: {clientReputation.completionRate}%</p>
                <p>Avg payment release time: {clientReputation.avgTimeToReleaseHours}h</p>
                <p>Response time to applications: {clientReputation.responseTimeToApplicationsHours}h</p>
              </div>
            </div>
          )}

          {clientReputation && (
            <div className="mt-6 rounded-xl border border-market-500/20 bg-ink-900/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-base font-semibold text-amber-100">Client Reputation</h3>
                <span className="inline-flex items-center rounded-full border border-market-500/30 bg-market-500/10 px-2.5 py-1 text-xs font-semibold text-market-300">
                  ★ {clientReputation.score.toFixed(1)} / 5.0
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-amber-700">
                <p>Payment release rate: {clientReputation.paymentReleaseRate}%</p>
                <p>Dispute rate: {clientReputation.disputeRate}%</p>
                <p>Completion rate: {clientReputation.completionRate}%</p>
                <p>Avg payment release time: {clientReputation.avgTimeToReleaseHours}h</p>
                <p>Response time to applications: {clientReputation.responseTimeToApplicationsHours}h</p>
              </div>
            </div>
          )}

          {actionError && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {actionError}
            </div>
          )}

          <div className="mt-5">
            <button
              onClick={() => setShowShareModal(true)}
              className="text-xs text-market-400 hover:text-market-300 underline min-h-[44px] min-w-[44px] inline-flex items-center"
            >
              Share job
            </button>
          </div>
        </div>

        {actionError && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {actionError}
          </div>
        )}

        {(isFreelancer || isClient) && job.status === "in_progress" && (
          <TimeTracker
            jobId={job.id}
            isFreelancer={isFreelancer}
            isClient={isClient}
          />
        )}

        {isClient && job.status === "open" && (
          <div className="mb-6">
            <RealtimeBidComparison
              jobId={job.id}
              initialApplications={applications}
              isClient={isClient}
              onAcceptApplication={handleAcceptApplication}
            />
          </div>
        )}

        {job.status === "open" && !publicKey && !isClient && (
          <div className="mb-6">
            <WalletConnect onConnect={onConnect} />
          </div>
        )}

        {job.status === "open" && publicKey && !isClient && (
          <>
            {hasApplied ? (
              <div className="card text-center py-8 border-market-500/20 mb-6">
                <p className="text-market-400 font-medium mb-1">Application submitted</p>
                <p className="text-amber-800 text-sm">
                  The client will review your proposal shortly.
                </p>
              </div>
            ) : showApplyForm ? (
              <ApplicationForm
                job={job}
                publicKey={publicKey}
                prefillData={prefillData || undefined}
                onSuccess={() => {
                  setShowApplyForm(false);
                  fetchApplications(job.id).then(setApplications);
                }}
              />
            ) : (
              <div className="text-center mb-6">
                <button
                  onClick={() => setShowApplyForm(true)}
                  className="btn-primary text-base px-10 py-3.5 min-h-[44px]"
                >
                  Apply for this Job
                </button>
              </div>
            )}
          </>
        )}

        {isClient && job.status === "in_progress" && (!job.milestones || job.milestones.length === 0) && (
          <div className="card mb-6">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-3">Escrow</h2>
            <button
              onClick={handleReleaseEscrow}
              disabled={releasingEscrow}
              className="btn-primary min-h-[44px]"
            >
              {releasingEscrow ? "Releasing..." : "Release Escrow"}
            </button>
            {releaseSuccess && (
              <p className="mt-3 text-emerald-400 text-sm">Escrow released successfully.</p>
            )}
          </div>
        )}

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

      {/* Dispute Modal */}
      {showDisputeModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => setShowDisputeModal(false)} />
          <div className="relative w-full max-w-md bg-ink-900 border border-market-500/20 rounded-2xl p-6 shadow-2xl animate-scale-in">
            <h3 className="font-display text-xl font-bold text-amber-100 mb-2">Raise a Dispute</h3>
            <p className="text-sm text-amber-800 mb-6">Flag this job for admin review. This will block escrow release until resolved.</p>

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
                  rows={4}
                  className="textarea-field"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setShowDisputeModal(false)}
                className="flex-1 btn-secondary py-2.5 min-h-[44px]"
                disabled={raisingDispute}
              >
                Cancel
              </button>
              <button
                onClick={handleRaiseDispute}
                className="flex-1 btn-primary py-2.5 min-h-[44px] flex items-center justify-center gap-2"
                disabled={raisingDispute || !disputeReason || !disputeDescription}
              >
                {raisingDispute ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" /> : "Raise Dispute"}
              </button>
            </div>
            {actionError && <p className="mt-3 text-red-400 text-sm text-center">{actionError}</p>}
          </div>
        </div>
      )}
    </>
  );
}
