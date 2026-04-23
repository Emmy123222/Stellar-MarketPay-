/**
 * pages/jobs/[id].tsx
 * Single job detail page — view description, apply, or manage as client.
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import ApplicationForm from "@/components/ApplicationForm";
import WalletConnect from "@/components/WalletConnect";
import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";
import { fetchJob, fetchApplications, acceptApplication, releaseEscrow } from "@/lib/api";
import { formatXLM, timeAgo, formatDate, shortenAddress, statusLabel, statusClass } from "@/utils/format";
import {
  accountUrl,
  buildReleaseEscrowTransaction,
  explorerUrl,
  submitSignedSorobanTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import type { Job, Application } from "@/utils/types";
import clsx from "clsx";

interface JobDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
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
  /** True when backend job status was updated after the chain release. */
  const [releaseSyncedWithBackend, setReleaseSyncedWithBackend] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [prefillData, setPrefillData] = useState<any>(null);

  const isClient     = publicKey && job?.clientAddress === publicKey;
  const isFreelancer = publicKey && job?.freelancerAddress === publicKey;
  const hasApplied   = applications.some((a) => a.freelancerAddress === publicKey);

  useEffect(() => {
    if (!id) return;
    
    // Check for prefill parameter
    const { prefill } = router.query;
    if (typeof prefill === 'string') {
      try {
        const decoded = JSON.parse(Buffer.from(prefill, 'base64').toString('utf8'));
        setPrefillData(decoded);
      } catch {
        // Invalid prefill data, ignore
      }
    }
    
    Promise.all([
      fetchJob(id as string),
      fetchApplications(id as string),
    ])
      .then(([j, apps]) => { setJob(j); setApplications(apps); })
      .catch(() => router.push("/jobs"))
      .finally(() => setLoading(false));
  }, [id, router]);

  const handleAcceptApplication = async (appId: string) => {
    if (!publicKey) return;
    try {
      await acceptApplication(appId, publicKey);
      const [j, apps] = await Promise.all([fetchJob(id as string), fetchApplications(id as string)]);
      setJob(j); setApplications(apps);
    } catch {
      setActionError("Failed to accept application.");
    }
  };

  const handleReleaseEscrow = async () => {
    if (!publicKey || !job) return;
    if (!job.escrowContractId) {
      setActionError(
        "This job has no escrow contract ID. Set NEXT_PUBLIC_CONTRACT_ID after deploying the Soroban contract, and ensure the job record stores the contract address."
      );
      return;
    }

    setReleasingEscrow(true);
    setActionError(null);
    setReleaseTxHash(null);
    setReleaseSyncedWithBackend(false);

    try {
      const prepared = await buildReleaseEscrowTransaction(job.escrowContractId, job.id, publicKey);
      const { signedXDR, error: signError } = await signTransactionWithWallet(prepared.toXDR());
      if (signError || !signedXDR) {
        setActionError(signError || "Signing was cancelled.");
        return;
      }

      const { hash } = await submitSignedSorobanTransaction(signedXDR);
      setReleaseTxHash(hash);

      try {
        await releaseEscrow(job.id, publicKey, hash);
        const j = await fetchJob(id as string);
        setJob(j);
        setReleaseSuccess(true);
        setReleaseSyncedWithBackend(true);
      } catch {
        setActionError(
          "Payment was released on-chain, but the app could not update your job status. Keep this transaction hash and retry or contact support."
        );
        setReleaseSuccess(true);
        setReleaseSyncedWithBackend(false);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not complete the release. Please try again.";
      setActionError(msg);
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
          {[1,2,3,4].map(i => <div key={i} className="h-4 bg-market-500/8 rounded w-full" />)}
        </div>
      </div>
    );
  }

  if (!job) return null;

  return (
    <>
      {/* Open Graph Meta Tags */}
      <Head>
        <title>{job.title} - Stellar MarketPay</title>
        <meta name="description" content={job.description.substring(0, 160)} />
        <meta property="og:title" content={job.title} />
        <meta property="og:description" content={job.description.substring(0, 160)} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`${typeof window !== 'undefined' ? window.location.origin : ''}/jobs/${job.id}`} />
        <meta property="og:site_name" content="Stellar MarketPay" />
        <meta property="og:image" content={`${typeof window !== 'undefined' ? window.location.origin : ''}/og-image.jpg`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={job.title} />
        <meta name="twitter:description" content={job.description.substring(0, 160)} />
      </Head>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">

        {/* Back */}
        <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-amber-800 hover:text-amber-400 transition-colors mb-6">
          ← Back to Jobs
        </Link>

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

        {/* Skills */}
        {job.skills.length > 0 && (
          <div className="mt-5">
            <h3 className="font-display text-base font-semibold text-amber-300 mb-3">Required Skills</h3>
            <div className="flex flex-wrap gap-2">
              {job.skills.map((s) => (
                <span key={s} className="text-sm bg-market-500/8 text-market-500/80 border border-market-500/15 px-3 py-1 rounded-full">{s}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Escrow release (client, job in progress) */}
      {isClient && job.status === "in_progress" && (
        <div className="card mb-6 border-emerald-500/20 bg-emerald-500/5">
          <h3 className="font-display text-base font-semibold text-emerald-300 mb-2">Release Escrow Payment</h3>
          <p className="text-amber-700 text-sm mb-4">
            Work complete? Release <span className="text-market-400 font-mono font-semibold">{formatXLM(job.budget)}</span> from escrow to the freelancer.
          </p>
          {releaseSuccess && releaseTxHash ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                <span>✅</span>
                {releaseSyncedWithBackend
                  ? "Escrow released on-chain. Your job is marked complete."
                  : "Escrow released on-chain."}
              </div>
              <p className="text-xs text-amber-700 break-all font-mono">
                Transaction: {releaseTxHash}
              </p>
              <a
                href={explorerUrl(releaseTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex text-sm text-market-400 hover:text-market-300 underline"
              >
                View on Stellar Expert →
              </a>
            </div>
          ) : releaseSuccess ? (
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
              <span>✅</span> Escrow released! Payment sent to freelancer.
            </div>
          ) : (
            <button onClick={handleReleaseEscrow} disabled={releasingEscrow} className="btn-primary bg-emerald-600 hover:bg-emerald-500 flex items-center gap-2">
              {releasingEscrow ? <><Spinner /> Releasing...</> : "✅ Approve & Release Payment"}
            </button>
          )}
          {actionError && <p className="mt-3 text-red-400 text-sm">{actionError}</p>}
        </div>
      )}

      {/* Applications (client view) */}
      {isClient && applications.length > 0 && (
        <div className="mb-6">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-4">
            Applications ({applications.length})
          </h2>
          <div className="space-y-4">
            {applications.map((app) => (
              <div key={app.id} className="card">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <a href={accountUrl(app.freelancerAddress)} target="_blank" rel="noopener noreferrer"
                    className="address-tag hover:border-market-500/40 transition-colors">
                    {shortenAddress(app.freelancerAddress)} ↗
                  </a>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-market-400 font-semibold text-sm">{formatXLM(app.bidAmount)}</span>
                    <span className={clsx("text-xs px-2.5 py-1 rounded-full border",
                      app.status === "accepted" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                      app.status === "rejected" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                      "bg-market-500/10 text-market-400 border-market-500/20"
                    )}>{app.status}</span>
                  </div>
                </div>
                <p className="text-amber-700/80 text-sm leading-relaxed mb-4">{app.proposal}</p>
                {app.status === "pending" && job.status === "open" && (
                  <button onClick={() => handleAcceptApplication(app.id)} className="btn-secondary text-sm py-2 px-4">
                    Accept Proposal
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
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
        </div>
      )}

      {/* Freelancer job status */}
      {isFreelancer && job.status !== "completed" && (
        <div className="card border-market-500/20 text-center py-8">
          <p className="font-display text-lg text-amber-100 mb-1">You are working on this job</p>
          <p className="text-amber-800 text-sm">Deliver the work and the client will release <span className="text-market-400 font-mono">{formatXLM(job.budget)}</span> from escrow.</p>
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
    </div>

      {/* Share Modal */}
      {showShareModal && job && (
        <ShareJobModal
          job={job}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </>
  );
}

function Spinner() {
  return <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;
}
