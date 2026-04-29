import TimeTracker from "@/components/TimeTracker";
/**
 * pages/jobs/[id].tsx
 * Single job detail page — view description, apply, manage as client, and see related jobs.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import ApplicationForm from "@/components/ApplicationForm";
import RatingForm from "@/components/RatingForm";
import ProposalComparison from "@/components/ProposalComparison";
import ShareJobModal from "@/components/ShareJobModal";
import { fetchJob, fetchApplications, acceptApplication, releaseEscrow } from "@/lib/api";
import { formatXLM, formatDate, shortenAddress, statusLabel, statusClass } from "@/utils/format";
import {
  accountUrl,
  buildReleaseEscrowTransaction,
  submitSignedSorobanTransaction,
  USDC_ISSUER,
  USDC_SAC_ADDRESS,
  XLM_SAC_ADDRESS,
  subscribeToContractEvents,
} from "@/lib/stellar";
import { Asset, type Transaction } from "@stellar/stellar-sdk";
import { signTransactionWithWallet } from "@/lib/wallet";
import { formatDate, shortenAddress, statusClass, statusLabel, timeAgo } from "@/utils/format";
import type { Application, Job } from "@/utils/types";

interface JobDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

function formatBudget(amount: string, currency: string) {
  const parsed = Number.parseFloat(amount);
  if (Number.isNaN(parsed)) return `${amount} ${currency}`;
  return `${parsed.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })} ${currency}`;
}

function printFallback(value?: string | null) {
  return value && value.trim() ? value : "Not specified";
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
  const [releaseTxHash, setReleaseTxHash] = useState<string | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  useEffect(() => {
    if (!router.isReady || !jobId) return;

    if (prefill) {
      try {
        const decoded = JSON.parse(window.atob(prefill));
        setPrefillData(decoded);
      } catch {
        setPrefillData(null);
      }
    } else {
      setPrefillData(null);
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([fetchJob(jobId), fetchApplications(jobId)])
      .then(([nextJob, nextApplications]) => {
        if (cancelled) return;
        setJob(nextJob);
        setApplications(nextApplications);
      })
      .catch(() => {
        if (!cancelled) router.push("/jobs");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, prefill, router, router.isReady]);

  const isClient = Boolean(publicKey && job?.clientAddress === publicKey);
  const isFreelancer = Boolean(publicKey && job?.freelancerAddress === publicKey);
  const hasApplied = applications.some((application) => application.freelancerAddress === publicKey);

  const printableBudget = useMemo(() => {
    if (!job) return "";
    return formatBudget(job.budget, job.currency);
  }, [job]);

  const handleDownloadBrief = () => {
    if (typeof window === "undefined") return;
    window.print();
  };

  const refreshJobState = async () => {
    if (!jobId) return;
    const [nextJob, nextApplications] = await Promise.all([fetchJob(jobId), fetchApplications(jobId)]);
    setJob(nextJob);
    setApplications(nextApplications);
  };

  useEffect(() => {
    if (!job?.escrowContractId || !job?.id) return;

    setIsLiveSubscriptionActive(true);
    const unsubscribe = subscribeToContractEvents(job.escrowContractId, (event) => {
      if (event.jobId && event.jobId !== job.id) return;

      if (event.type === "released") {
        setJob((prev) => (prev ? { ...prev, status: "completed" } : prev));
      }
    });

    return () => {
      setIsLiveSubscriptionActive(false);
      unsubscribe();
    };
  }, [job?.escrowContractId, job?.id]);

  const handleAcceptApplication = async (applicationId: string) => {
    if (!publicKey || !jobId) return;

    setActionError(null);

    try {
      setActionError(null);
      await acceptApplication(applicationId, publicKey);
      await refreshJobState();
    } catch {
      setActionError("Failed to accept application.");
    }
  };

  const handleReleaseEscrow = async () => {
    if (!publicKey || !job || !id) return;

    if (!job.escrowContractId) {
      setActionError("This job does not have an escrow contract ID yet.");
      return;
    }

    setReleasingEscrow(true);
    setActionError(null);

    try {
      const prepared = await buildReleaseEscrowTransaction(job.escrowContractId, job.id, publicKey);
      const { signedXDR, error } = await signTransactionWithWallet(prepared.toXDR());

      if (error || !signedXDR) {
        setActionError(error || "Signing was cancelled.");
        return;
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
      await releaseEscrow(job.id, publicKey, hash);

      fetchActualFee(hash).then((actual) => {
        if (actual) {
          // eslint-disable-next-line no-console
          console.info(`[escrow] release_escrow ${job.id} actual fee ${actual.feeChargedXlm} XLM`);
        }
      }).catch(() => {});

      setReleaseTxHash(hash);
      setReleaseSuccess(true);
      await refreshJobState();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not release escrow.");
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
        <meta name="description" content={job.description.slice(0, 160)} />
        <meta property="og:title" content={job.title} />
        <meta property="og:description" content={job.description.slice(0, 160)} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`/jobs/${job.id}`} />
        <meta property="og:site_name" content="Stellar MarketPay" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={job.title} />
        <meta name="twitter:description" content={job.description.slice(0, 160)} />
      </Head>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
        <div className="no-print">
          <Link
            href="/jobs"
            className="inline-flex items-center gap-1.5 text-sm text-amber-800 hover:text-amber-400 transition-colors mb-6"
          >
            Back to Jobs
          </Link>

          <section className="card mb-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-3">
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
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={handleDownloadBrief} className="btn-secondary text-sm py-2.5 px-4">
                Download Brief
              </button>
              <button onClick={() => setShowShareModal(true)} className="btn-ghost text-sm">
                Share Job
              </button>
            </div>
          </section>

          <section className="card mb-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="label">Category</p>
                <p className="text-amber-100">{job.category}</p>
              </div>
              <div>
                <p className="label">Client Address</p>
                <p className="font-mono text-sm break-all text-amber-100">{job.clientAddress}</p>
              </div>
            </div>

            <div className="mt-6">
              <h2 className="font-display text-lg font-semibold text-amber-100 mb-3">Description</h2>
              <p className="text-amber-700/90 leading-relaxed whitespace-pre-wrap">{job.description}</p>
            </div>

            <div className="mt-6">
              <h2 className="font-display text-lg font-semibold text-amber-100 mb-3">Required Skills</h2>
              {job.skills.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {job.skills.map((skill) => (
                    <span
                      key={skill}
                      className="text-sm bg-market-500/8 text-market-400 border border-market-500/15 px-3 py-1 rounded-full"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-amber-800 text-sm">No specific skills were added for this brief.</p>
              )}
            </div>
          </section>

          {actionError && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {actionError}
            </div>
          )}

          {releaseSuccess && (
            <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
              Escrow released successfully.
              {releaseTxHash ? ` Transaction hash: ${releaseTxHash}` : ""}
            </div>
          )}

          {isClient && job.status === "in_progress" && (
            <div className="card mb-6">
              <h2 className="font-display text-lg font-semibold text-amber-100 mb-3">Client Actions</h2>
              <button
                onClick={handleReleaseEscrow}
                disabled={releasingEscrow}
                className="btn-primary text-sm py-2.5 px-5"
              >
                {releasingEscrow ? "Releasing Escrow..." : "Release Escrow"}
              </button>
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-bold text-amber-100">
                Applications ({applications.length})
              </h2>
              <div className="space-y-4">
                {applications.map((application) => (
                  <article key={application.id} className="card">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <a
                          href={accountUrl(application.freelancerAddress)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="address-tag hover:border-market-500/40 transition-colors"
                        >
                          {shortenAddress(application.freelancerAddress)}
                        </a>
                        <p className="text-xs text-amber-800 mt-2">
                          Submitted {timeAgo(application.createdAt)}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono text-market-400 font-semibold text-sm">
                          {formatBudget(application.bidAmount, application.currency)}
                        </span>
                        <span className="text-xs px-2.5 py-1 rounded-full border bg-market-500/10 text-market-400 border-market-500/20">
                          {application.status}
                        </span>
                      </div>
                    </div>

                    <p className="text-amber-700/80 text-sm leading-relaxed mt-4 whitespace-pre-wrap">
                      {application.proposal}
                    </p>

                    {application.screeningAnswers && Object.keys(application.screeningAnswers).length > 0 && (
                      <div className="mt-4 pt-4 border-t border-market-500/10">
                        <h3 className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-3">
                          Screening Answers
                        </h3>
                        <div className="space-y-3">
                          {Object.entries(application.screeningAnswers).map(([question, answer]) => (
                            <div key={question}>
                              <p className="text-xs text-amber-300 font-medium mb-1">{question}</p>
                              <p className="text-sm text-amber-700/80 bg-market-500/5 p-3 rounded-xl border border-market-500/10">
                                {answer}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
      </div>

      <div className="job-brief-print" aria-hidden="true">
        <div className="brief-page">
          <div className="brief-header">
            <p className="brief-kicker">Stellar MarketPay</p>
            <h1>{job.title}</h1>
            <p className="brief-subtitle">Scope of Work Brief</p>
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
            )}

          <div className="brief-grid">
            <div>
              <h2>Budget</h2>
              <p>{printableBudget}</p>
            </div>
            <div>
              <h2>Category</h2>
              <p>{printFallback(job.category)}</p>
            </div>
            <div>
              <h2>Deadline</h2>
              <p>{job.deadline ? formatDate(job.deadline) : "Not specified"}</p>
            </div>
            <div>
              <h2>Client Address</h2>
              <p className="brief-address">{printFallback(job.clientAddress)}</p>
            </div>
          </div>

          <section className="brief-section">
            <h2>Description</h2>
            <p className="brief-paragraph">{printFallback(job.description)}</p>
          </section>

          <section className="brief-section">
            <h2>Required Skills</h2>
            {job.skills.length > 0 ? (
              <ul className="brief-skills">
                {job.skills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            ) : (
              <p>No specific skills listed.</p>
            )}
          </section>
        </div>
      </div>

      {showShareModal && <ShareJobModal job={job} onClose={() => setShowShareModal(false)} />}

      <style jsx global>{`
        .job-brief-print {
          display: none;
        }

        @page {
          size: A4;
          margin: 12mm;
        }

        @media print {
          html,
          body {
            background: #ffffff !important;
          }

          body * {
            visibility: hidden;
          }

          .job-brief-print,
          .job-brief-print * {
            visibility: visible;
          }

          .job-brief-print {
            display: block !important;
            position: absolute;
            inset: 0;
            background: #ffffff;
            color: #111827;
          }

          .brief-page {
            width: 100%;
            min-height: calc(297mm - 24mm);
            padding: 0;
            font-family: "DM Sans", sans-serif;
            color: #111827;
          }

          .brief-header {
            border-bottom: 2px solid #d1d5db;
            padding-bottom: 12mm;
            margin-bottom: 10mm;
          }

          .brief-header h1 {
            font-family: "Playfair Display", serif;
            font-size: 24pt;
            line-height: 1.2;
            margin: 0;
          }

          .brief-kicker {
            font-size: 10pt;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #92400e;
            margin: 0 0 4mm;
          }

          .brief-subtitle {
            margin: 4mm 0 0;
            color: #4b5563;
            font-size: 11pt;
          }

          .brief-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8mm;
            margin-bottom: 10mm;
          }

          .brief-grid h2,
          .brief-section h2 {
            font-size: 10pt;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #6b7280;
            margin: 0 0 2mm;
          }

          .brief-grid p,
          .brief-section p,
          .brief-section li {
            font-size: 11pt;
            line-height: 1.6;
            margin: 0;
          }

          .brief-address {
            word-break: break-all;
          }

          .brief-section {
            margin-bottom: 10mm;
          }

          .brief-paragraph {
            white-space: pre-wrap;
          }

          .brief-skills {
            margin: 0;
            padding-left: 18px;
            columns: 2;
            column-gap: 10mm;
          }

          .brief-skills li {
            margin-bottom: 2mm;
          }
        }
      `}</style>
    </>
  );
}
