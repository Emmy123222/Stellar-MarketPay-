/**
 * pages/dashboard.tsx
 * User dashboard — shows posted jobs, applications, and wallet balance.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { fetchMyJobs, fetchMyApplications } from "@/lib/api";
import { getXLMBalance } from "@/lib/stellar";
import { formatXLM, shortenAddress, timeAgo, statusLabel, statusClass, copyToClipboard, exportJobsToCSV, exportApplicationsToCSV } from "@/utils/format";
import type { Job, Application } from "@/utils/types";
import EditProfileForm from "@/components/EditProfileForm";
import clsx from "clsx";

interface DashboardProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

type Tab = "posted" | "applied" | "edit_profile";

export default function Dashboard({ publicKey, onConnect }: DashboardProps) {
  const [tab, setTab] = useState<Tab>("posted");
  const [myJobs, setMyJobs] = useState<Job[]>([]);
  const [myApplications, setMyApplications] = useState<Application[]>([]);
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const handleCopy = async () => {
    if (!publicKey) return;
    const success = await copyToClipboard(publicKey);
    if (success) {
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2000);
    }
  };

  useEffect(() => {
    if (!publicKey) return;
    Promise.all([
      fetchMyJobs(publicKey),
      fetchMyApplications(publicKey),
      getXLMBalance(publicKey),
    ])
      .then(([jobs, apps, bal]) => { setMyJobs(jobs); setMyApplications(apps); setBalance(bal); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [publicKey]);

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-amber-100 mb-3">Dashboard</h1>
          <p className="text-amber-800">Connect your wallet to view your jobs and applications</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-amber-100 mb-1">Dashboard</h1>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="address-tag">{shortenAddress(publicKey)}</span>
            <button
              onClick={handleCopy}
              className={clsx(
                "p-1.5 rounded-md transition-all flex items-center justify-center h-7 min-w-[28px]",
                copied ? "text-emerald-400 bg-emerald-400/10 border border-emerald-400/20" : 
                copyError ? "text-red-400 bg-red-400/10 border border-red-400/20" : 
                "text-amber-600 hover:text-amber-300 hover:bg-amber-400/10 border border-transparent"
              )}
              title="Copy public key"
            >
              {copied ? (
                <span className="text-xs font-medium px-1">Copied!</span>
              ) : copyError ? (
                <span className="text-xs font-medium px-1">Failed</span>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              )}
            </button>
          </div>
        </div>
        <Link href="/post-job" className="btn-primary text-sm py-2.5 px-5 flex-shrink-0">+ Post a Job</Link>
      </div>

      {/* Wallet card */}
      <div className="card mb-8 bg-gradient-to-br from-ink-800 to-ink-900 border-market-500/18 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-market-500/4 rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <p className="label mb-2">XLM Balance</p>
            {balance !== null ? (
              <p className="font-display text-4xl font-bold text-amber-100">
                {parseFloat(balance).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                <span className="text-market-400 text-2xl ml-2">XLM</span>
              </p>
            ) : (
              <div className="h-10 w-48 bg-market-500/8 rounded-xl animate-pulse" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 text-center">
            {[
              { label: "Jobs Posted", value: myJobs.length },
              { label: "Applied To",  value: myApplications.length },
              { label: "Active Jobs", value: myJobs.filter((j) => j.status === "in_progress").length },
            ].map((stat) => (
              <div key={stat.label} className="bg-ink-900/50 rounded-xl p-3 border border-market-500/10">
                <p className="font-display text-2xl font-bold text-market-400">{stat.value}</p>
                <p className="text-xs text-amber-800 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
        {process.env.NEXT_PUBLIC_STELLAR_NETWORK !== "mainnet" && (
          <div className="mt-4 pt-4 border-t border-market-500/8 flex items-center gap-2 text-xs text-amber-600/70">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
            On <strong>Testnet</strong> — funds are not real. <a href="https://friendbot.stellar.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-400">Get test XLM →</a>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-market-500/10 mb-6 overflow-x-auto">
        {(["posted", "applied", "edit_profile"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx(
              "px-6 py-3 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap",
              tab === t ? "border-market-400 text-market-300" : "border-transparent text-amber-700 hover:text-amber-400"
            )}>
            {t === "posted" ? `Jobs Posted (${myJobs.length})` : 
             t === "applied" ? `Applications (${myApplications.length})` : 
             "Edit Profile"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="card animate-pulse h-20" />)}
        </div>
      ) : tab === "posted" ? (
        myJobs.length === 0 ? (
          <div className="card text-center py-16">
            <p className="font-display text-xl text-amber-100 mb-2">No jobs posted yet</p>
            <p className="text-amber-800 text-sm mb-6">Post your first job and find a great freelancer</p>
            <Link href="/post-job" className="btn-primary text-sm">Post a Job →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end mb-2">
              <button 
                onClick={() => exportJobsToCSV(myJobs)} 
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download CSV
              </button>
            </div>
            {myJobs.map((job) => (
              <Link key={job.id} href={`/jobs/${job.id}`}>
                <div className="card-hover flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={statusClass(job.status)}>{statusLabel(job.status)}</span>
                      <span className="text-xs text-amber-800">{job.category}</span>
                    </div>
                    <p className="font-display font-semibold text-amber-100 truncate">{job.title}</p>
                    <p className="text-xs text-amber-800 mt-1">{job.applicantCount} applicant{job.applicantCount !== 1 ? "s" : ""} · {timeAgo(job.createdAt)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-mono font-semibold text-market-400">{formatXLM(job.budget)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : tab === "applied" ? (
        myApplications.length === 0 ? (
          <div className="card text-center py-16">
            <p className="font-display text-xl text-amber-100 mb-2">No applications yet</p>
            <p className="text-amber-800 text-sm mb-6">Browse open jobs and submit your first proposal</p>
            <Link href="/jobs" className="btn-primary text-sm">Browse Jobs →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end mb-2">
              <button 
                onClick={() => exportApplicationsToCSV(myApplications)} 
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download CSV
              </button>
            </div>
            {myApplications.map((app) => (
              <Link key={app.id} href={`/jobs/${app.jobId}`}>
                <div className="card-hover flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={clsx("text-xs px-2.5 py-0.5 rounded-full border",
                        app.status === "accepted" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                        app.status === "rejected" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                        "bg-market-500/10 text-market-400 border-market-500/20"
                      )}>{app.status}</span>
                    </div>
                    <p className="text-amber-700 text-sm line-clamp-1">{app.proposal}</p>
                    <p className="text-xs text-amber-800 mt-1">{timeAgo(app.createdAt)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-mono font-semibold text-market-400">{formatXLM(app.bidAmount)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : tab === "edit_profile" ? (
        <EditProfileForm publicKey={publicKey} />
      ) : null}
    </div>
  );
}
