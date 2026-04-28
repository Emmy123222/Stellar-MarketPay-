/**
 * pages/jobs/[id].tsx
 * Single job detail page — view description, apply, manage as client, and see related jobs.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import clsx from "clsx";

import ApplicationForm from "@/components/ApplicationForm";
import WalletConnect from "@/components/WalletConnect";
import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";
import {
  fetchJob,
  fetchApplications,
  acceptApplication,
  releaseEscrow,
  scoreProposals,
  fetchProfile,
  inviteFreelancer,
} from "@/lib/api";
import { formatXLM, timeAgo, formatDate, shortenAddress, statusLabel, statusClass, copyToClipboard } from "@/utils/format";
import {
  accountUrl,
  buildReleaseEscrowTransaction,
  buildReleaseWithConversionTransaction,
  getPathPaymentPrice,
  submitSignedSorobanTransaction,
  USDC_ISSUER,
  USDC_SAC_ADDRESS,
  XLM_SAC_ADDRESS,
} from "@/lib/stellar";
import { Asset, type Transaction } from "@stellar/stellar-sdk";
import { signTransactionWithWallet } from "@/lib/wallet";
import { fetchActualFee } from "@/lib/sorobanFees";
import FeeEstimationModal from "@/components/FeeEstimationModal";
import type { Application, Job } from "@/utils/types";

interface JobDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function availabilityStatusLabel(status?: AvailabilityStatus | null) {
  if (status === "available") return "Available";
  if (status === "busy") return "Busy";
  if (status === "unavailable") return "Unavailable";
  return "Not set";
}

function availabilitySummary(availability?: UserProfile["availability"]) {
  if (!availability) return "";
  return availability.note || availability.hoursPerWeek ? `${availability.hoursPerWeek || 0} hrs/week` : "";
}

export default function JobDetail({ publicKey, onConnect }: JobDetailProps) {
  const router = useRouter();
  const { id } = router.query;

  const [job, setJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicantProfiles, setApplicantProfiles] = useState<Record<string, UserProfile>>({});
  const [relatedJobs, setRelatedJobs] = useState<Job[]>([]);

  const [loading, setLoading] = useState(true);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [releasingEscrow, setReleasingEscrow] = useState(false);
  const [releaseSuccess, setReleaseSuccess] = useState(false);
  const [releaseTxHash, setReleaseTxHash] = useState<string | null>(null);
  const [releaseSyncedWithBackend, setReleaseSyncedWithBackend] = useState(false);
  const [pendingRelease, setPendingRelease] = useState<{
    transaction: Transaction;
    fnName: "release_escrow" | "release_with_conversion";
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [prefillData, setPrefillData] = useState<any>(null);

  const [releaseCurrency, setReleaseCurrency] = useState<"XLM" | "USDC">("XLM");
  const [estimatedOutput, setEstimatedOutput] = useState<string | null>(null);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [inviteAddress, setInviteAddress] = useState("");

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

  const handleCopyJobLink = async () => {
    const ok = await copyToClipboard(window.location.href);
    if (!ok) return;
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const isClient = Boolean(publicKey && job?.clientAddress === publicKey);
  const isFreelancer = Boolean(publicKey && job?.freelancerAddress === publicKey);
  const hasApplied = applications.some((application) => application.freelancerAddress === publicKey);

  useEffect(() => {
    if (job?.currency) setReleaseCurrency(job.currency as "XLM" | "USDC");
  }, [job?.currency]);

  useEffect(() => {
    if (!job || !releaseCurrency || releaseCurrency === job.currency) {
      setEstimatedOutput(null);
      return;
    }

    let cancelled = false;

    const fetchPrice = async () => {
      setFetchingPrice(true);

      try {
        const sourceAsset =
          job.currency === "XLM" ? Asset.native() : new Asset("USDC", USDC_ISSUER);
        const destAsset =
          releaseCurrency === "XLM" ? Asset.native() : new Asset("USDC", USDC_ISSUER);

        const res = await getPathPaymentPrice(sourceAsset, job.budget, destAsset);

        if (!cancelled && res) {
          setEstimatedOutput(res.amount);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setFetchingPrice(false);
      }
    };

    fetchPrice();

    return () => {
      cancelled = true;
    };
  }, [releaseCurrency, job]);

  useEffect(() => {
    if (!id) return;

    const { prefill } = router.query;
    if (typeof prefill === "string") {
      try {
        const decoded = JSON.parse(Buffer.from(prefill, "base64").toString("utf8"));
        setPrefillData(decoded);
      } catch {
        setPrefillData(null);
      }
    }

    setLoading(true);

    Promise.all([fetchJob(id as string), fetchApplications(id as string)])
      .then(([jobData, applicationData]) => {
        setJob(jobData);
        setApplications(applicationData);
      })
    Promise.all([
      fetchJob(id as string, publicKey || undefined),
      fetchApplications(id as string),
    ])
      .then(([j, apps]) => { setJob(j); setApplications(apps); })
      .catch(() => router.push("/jobs"))
      .finally(() => setLoading(false));
  }, [id, router.isReady]);

  useEffect(() => {
    if (!job) return;

    let cancelled = false;

    fetchJobs()
      .then((jobs: Job[]) => {
        if (cancelled) return;

        const similarJobs = jobs
          .filter((item) => item.id !== job.id)
          .filter((item) => item.status === "open")
          .filter((item) => item.category === job.category)
          .slice(0, 3);

        setRelatedJobs(similarJobs);
      })
      .catch(() => setRelatedJobs([]));

    return () => {
      cancelled = true;
    };
  }, [job]);


  useEffect(() => {
    const handleApplyShortcut = () => {
      if (job?.status !== "open") return;
      if (!publicKey) return;
      if (isClient) return;
      if (hasApplied) return;
      setShowApplyForm(true);
    };

    window.addEventListener("shortcut-apply-job", handleApplyShortcut);
    return () => window.removeEventListener("shortcut-apply-job", handleApplyShortcut);
  }, [job?.status, publicKey, isClient, hasApplied]);

  useEffect(() => {
    if (!isClient || applications.length === 0) {
      setApplicantProfiles({});
      return;
    }

    let cancelled = false;

    async function loadProfiles() {
      const profileEntries = await Promise.all(
        applications.map(async (application) => {
          try {
            const profile = await fetchProfile(application.freelancerAddress);
            return [application.freelancerAddress, profile] as const;
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;

      const nextProfiles = profileEntries.reduce<Record<string, UserProfile>>((acc, entry) => {
        if (entry) acc[entry[0]] = entry[1];
        return acc;
      }, {});

      setApplicantProfiles(nextProfiles);
    }

    loadProfiles();

    return () => {
      cancelled = true;
    };
  }, [applications, isClient]);

  const handleAcceptApplication = async (applicationId: string) => {
    if (!publicKey || !id) return;

    try {
      await acceptApplication(applicationId, publicKey);
      const [jobData, applicationData] = await Promise.all([
        fetchJob(id as string),
        fetchApplications(id as string),
      ]);
      setJob(jobData);
      setApplications(applicationData);
    } catch {
      setActionError("Failed to accept application.");
    }
  };

  const handleReleaseEscrow = async () => {
    if (!publicKey || !job || !id) return;

    if (!job.escrowContractId) {
      setActionError("This job has no escrow contract ID.");
      return;
    }

    setReleasingEscrow(true);
    setActionError(null);
    setReleaseTxHash(null);
    setReleaseSyncedWithBackend(false);

    try {
      let prepared;
      let fnName: "release_escrow" | "release_with_conversion";

      if (releaseCurrency !== job.currency && estimatedOutput) {
        const targetTokenAddress =
          releaseCurrency === "XLM" ? XLM_SAC_ADDRESS : USDC_SAC_ADDRESS;

        const minAmountOut = BigInt(
          Math.round(
            parseFloat(estimatedOutput) *
              0.99 *
              (releaseCurrency === "XLM" ? 10_000_000 : 1_000_000)
          )
        );

        prepared = await buildReleaseWithConversionTransaction(
          job.escrowContractId,
          job.id,
          publicKey,
          targetTokenAddress,
          minAmountOut
        );
        fnName = "release_with_conversion";
      } else {
        prepared = await buildReleaseEscrowTransaction(
          job.escrowContractId,
          job.id,
          publicKey
        );
        fnName = "release_escrow";
      }

      // Pause for fee confirmation (Issue #222) before Freighter prompts.
      setPendingRelease({ transaction: prepared, fnName });
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not complete the release.");
      setReleasingEscrow(false);
    }
  };

  const completeReleaseEscrow = async (signedXDR: string) => {
    if (!publicKey || !job || !id) return;
    try {
      const { hash } = await submitSignedSorobanTransaction(signedXDR);
      setReleaseTxHash(hash);

      fetchActualFee(hash).then((actual) => {
        if (actual) {
          // eslint-disable-next-line no-console
          console.info(`[escrow] release_escrow ${job.id} actual fee ${actual.feeChargedXlm} XLM`);
        }
      }).catch(() => {});

      try {
        await releaseEscrow(job.id, publicKey, hash, releaseCurrency);
        const refreshedJob = await fetchJob(id as string);
        setJob(refreshedJob);
        setReleaseSuccess(true);
        setReleaseSyncedWithBackend(true);
      } catch {
        setActionError("Payment was released on-chain, but the app could not update your job status.");
        setReleaseSuccess(true);
        setReleaseSyncedWithBackend(false);
      }
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not complete the release.");
    } finally {
      setReleasingEscrow(false);
    }
  };

  const handleConfirmReleaseFee = async () => {
    if (!pendingRelease) return;
    const { transaction } = pendingRelease;
    setPendingRelease(null);

    const { signedXDR, error: signError } = await signTransactionWithWallet(transaction.toXDR());
    if (signError || !signedXDR) {
      setActionError(signError || "Signing was cancelled.");
      setReleasingEscrow(false);
      return;
    }
    await completeReleaseEscrow(signedXDR);
  };

  const handleCancelReleaseFee = () => {
    setPendingRelease(null);
    setReleasingEscrow(false);
    setActionError("Cancelled before signing.");
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
        <meta
          property="og:description"
          content={job.description.substring(0, 160)}
        />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Stellar MarketPay" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={job.title} />
        <meta
          name="twitter:description"
          content={job.description.substring(0, 160)}
        />
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
                <span className={statusClass(job.status)}>
                  {statusLabel(job.status)}
                </span>

                <span className="text-xs text-amber-800 bg-ink-700 px-2.5 py-1 rounded-full border border-market-500/10">
                  {job.category}
                </span>

                {job.boosted && new Date(job.boostedUntil || "") > new Date() && (
                  <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                    Featured
                  </span>
                )}

                <button
                  type="button"
                  onClick={handleCopyJobLink}
                  aria-label="Copy job link"
                  className="btn-ghost inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                >
                  {linkCopied ? "Copied!" : "Copy link"}
                </button>
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
          )}
        </div>

        {isClient && applications.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-bold text-amber-100">
                Applications ({applications.length})
              </h2>
              <div className="hidden sm:flex items-center gap-3 text-[10px] text-amber-800 font-medium uppercase tracking-wider">
                <span className="flex items-center gap-1"><kbd className="bg-ink-900 px-1.5 py-0.5 rounded border border-market-500/20 text-market-400">↑↓</kbd> Navigate</span>
                <span className="flex items-center gap-1"><kbd className="bg-ink-900 px-1.5 py-0.5 rounded border border-market-500/20 text-market-400">Enter</kbd> Accept</span>
              </div>
            </div>


            <div className="space-y-4">
              {applications.map((app) => {
                const applicantProfile = applicantProfiles[app.freelancerAddress];
                const availability = applicantProfile?.availability;

                return (
                  <div key={app.id} className="card">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div>
                        <a
                          href={accountUrl(app.freelancerAddress)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="address-tag hover:border-market-500/40 transition-colors"
                        >
                          {shortenAddress(app.freelancerAddress)} ↗
                        </a>

                        <div className="mt-3">
                          <span
                            className={clsx(
                              "text-xs px-2.5 py-1 rounded-full border",
                              getAvailabilityBadgeClass(availability?.status)
                            )}
                          >
                            {availabilityStatusLabel(availability?.status)}
                          </span>

                          <p className="text-xs text-amber-800 mt-2">
                            {availabilitySummary(availability) || "Availability has not been set yet."}
                          </p>
                        </div>
                        <p className="text-xs text-amber-800 mt-2">
                          Applied {timeAgo(app.createdAt)}
                        </p>
                        {availability && (
                          <div className="mt-3">
                            <span
                              className={clsx(
                                "text-xs px-2.5 py-1 rounded-full border",
                                getAvailabilityBadgeClass(availability?.status)
                              )}
                            >
                              {availabilityStatusLabel(availability?.status)}
                            </span>
                            <p className="text-xs text-amber-800 mt-2">
                              {availabilitySummary(availability) || "Availability has not been set yet."}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex-shrink-0 flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
                        <span className="font-mono text-market-400 font-semibold text-sm">
                          {formatXLM(app.bidAmount)}
                        </span>

                        <span
                          className={clsx(
                            "text-xs px-2.5 py-1 rounded-full border",
                            app.status === "accepted"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : app.status === "rejected"
                                ? "bg-red-500/10 text-red-400 border-red-500/20"
                                : "bg-market-500/10 text-market-400 border-market-500/20"
                          )}
                        >
                          {app.status}
                        </span>
                      </div>
                    </div>

                    <p className="text-amber-700/80 text-sm leading-relaxed mb-4">
                      {app.proposal}
                    </p>

                    {app.status === "pending" && job.status === "open" && (
                      <div className="flex gap-3 mt-4 pt-4 border-t border-market-500/10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
                        <button
                          onClick={() => handleAcceptApplication(app.id)}
                          className="btn-primary text-sm py-2 px-4"
                        >
                          Accept
                        </button>
                        <button className="btn-ghost text-sm py-2 px-4 text-red-400/70 hover:text-red-400 hover:bg-red-500/8">
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isClient && job.visibility === "invite_only" && (
          <div className="card mb-6">
            <h3 className="font-display text-lg font-semibold text-amber-100 mb-3">Invite Freelancer</h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={inviteAddress}
                onChange={(e) => setInviteAddress(e.target.value)}
                className="input-field flex-1"
                placeholder="Freelancer public key"
              />
              <button
                className="btn-primary text-sm"
                onClick={async () => {
                  if (!inviteAddress.trim()) return;
                  await inviteFreelancer(job.id, inviteAddress.trim());
                  setInviteAddress("");
                  setActionError("Invitation sent");
                }}
              >
                Send Invite
              </button>
            </div>
          </div>
        )}

        {showComparison && (
          <ProposalComparison
            applications={selectedApps}
            job={job}
            publicKey={publicKey}
            onClose={() => setShowComparison(false)}
            onAccept={handleAcceptApplication}
          />
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

            {actionError && (
              <p className="mt-3 text-red-400 text-sm">{actionError}</p>
            )}
          </div>
        )}

        {isClient && job.status === "in_progress" && (
          <div className="card mb-6">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-3">Escrow Payment</h2>

            {releaseSuccess ? (
              <div>
                <p className="text-market-400 font-medium">Payment released successfully.</p>
                {releaseTxHash && (
                  <p className="text-sm text-amber-700 mt-2 break-all">Transaction: {releaseTxHash}</p>
                )}
                {!releaseSyncedWithBackend && (
                  <p className="text-sm text-red-400 mt-2">
                    Backend sync failed. Save the transaction hash.
                  </p>
                )}
              </div>
            ) : (
              <button
                onClick={handleReleaseEscrow}
                disabled={releasingEscrow}
                className="btn-primary text-sm py-2 px-4 disabled:opacity-60"
              >
                {releasingEscrow ? "Releasing..." : "Release Escrow"}
              </button>
            )}
          </div>
        )}

        {actionError && <p className="mb-6 text-red-400 text-sm">{actionError}</p>}

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

        <div className="card mt-8">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="font-display text-xl font-bold text-amber-100">Similar Jobs</h2>
              <p className="text-sm text-amber-800 mt-1">More open jobs in {job.category}</p>
            </div>

            <Link
              href={`/jobs?category=${encodeURIComponent(job.category)}`}
              className="text-sm text-market-400 hover:text-market-300 transition-colors"
            >
              Browse all {job.category} jobs →
            </Link>
          </div>

          {relatedJobs.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {relatedJobs.map((relatedJob) => (
                <Link
                  key={relatedJob.id}
                  href={`/jobs/${relatedJob.id}`}
                  className="block rounded-xl border border-market-500/10 bg-ink-800/60 p-4 hover:border-market-500/30 transition-colors"
                >
                  <h3 className="font-display font-semibold text-amber-100 line-clamp-2 mb-3">
                    {relatedJob.title}
                  </h3>

                  <div className="space-y-2 text-sm">
                    <p className="text-amber-700">
                      Budget:{" "}
                      <span className="font-mono text-market-400">
                        {formatXLM(relatedJob.budget)} {relatedJob.currency}
                      </span>
                    </p>

                    <p className="text-amber-700">
                      Applicants:{" "}
                      <span className="text-amber-300">
                        {relatedJob.applicationsCount ?? relatedJob.applicantCount ?? 0}
                      </span>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-market-500/10 bg-market-500/5 p-5 text-center">
              <p className="text-sm text-amber-700">No other open jobs found in this category.</p>
            </div>
          )}
        </div>
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

      {showShareModal && job && (
        <ShareJobModal job={job} onClose={() => setShowShareModal(false)} />
      )}

      {pendingRelease && publicKey && (
        <FeeEstimationModal
          transaction={pendingRelease.transaction}
          functionName={pendingRelease.fnName}
          payerPublicKey={publicKey}
          onConfirm={handleConfirmReleaseFee}
          onCancel={handleCancelReleaseFee}
        />
      )}
    </>
  );
}