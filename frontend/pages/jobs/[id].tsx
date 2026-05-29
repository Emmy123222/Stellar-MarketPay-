import TimeTracker from "@/components/TimeTracker";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import ApplicationForm from "@/components/ApplicationForm";
import WalletConnect from "@/components/WalletConnect";
import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";
import RealtimeBidComparison from "@/components/RealtimeBidComparison";
import {
  fetchJob,
  fetchApplications,
  acceptApplication,
  releaseEscrow,
} from "@/lib/api";
import {
  formatXLM,
  formatDate,
  shortenAddress,
  statusLabel,
  statusClass,
  timeAgo,
} from "@/utils/format";
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
  const [prefillData, setPrefillData] = useState<{
    bidAmount?: string;
    message?: string;
  } | null>(null);

  const isClient = Boolean(publicKey && job?.clientAddress === publicKey);
  const isFreelancer = Boolean(publicKey && job?.freelancerAddress === publicKey);
  const hasApplied = applications.some(
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

    Promise.all([fetchJob(jobId), fetchApplications(jobId)])
      .then(([loadedJob, loadedApplications]) => {
        setJob(loadedJob);
        setApplications(loadedApplications);
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
              </div>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 leading-snug">
                {job.title}
              </h1>

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-amber-700">
                <span>Posted {timeAgo(job.createdAt)}</span>
                <span>
                  {applications.length} application
                  {applications.length === 1 ? "" : "s"}
                </span>
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

          <div className="mt-5">
            <button
              onClick={() => setShowShareModal(true)}
              className="text-xs text-market-400 hover:text-market-300 underline"
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
                  className="btn-primary text-base px-10 py-3.5"
                >
                  Apply for this Job
                </button>
              </div>
            )}
          </>
        )}

        {isClient && job.status === "in_progress" && (
          <div className="card mb-6">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-3">Escrow</h2>
            <button
              onClick={handleReleaseEscrow}
              disabled={releasingEscrow}
              className="btn-primary"
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
    </>
  );
}
