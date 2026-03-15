/**
 * pages/jobs/[id].tsx
 * Single job detail page — view description, apply, or manage as client.
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import ApplicationForm from "@/components/ApplicationForm";
import WalletConnect from "@/components/WalletConnect";
import { fetchJob, fetchApplications, acceptApplication, releaseEscrow } from "@/lib/api";
import { formatXLM, timeAgo, formatDate, shortenAddress, statusLabel, statusClass } from "@/utils/format";
import { accountUrl } from "@/lib/stellar";
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
  const [actionError, setActionError] = useState<string | null>(null);

  const isClient     = publicKey && job?.clientAddress === publicKey;
  const isFreelancer = publicKey && job?.freelancerAddress === publicKey;
  const hasApplied   = applications.some((a) => a.freelancerAddress === publicKey);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetchJob(id as string),
      fetchApplications(id as string),
    ])
      .then(([j, apps]) => { setJob(j); setApplications(apps); })
      .catch(() => router.push("/jobs"))
      .finally(() => setLoading(false));
  }, [id]);

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
    setReleasingEscrow(true);
    setActionError(null);
    try {
      await releaseEscrow(job.id, publicKey);
      setReleaseSuccess(true);
      const j = await fetchJob(id as string);
      setJob(j);
    } catch {
      setActionError("Failed to release escrow. Please try again.");
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
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 leading-snug">{job.title}</h1>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="text-xs text-amber-800 mb-1">Budget</p>
            <p className="font-mono font-bold text-2xl text-market-400">{formatXLM(job.budget)}</p>
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-4 text-xs text-amber-800 mb-5 pb-5 border-b border-market-500/8">
          <span>Posted {timeAgo(job.createdAt)}</span>
          <span>{job.applicantCount} applicant{job.applicantCount !== 1 ? "s" : ""}</span>
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
          {releaseSuccess ? (
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
      {isFreelancer && (
        <div className="card border-market-500/20 text-center py-8">
          <p className="font-display text-lg text-amber-100 mb-1">You are working on this job</p>
          <p className="text-amber-800 text-sm">Deliver the work and the client will release <span className="text-market-400 font-mono">{formatXLM(job.budget)}</span> from escrow.</p>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;
}
