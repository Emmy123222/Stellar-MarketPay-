/**
 * pages/jobs/[id].tsx
 * Single job detail page — view description, apply, manage as client, share, rate, and report.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
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
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import type { Application, Job } from "@/utils/types";

interface JobDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function JobDetail({ publicKey, onConnect }: JobDetailProps) {
  const router = useRouter();
  const { id } = router.query;

  const [job, setJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [releasingEscrow, setReleasingEscrow] = useState(false);
  const [releaseSuccess, setReleaseSuccess] = useState(false);
  const [releaseTxHash, setReleaseTxHash] = useState<string | null>(null);
  const [releaseSyncedWithBackend, setReleaseSyncedWithBackend] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [prefillData, setPrefillData] = useState<any>(null);

  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCategory, setReportCategory] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const isClient = Boolean(publicKey && job?.clientAddress === publicKey);
  const isFreelancer = Boolean(publicKey && job?.freelancerAddress === publicKey);
  const hasApplied = applications.some(
    (application) => application.freelancerAddress === publicKey
  );

  useEffect(() => {
    if (!id || !router.isReady) return;

    const { prefill } = router.query;

    if (typeof prefill === "string") {
      try {
        const decoded = JSON.parse(Buffer.from(prefill, "base64").toString("utf8"));
        setPrefillData(decoded);
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
    setReleaseTxHash(null);
    setReleaseSyncedWithBackend(false);

    try {
      const prepared = await buildReleaseEscrowTransaction(
        job.escrowContractId,
        job.id,
        publicKey
      );

      const { signedXDR, error: signError } = await signTransactionWithWallet(
        prepared.toXDR()
      );

      if (signError || !signedXDR) {
        setActionError(signError || "Signing was cancelled.");
        return;
      }

      const { hash } = await submitSignedSorobanTransaction(signedXDR);
      setReleaseTxHash(hash);

      try {
        await releaseEscrow(job.id, publicKey, hash);
        const refreshedJob = await fetchJob(id as string);
        setJob(refreshedJob);
        setReleaseSuccess(true);
        setReleaseSyncedWithBackend(true);
      } catch {
        setActionError(
          "Payment was released on-chain, but the backend status could not be updated."
        );
        setReleaseSuccess(true);
        setReleaseSyncedWithBackend(false);
      }
    } catch (error: unknown) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not complete the release. Please try again."
      );
    } finally {
      setReleasingEscrow(false);
    }
  };

  const handleSubmitReport = async () => {
    if (!job) return;

    if (!publicKey) {
      setReportError("Please connect your wallet before reporting this job.");
      return;
    }

    if (!reportCategory) {
      setReportError("Please select a report category.");
      return;
    }

    setReportLoading(true);
    setReportError(null);

    try {
      const response = await fetch(`/api/jobs/${job.id}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reporterAddress: publicKey,
          category: reportCategory,
          description: reportDescription,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Failed to submit report.");
      }

      setReportSuccess(true);
      setReportCategory("");
      setReportDescription("");
    } catch (error: unknown) {
      setReportError(
        error instanceof Error ? error.message : "Failed to submit report."
      );
    } finally {
      setReportLoading(false);
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
        <meta property="og:title" content={job.title} />
        <meta property="og:description" content={job.description.substring(0, 160)} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Stellar MarketPay" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={job.title} />
        <meta name="twitter:description" content={job.description.substring(0, 160)} />
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
                )}
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

          <div className="mt-4 flex justify-between items-center gap-3">
            <button
              onClick={() => setShowShareModal(true)}
              className="text-xs text-market-400 hover:text-market-300 underline"
            >
              Share job
            </button>

            <button
              onClick={() => {
                setShowReportModal(true);
                setReportSuccess(false);
                setReportError(null);
              }}
              className="text-xs text-red-400 hover:text-red-300 underline"
            >
              Report this job
            </button>
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
        </div>

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

                      <span
                        className={cx(
                          "text-xs px-2.5 py-1 rounded-full border",
                          application.status === "accepted" &&
                            "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                          application.status === "rejected" &&
                            "bg-red-500/10 text-red-400 border-red-500/20",
                          application.status === "pending" &&
                            "bg-market-500/10 text-market-400 border-market-500/20"
                        )}
                      >
                        {application.status}
                      </span>
                    </div>
                  </div>

                  <p className="text-amber-700/80 text-sm leading-relaxed mb-4">
                    {application.proposal}
                  </p>

                  {application.screeningAnswers &&
                    Object.keys(application.screeningAnswers).length > 0 && (
                      <div className="mt-4 pt-4 border-t border-market-500/10">
                        <h4 className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-3">
                          Screening Question Answers
                        </h4>

                        <div className="space-y-3">
                          {Object.entries(application.screeningAnswers).map(
                            ([question, answer], index) => (
                              <div key={index}>
                                <p className="text-xs text-amber-300 font-medium mb-1">
                                  {question}
                                </p>

                                <p className="text-sm text-amber-700/80 bg-market-500/5 p-2 rounded border border-market-500/10">
                                  {String(answer)}
                                </p>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                  {application.status === "pending" && job.status === "open" && (
                    <button
                      onClick={() => handleAcceptApplication(application.id)}
                      className="btn-secondary text-sm py-2 px-4 mt-4"
                    >
                      Accept Proposal
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!isClient && job.status === "open" && (
          <div className="mb-6">
            {!publicKey ? (
              <div>
                <p className="text-amber-800 text-sm mb-4 text-center">
                  Connect your wallet to apply for this job
                </p>
                <WalletConnect onConnect={onConnect} />
              </div>
            ) : hasApplied ? (
              <div className="card text-center py-8 border-market-500/20">
                <p className="text-market-400 font-medium mb-1">
                  Application submitted
                </p>
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
            )}
          </div>
        )}

        {isClient && job.status !== "completed" && job.freelancerAddress && (
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

            {releaseTxHash && (
              <p className="mt-2 text-amber-700 text-xs break-all">
                Transaction hash: {releaseTxHash}
              </p>
            )}

            {releaseSuccess && !releaseSyncedWithBackend && (
              <p className="mt-2 text-amber-400 text-xs">
                On-chain release succeeded, but backend sync failed.
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

      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-market-500/20 bg-ink-900 p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-amber-100">
                  Report this job
                </h2>
                <p className="text-xs text-amber-800 mt-1">
                  Help keep suspicious or fraudulent jobs off the platform.
                </p>
              </div>

              <button
                onClick={() => setShowReportModal(false)}
                className="text-amber-800 hover:text-amber-300"
                aria-label="Close report modal"
              >
                ✕
              </button>
            </div>

            {reportSuccess ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <p className="text-emerald-400 font-medium">
                  Thank you for your report.
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  The team will review this job listing.
                </p>

                <button
                  onClick={() => setShowReportModal(false)}
                  className="btn-primary w-full mt-4"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <label className="block text-sm text-amber-300 mb-2">
                  Report category
                </label>

                <select
                  value={reportCategory}
                  onChange={(event) => setReportCategory(event.target.value)}
                  className="w-full rounded-lg border border-market-500/20 bg-ink-800 px-3 py-2 text-sm text-amber-100 outline-none focus:border-market-400"
                >
                  <option value="">Select a category</option>
                  <option value="fraud">Fraud or scam</option>
                  <option value="suspicious">Suspicious listing</option>
                  <option value="spam">Spam</option>
                  <option value="inappropriate">Inappropriate content</option>
                  <option value="other">Other</option>
                </select>

                <label className="block text-sm text-amber-300 mt-4 mb-2">
                  Description optional
                </label>

                <textarea
                  value={reportDescription}
                  onChange={(event) => setReportDescription(event.target.value)}
                  rows={4}
                  placeholder="Add extra details..."
                  className="w-full rounded-lg border border-market-500/20 bg-ink-800 px-3 py-2 text-sm text-amber-100 outline-none focus:border-market-400"
                />

                {reportError && (
                  <p className="mt-3 text-sm text-red-400">{reportError}</p>
                )}

                <div className="mt-5 flex gap-3">
                  <button
                    onClick={() => setShowReportModal(false)}
                    className="btn-secondary flex-1"
                    disabled={reportLoading}
                  >
                    Cancel
                  </button>

                  <button
                    onClick={handleSubmitReport}
                    className="btn-primary flex-1"
                    disabled={reportLoading}
                  >
                    {reportLoading ? "Submitting..." : "Submit Report"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showShareModal && (
        <ShareJobModal job={job} onClose={() => setShowShareModal(false)} />
      )}
    </>
  );
}