import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import ApplicationForm from "@/components/ApplicationForm";
import RatingForm from "@/components/RatingForm";
import ProposalComparison from "@/components/ProposalComparison";
import MessageThread from "@/components/MessageThread";
import { fetchJob, fetchApplications, acceptApplication, releaseEscrow } from "@/lib/api";
import { formatXLM, timeAgo, formatDate, shortenAddress, statusLabel, statusClass } from "@/utils/format";
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
  const [prefillData, setPrefillData] = useState<{ bidAmount?: string; message?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [releasingEscrow, setReleasingEscrow] = useState(false);
  const [releaseSuccess, setReleaseSuccess] = useState(false);
  const [releaseTxHash, setReleaseTxHash] = useState<string | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [selectedApplications, setSelectedApplications] = useState<Set<string>>(new Set());
  const [showComparison, setShowComparison] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [prefillData, setPrefillData] = useState<{ bidAmount?: string; message?: string } | null>(null);

  const isClient = publicKey && job?.clientAddress === publicKey;
  const isFreelancer = publicKey && job?.freelancerAddress === publicKey;
  const hasApplied = applications.some((application) => application.freelancerAddress === publicKey);

  useEffect(() => {
    if (!router.isReady || !jobId) return;

    const { prefill, ref } = router.query;
    if (typeof prefill === "string") {
      try {
        const decoded = JSON.parse(window.atob(prefill));
        setPrefillData(decoded);
      } catch {
        setPrefillData(null);
      }
    }

    if (typeof ref === "string") {
      trackReferralClick(id as string, ref).catch(console.error);
      localStorage.setItem(`referral_${id}`, ref);
    }

    Promise.all([fetchJob(id as string), fetchApplications(id as string)])
      .then(([jobData, applicationData]) => {
        setJob(jobData);
        setApplications(applicationData);
      })
      .catch(() => router.push("/jobs"))
      .finally(() => setLoading(false));
  }, [id, router, router.isReady]);

  useEffect(() => {
    if (!isClient || applications.length === 0) {
      setApplicantProfiles({});
      return;
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
      const [j, apps] = await Promise.all([fetchJob(id as string), fetchApplications(id as string)]);
      setJob(j); setApplications(apps);
      setSelectedApplications(new Set());
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
    setReleaseTxHash(null);

    try {
      const prepared = await buildReleaseEscrowTransaction(job.escrowContractId, job.id, publicKey);
      const { signedXDR, error } = await signTransactionWithWallet(prepared.toXDR());

      if (error || !signedXDR) {
        setActionError(error || "Signing was cancelled.");
        return;
      }

      // Pause for fee confirmation (Issue #222) before Freighter prompts.
      setPendingRelease({ transaction: prepared, fnName: "release_escrow" as any });
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not complete the release.");
      setReleasingEscrow(false);
    }
  };

  const completeReleaseEscrow = async (signedXDR: string) => {
    if (!publicKey || !job || !jobId) return;
    try {
      const { hash } = await submitSignedSorobanTransaction(signedXDR);
      await releaseEscrow(job.id, publicKey, hash);

      setReleaseTxHash(hash);
      setReleaseSuccess(true);
      await refreshJobState();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not release escrow.");
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

  // Issue #175 — Timeout refund handlers
  const handleTimeoutRefund = async () => {
    if (!publicKey || !job || !id) return;
    if (!job.escrowContractId) {
      setActionError("This job has no escrow contract ID.");
      return;
    }

    setTimeoutRefundLoading(true);
    setActionError(null);

    try {
      const prepared = await buildTimeoutRefundTransaction(
        job.escrowContractId,
        job.id,
        publicKey
      );
      setPendingTimeoutRefund(prepared);
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not prepare timeout refund.");
      setTimeoutRefundLoading(false);
    }
  };

  const completeTimeoutRefund = async (signedXDR: string) => {
    if (!publicKey || !job || !id) return;
    try {
      const { hash } = await submitSignedSorobanTransaction(signedXDR);

      try {
        await timeoutRefund(job.id, publicKey, hash);
        const refreshedJob = await fetchJob(id as string);
        setJob(refreshedJob);
        setTimeoutRefundSuccess(true);
      } catch {
        setActionError("Refund was processed on-chain, but the app could not update your job status.");
        setTimeoutRefundSuccess(true);
      }
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not complete the timeout refund.");
    } finally {
      setTimeoutRefundLoading(false);
      setPendingTimeoutRefund(null);
    }
  };

  const handleConfirmTimeoutRefundFee = async () => {
    if (!pendingTimeoutRefund) return;
    const transaction = pendingTimeoutRefund;
    setPendingTimeoutRefund(null);

    const { signedXDR, error: signError } = await signTransactionWithWallet(transaction.toXDR());
    if (signError || !signedXDR) {
      setActionError(signError || "Signing was cancelled.");
      setTimeoutRefundLoading(false);
      return;
    }
    await completeTimeoutRefund(signedXDR);
  };

  const handleCancelTimeoutRefundFee = () => {
    setPendingTimeoutRefund(null);
    setTimeoutRefundLoading(false);
    setActionError("Cancelled before signing.");
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
              <a
                href={accountUrl(job.clientAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-3 text-sm text-amber-700 hover:text-market-400 transition-colors"
              >
                Client: {shortenAddress(job.clientAddress)} ↗
              </a>
              
              <div className="mt-4">
                <button 
                  onClick={() => {
                    if (!publicKey) {
                      setActionError("Please connect your wallet to refer others.");
                      return;
                    }
                    const url = `${window.location.origin}/jobs/${job.id}?ref=${publicKey}`;
                    navigator.clipboard.writeText(url);
                    alert("Referral link copied to clipboard: " + url);
                  }}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-market-400 hover:text-market-300 transition-colors bg-market-500/10 px-3 py-1.5 rounded-lg border border-market-500/20"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 100 2.684 3 3 0 000-2.684z" />
                  </svg>
                  Refer a Freelancer
                </button>
              </div>
            </div>
          </section>

          {actionError && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {actionError}
            </div>
          )}

       {/* ── Message Thread (only for in-progress jobs, visible to client & freelancer) ── */}
       {job.status === "in_progress" && publicKey && job.freelancerAddress && (
         (job.clientAddress === publicKey || job.freelancerAddress === publicKey) && (
           <div className="mb-6">
             <MessageThread
               jobId={job.id}
               currentUserAddress={publicKey}
               otherUserAddress={job.clientAddress === publicKey ? job.freelancerAddress! : job.clientAddress}
             />
           </div>
         )
       )}

      {/* Applications (client view) */}
      {isClient && applications.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-bold text-amber-100">
              Applications ({applications.length})
            </h2>
            <div className="flex items-center gap-4">
              {selectedApplications.size > 0 && (
                <button
                  onClick={() => setShowComparison(true)}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  Compare ({selectedApplications.size})
                </button>
              )}
              <div className="hidden sm:flex items-center gap-3 text-[10px] text-amber-800 font-medium uppercase tracking-wider">
                <span className="flex items-center gap-1"><kbd className="bg-ink-900 px-1.5 py-0.5 rounded border border-market-500/20 text-market-400">↑↓</kbd> Navigate</span>
                <span className="flex items-center gap-1"><kbd className="bg-ink-900 px-1.5 py-0.5 rounded border border-market-500/20 text-market-400">Enter</kbd> Accept</span>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {applications.map((app) => {
              const profile = applicantProfiles[app.freelancerAddress];
              const availability = profile?.availability;

              return (
                <div 
                  key={app.id} 
                  className="card focus-visible:ring-2 focus-visible:ring-market-400 focus:outline-none transition-all"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
                    } else if (e.key === "Enter" && e.target === e.currentTarget) {
                      if (app.status === "pending" && job.status === "open") {
                        handleAcceptApplication(app.id);
                      }
                    }
                  }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                    <div className="flex items-start gap-4">
                      <input
                        type="checkbox"
                        checked={selectedApplications.has(app.id)}
                        onChange={() => handleToggleSelection(app.id)}
                        disabled={
                          !selectedApplications.has(app.id) && selectedApplications.size >= 3
                        }
                        className="w-4 h-4 mt-1 rounded border-market-500/30 bg-market-500/10 text-market-400 focus:ring-market-500/50 cursor-pointer"
                      />
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <a href={accountUrl(app.freelancerAddress)} target="_blank" rel="noopener noreferrer"
                            className="address-tag hover:border-market-500/40 transition-colors">
                            {shortenAddress(app.freelancerAddress)} ↗
                          </a>
                          {profile?.tier && <FreelancerTierBadge tier={profile.tier} className="text-[10px] px-2 py-0" />}
                        </div>
                        {availability && (
                          <div className="flex items-center gap-2">
                            <span className={clsx("text-[10px] px-1.5 py-0.5 rounded-full border", getAvailabilityBadgeClass(availability.status))}>
                              {availabilityStatusLabel(availability.status)}
                            </span>
                            <span className="text-[10px] text-amber-800">
                              {availabilitySummary(availability)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <span className="font-mono text-market-400 font-semibold text-sm">{formatXLM(app.bidAmount)}</span>
                      <span className={clsx("text-xs px-2.5 py-1 rounded-full border",
                        app.status === "accepted" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                        app.status === "rejected" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                        "bg-market-500/10 text-market-400 border-market-500/20"
                      )}>{app.status}</span>
                    </div>
                  </div>
                  
                  <p className="text-amber-700/80 text-sm leading-relaxed mb-4 whitespace-pre-wrap">{app.proposal}</p>
                  
                  {/* Screening Answers */}
                  {app.screeningAnswers && Object.keys(app.screeningAnswers).length > 0 && (
                    <div className="mt-4 pt-4 border-t border-market-500/10">
                      <h4 className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-3">Screening Question Answers</h4>
                      <div className="space-y-3">
                        {Object.entries(app.screeningAnswers).map(([question, answer], index) => (
                          <div key={index}>
                            <p className="text-xs text-amber-300 font-medium mb-1">{question}</p>
                            <p className="text-sm text-amber-700/80 bg-market-500/5 p-2 rounded border border-market-500/10">{answer}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {app.status === "pending" && job.status === "open" && (
                    <button onClick={() => handleAcceptApplication(app.id)} className="btn-secondary text-sm py-2 px-4 mt-4">
                      Accept Proposal
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Proposal Comparison Modal */}
      {showComparison && (
        <ProposalComparison
          applications={selectedApps}
          job={job}
          publicKey={publicKey}
          onClose={() => setShowComparison(false)}
          onAccept={handleAcceptApplication}
        />
      )}

      {/* Apply (freelancer view) */}
      {!isClient && job.status === "open" && (
        <div className="mb-6">
          {!publicKey ? (
            <div>
              <p className="text-amber-800 text-sm mb-4 text-center">Connect your wallet to apply for this job</p>
              <WalletConnect onConnect={onConnect} />
            </div>
          ) : hasApplied ? (
            <div className="card text-center py-8 border-market-500/20">
              <p className="text-market-400 font-medium mb-1">✅ Application submitted</p>
              <p className="text-amber-800 text-sm">The client will review your proposal shortly.</p>
            </div>
          ) : showApplyForm ? (
            <ApplicationForm
              job={job}
              publicKey={publicKey}
              prefillData={prefillData}
              onSuccess={() => { setShowApplyForm(false); setApplications((prev) => [...prev, {} as Application]); }}
            />
          ) : (
            <div className="text-center">
              <button onClick={() => setShowApplyForm(true)} className="btn-primary text-base px-10 py-3.5">
                Apply for this Job
              </button>
            </div>
          )}

          {actionError && <p className="mt-3 text-red-400 text-sm">{actionError}</p>}
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

      {/* Rating section (job completed) */}
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

                    <div class="footer">
                      <p>This is an automated invoice generated by Stellar MarketPay</p>
                      <p>For support, visit https://stellar-marketpay.app</p>
                    </div>
                  </div>
                </body>
                </html>
              `;

              // Open print dialog
              const printWindow = window.open('', '', 'height=600,width=800');
              if (printWindow) {
                printWindow.document.write(invoiceHTML);
                printWindow.document.close();
                printWindow.print();
              }
            }}
            className="btn-primary py-2 px-4 text-sm"
          >
            Generate Invoice & Print
          </button>
        </div>
      )}
    </div>

      {/* Share Modal */}
      {showShareModal && job && (
        <ShareJobModal
          job={job}
          onClose={() => setShowShareModal(false)}
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
      </div>

      <div className="job-brief-print" aria-hidden="true">
        <div className="brief-page">
          <div className="brief-header">
            <p className="brief-kicker">Stellar MarketPay</p>
            <h1>{job.title}</h1>
            <p className="brief-subtitle">Scope of Work Brief</p>
          </div>

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