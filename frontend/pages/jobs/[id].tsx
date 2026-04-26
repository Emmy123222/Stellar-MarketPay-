import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import ApplicationForm from "@/components/ApplicationForm";
import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";
import { fetchJob, fetchApplications, acceptApplication, releaseEscrow, raiseDispute, resolveDispute } from "@/lib/api";
import { formatXLM, timeAgo, formatDate, shortenAddress, statusLabel, statusClass } from "@/utils/format";
import {
  accountUrl,
  buildReleaseEscrowTransaction,
  buildReleaseWithConversionTransaction,
  buildTimeoutRefundTransaction,
  getEscrowTimeoutLedger,
  getCurrentLedgerSequence,
  getPathPaymentPrice,
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
  const [prefillData, setPrefillData] = useState<any>(null);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [raisingDispute, setRaisingDispute] = useState(false);
  const [resolvingDispute, setResolvingDispute] = useState(false);

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
  const [isLiveSubscriptionActive, setIsLiveSubscriptionActive] = useState(false);

  // Issue #175 — Escrow timeout state
  const [timeoutLedger, setTimeoutLedger] = useState<number | null>(null);
  const [currentLedger, setCurrentLedger] = useState<number>(0);
  const [timeoutCountdown, setTimeoutCountdown] = useState<string | null>(null);
  const [timeoutRefundLoading, setTimeoutRefundLoading] = useState(false);
  const [timeoutRefundSuccess, setTimeoutRefundSuccess] = useState(false);
  const [pendingTimeoutRefund, setPendingTimeoutRefund] = useState<Transaction | null>(null);

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
  }, [id, router.isReady]);

  useEffect(() => {
    if (!job?.escrowContractId || !job?.id) return;

    let cancelled = false;

    async function loadTimeout() {
      try {
        const [timeout, current] = await Promise.all([
          getEscrowTimeoutLedger(job.escrowContractId!, job.id),
          getCurrentLedgerSequence(),
        ]);
        if (cancelled) return;
        setTimeoutLedger(timeout);
        setCurrentLedger(current);
      } catch {
        // Silently ignore — timeout UI is optional enhancement
      }
    }

    loadTimeout();

    // Refresh ledger every 30s for countdown accuracy
    const interval = setInterval(() => {
      getCurrentLedgerSequence().then((seq) => {
        if (!cancelled) setCurrentLedger(seq);
      }).catch(() => {});
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [job?.escrowContractId, job?.id]);

  // Issue #175 — Countdown timer effect
  useEffect(() => {
    if (!timeoutLedger || !currentLedger || timeoutLedger <= currentLedger) {
      setTimeoutCountdown(null);
      return;
    }

    const ledgersRemaining = timeoutLedger - currentLedger;
    // Approximate 5 seconds per ledger
    const secondsRemaining = ledgersRemaining * 5;

    const days = Math.floor(secondsRemaining / 86400);
    const hours = Math.floor((secondsRemaining % 86400) / 3600);
    const minutes = Math.floor((secondsRemaining % 3600) / 60);

    if (days > 0) {
      setTimeoutCountdown(`${days}d ${hours}h ${minutes}m`);
    } else if (hours > 0) {
      setTimeoutCountdown(`${hours}h ${minutes}m`);
    } else {
      setTimeoutCountdown(`${minutes}m`);
    }
  }, [timeoutLedger, currentLedger]);

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

        {/* Back */}
        <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-amber-800 hover:text-amber-400 transition-colors mb-6">
          ← Back to Jobs
        </Link>

        {/* Dispute Banner */}
        {job.status === "disputed" && (
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 mb-6 flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 text-indigo-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-indigo-100 uppercase tracking-wider mb-1">Under Dispute</h3>
              <p className="text-xs text-indigo-400/80 leading-relaxed">
                This job has been flagged for admin review. Escrow release is currently blocked.
                <br />
                <span className="font-semibold mt-1 inline-block">Reason: {job.disputeReason}</span>
              </p>
              {publicKey === process.env.NEXT_PUBLIC_ADMIN_ADDRESS && (
                <button 
                  onClick={async () => {
                    setResolvingDispute(true);
                    try {
                      await resolveDispute(job.id);
                      setJob(await fetchJob(job.id));
                    } catch (e) {
                      setActionError("Failed to resolve dispute");
                    } finally {
                      setResolvingDispute(false);
                    }
                  }}
                  disabled={resolvingDispute}
                  className="mt-3 btn-secondary py-1.5 px-3 text-xs flex items-center gap-2"
                >
                  {resolvingDispute ? <Spinner /> : "Resolve Dispute (Admin)"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Job header */}
        <div className="card mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-5">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className={statusClass(job.status)}>{statusLabel(job.status)}</span>
                <span className="text-xs text-amber-800 bg-ink-700 px-2.5 py-1 rounded-full border border-market-500/10">{job.category}</span>
                {job.boosted && new Date(job.boostedUntil || '') > new Date() && (
                  <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">Featured</span>
                )}
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 leading-snug">{job.title}</h1>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-xs text-amber-800 mb-1">Budget</p>
              <p className="font-mono font-bold text-2xl text-market-400">{formatXLM(job.budget)} {job.currency}</p>
          {job.deadline && <span>Deadline: {formatDate(job.deadline)}</span>}
          <a href={accountUrl(job.clientAddress)} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-market-400 transition-colors">
            Client: {shortenAddress(job.clientAddress)} ↗
          </a>
        </div>

        {/* Description */}
        <div className="prose prose-sm max-w-none">
          <h3 className="font-display text-base font-semibold text-amber-300 mb-3">Description</h3>
          <p className="text-amber-700/90 leading-relaxed whitespace-pre-wrap font-body text-sm">{job.description}</p>
        </div>

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
                <button
                  onClick={handleTimeoutRefund}
                  disabled={timeoutRefundLoading}
                  className="btn-ghost text-sm py-2 px-4 text-red-400/80 hover:text-red-400 hover:bg-red-500/8 disabled:opacity-60"
                >
                  {timeoutRefundLoading ? "Processing..." : "Claim Timeout Refund"}
                </button>
              </div>
            ) : (
              <p className="text-sm text-amber-700">
                Timeout period has expired. Only the client can claim a refund.
              </p>
            )}
          </div>
        )}

      {/* Management section (job in progress) */}
      {(job.status === "in_progress" || job.status === "disputed") && (isClient || isFreelancer) && (
        <div className="mt-6 card border-market-500/20 bg-market-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-lg font-bold text-amber-100 mb-1">Job Management</h3>
              <p className="text-sm text-amber-800">
                {job.status === "disputed" 
                  ? "This job is currently under dispute. Admin review is required." 
                  : "Manage the project and escrow payments."}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {isClient && job.status === "in_progress" && (
                <button
                  onClick={handleReleaseEscrow}
                  disabled={releasingEscrow}
                  className="btn-primary py-2 px-5 text-sm flex items-center gap-2"
                >
                  {releasingEscrow ? <Spinner /> : "Release Escrow"}
                </button>
              )}
              {job.status === "in_progress" && (
                <button
                  onClick={() => setShowDisputeModal(true)}
                  className="btn-secondary py-2 px-5 text-sm"
                >
                  Raise Dispute
                </button>
              )}
            </div>
          </div>
        </div>
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

      {pendingRelease && publicKey && (
        <FeeEstimationModal
          transaction={pendingRelease.transaction}
          functionName={pendingRelease.fnName}
          payerPublicKey={publicKey}
          onConfirm={handleConfirmReleaseFee}
          onCancel={handleCancelReleaseFee}
        />
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