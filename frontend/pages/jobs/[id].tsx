import TimeTracker from "@/components/TimeTracker";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import ApplicationForm from "@/components/ApplicationForm";
import WalletConnect from "@/components/WalletConnect";
import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";
import { fetchJob, fetchApplications, acceptApplication, releaseEscrow } from "@/lib/api";
import { formatXLM, formatDate, shortenAddress, statusLabel, statusClass } from "@/utils/format";
import {
  accountUrl,
  buildReleaseEscrowTransaction,
  submitSignedSorobanTransaction,
  USDC_SAC_ADDRESS,
  XLM_SAC_ADDRESS,
  subscribeToContractEvents,
  getEscrowState,
  buildPartialReleaseTransaction,
} from "@/lib/stellar";
import { Asset, type Transaction } from "@stellar/stellar-sdk";
import { signTransactionWithWallet } from "@/lib/wallet";
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

export default function JobDetail({ publicKey, onConnect }: JobDetailProps) {
  const router = useRouter();
  const jobId = typeof router.query.id === "string" ? router.query.id : null;
  const prefill = typeof router.query.prefill === "string" ? router.query.prefill : null;

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
  const [resolvingDispute, setResolvingDispute] = useState(false);

  const isClient = Boolean(publicKey && job?.clientAddress === publicKey);
  const isFreelancer = Boolean(publicKey && job?.freelancerAddress === publicKey);
  const hasApplied = applications.some((application) => application.freelancerAddress === publicKey);

  useEffect(() => {
    if (!id || !router.isReady) return;

    const { prefill } = router.query;

    if (typeof prefill === "string") {
      try {
        setPrefillData(JSON.parse(Buffer.from(prefill, "base64").toString("utf8")));
      } catch {
        setPrefillData(null);
      }
    }

    Promise.all([fetchJob(id as string), fetchApplications(id as string)])
      .then(([loadedJob, loadedApplications]) => {
        setJob(loadedJob);
        setApplications(loadedApplications);
      })
      .catch(() => router.push("/jobs"))
      .finally(() => setLoading(false));
  }, [id, router, router.isReady, router.query]);

  const handleAcceptApplication = async (applicationId: string) => {
    if (!publicKey || !id) return;

    try {
      setActionError(null);
      await acceptApplication(applicationId, publicKey);

      const [updatedJob, updatedApplications] = await Promise.all([
        fetchJob(id as string),
        fetchApplications(id as string),
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
      setPendingRelease({ transaction: tx, fnName: "release_escrow" as any });
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
                  {job.boosted && new Date(job.boostedUntil || "") > new Date() && (
                    <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                      Featured
                    </span>
                  )}
                </div>

                <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 leading-snug">
                  {job.title}
                </h1>

                <div className="mt-4 flex flex-wrap gap-3 text-sm text-amber-700">
                  <span>Posted {timeAgo(job.createdAt)}</span>
                  <span>{applications.length} application{applications.length === 1 ? "" : "s"}</span>
                  {job.deadline && <span>Deadline: {formatDate(job.deadline)}</span>}
                </div>
              </div>

              <div className="sm:text-right">
                <p className="text-xs text-amber-800 mb-1">Budget</p>
                <p className="font-mono font-bold text-2xl text-market-400">{printableBudget}</p>
                <a
                  href={accountUrl(job.clientAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-3 text-sm text-amber-700 hover:text-market-400 transition-colors"
                >
                  Client: {shortenAddress(job.clientAddress)}
                </a>
              </div>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 leading-snug">
                {job.title}
              </h1>
            </div>

            <div className="flex-shrink-0 sm:text-right">
              <p className="text-xs text-amber-800 mb-1">Budget</p>
              <p className="font-mono font-bold text-2xl text-market-400">
                {formatXLM(job.budget)} {job.currency}
              </p>

              {job.deadline && (
                <p className="text-xs text-amber-700 mt-2">
                  Deadline: {formatDate(job.deadline)}
                </p>
              )}

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
          </section>

          {actionError && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
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

        {isFreelancer && job.status === "in_progress" && (
          <TimeTracker jobId={job.id} />
        )}

        {isClient && applications.length > 0 && (
          <div className="mb-6">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-4">
              Applications ({applications.length})
            </h2>

            <div className="space-y-4">
              {applications.map((application) => (
                <div key={application.id} className="card">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <a
                      href={accountUrl(application.freelancerAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="address-tag hover:border-market-500/40 transition-colors"
                    >
                      {shortenAddress(application.freelancerAddress)} ↗
                    </a>

                    <div className="flex items-center gap-3">
                      <span className="font-mono text-market-400 font-semibold text-sm">
                        {formatXLM(application.bidAmount)}
                      </span>

                      <span className={`text-xs px-2.5 py-1 rounded-full border ${badgeClass(application.status)}`}>
                        {application.status}
                      </span>
                    </div>
                  </div>

                  <p className="text-amber-700/80 text-sm leading-relaxed mb-4">
                    {application.proposal}
                  </p>

                  {application.status === "pending" && job.status === "open" && (
                    <button
                      onClick={() => handleAcceptApplication(application.id)}
                      className="btn-secondary text-sm py-2 px-4"
                    >
                      Accept Proposal
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {actionError && <p className="mt-3 text-red-400 text-sm">{actionError}</p>}
        </div>
      )}


        {/* Issue #175 — Escrow timeout countdown + refund UI */}
        {job.escrowContractId && timeoutLedger && job.status !== "completed" && job.status !== "cancelled" && (
          <div className="card mb-6">
            <h2 className="font-display text-lg font-bold text-amber-100 mb-3">Escrow Timeout</h2>

            {timeoutRefundSuccess ? (
              <div>
                <p className="text-market-400 font-medium">Timeout refund processed successfully.</p>
              </div>
            ) : timeoutCountdown && currentLedger < timeoutLedger ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-amber-700">
                  Auto-refund available in:
                </span>
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
            ) : hasApplied ? (
              <div className="card text-center py-8 border-market-500/20">
                <p className="text-market-400 font-medium mb-1">Application submitted</p>
                <p className="text-amber-800 text-sm">
                  The client will review your proposal shortly.
                </p>
              </div>
            ) : showApplyForm ? (
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
              <div className="text-center">
                <button
                  onClick={() => setShowApplyForm(true)}
                  className="btn-primary text-base px-10 py-3.5"
                >
                  Apply for this Job
                </button>
              </div>
            ) : (
              <p className="text-sm text-amber-700">
                Timeout period has expired. Only the client can claim a refund.
              </p>
            )}
          </div>
        )}

        {isClient && job.status === "in_progress" && (
          <div className="card mb-6">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-3">
              Escrow
            </h2>

            <button
              onClick={handleReleaseEscrow}
              disabled={releasingEscrow}
              className="btn-primary"
            >
              {releasingEscrow ? "Releasing..." : "Release Escrow"}
            </button>

            {releaseSuccess && (
              <p className="mt-3 text-emerald-400 text-sm">
                Escrow released successfully.
              </p>
            )}
          </div>
        )}

        {actionError && (
          <p className="mt-3 mb-6 text-red-400 text-sm">{actionError}</p>
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
                className="flex-1 btn-secondary py-2.5"
                disabled={raisingDispute}
              >
                Cancel
              </button>
              <button 
                onClick={handleRaiseDispute} 
                className="flex-1 btn-primary py-2.5 flex items-center justify-center gap-2"
                disabled={raisingDispute || !disputeReason || !disputeDescription}
              >
                {raisingDispute ? <Spinner /> : "Raise Dispute"}
              </button>
            </div>
            {actionError && <p className="mt-3 text-red-400 text-sm text-center">{actionError}</p>}
          </div>
        </div>
      )}
    </>
  );
}