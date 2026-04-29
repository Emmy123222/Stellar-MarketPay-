/**
 * pages/dashboard.tsx
 * User dashboard — shows posted jobs, applications, and wallet balance.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import WalletConnect from "@/components/WalletConnect";
import {
  fetchMyJobs,
  fetchMyApplications,
  fetchProfile,
  fetchProposalTemplates,
  createProposalTemplate,
  updateProposalTemplate,
  deleteProposalTemplate,
  fetchPriceAlertPreference,
  upsertPriceAlertPreference,
  fetchClientSpendingAnalytics,
  extendJobExpiry,
} from "@/lib/api";
import { formatXLM, shortenAddress, timeAgo, statusLabel, statusClass, copyToClipboard, exportJobsToCSV, exportApplicationsToCSV } from "@/utils/format";
import type { Job, Application, ClientSpendingAnalytics } from "@/utils/types";
import EditProfileForm from "@/components/EditProfileForm";
import SendPaymentForm from "@/components/SendPaymentForm";
import BuyXLMModal from "@/components/BuyXLMModal";
import WithdrawToBankModal, { loadWithdrawHistory, type WithdrawHistoryEntry } from "@/components/WithdrawToBankModal";
import { useToast } from "@/components/Toast";
import clsx from "clsx";
import JobAnalytics from "@/components/JobAnalytics";
import ClientSpendingTab from "@/components/ClientSpendingTab";
import { usePriceContext } from "@/contexts/PriceContext";

const LOW_BALANCE_THRESHOLD_XLM = 5;
const CATEGORY_ICONS: Record<string, string> = {
  web: "Web",
  mobile: "Mobile",
  design: "Design",
  writing: "Writing",
  marketing: "Marketing",
};

interface DashboardProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

type Tab = "posted" | "applied" | "analytics" | "spending" | "send" | "edit_profile" | "templates" | "price_alerts" | "withdrawals";
const REPOST_JOB_PREFILL_STORAGE_KEY = "marketpay_repost_job_prefill";

async function fetchBalances(publicKey: string): Promise<{ xlm: string; usdc: string }> {
  const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
  const res = await fetch(`${horizonUrl}/accounts/${publicKey}`);
  if (!res.ok) throw new Error("Failed to fetch balances");
  const data = await res.json();
  const balances = Array.isArray(data.balances) ? data.balances : [];
  const native = balances.find((b: any) => b.asset_type === "native");
  const usdc = balances.find((b: any) => b.asset_code === "USDC");
  return {
    xlm: native?.balance || "0",
    usdc: usdc?.balance || "0",
  };
}

export default function Dashboard({ publicKey, onConnect }: DashboardProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("posted");
  const [canViewSpending, setCanViewSpending] = useState(true);
  const [myJobs, setMyJobs] = useState<Job[]>([]);
  const [myApplications, setMyApplications] = useState<Application[]>([]);
  const [balance, setBalance] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; content: string }[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [alertEmail, setAlertEmail] = useState("");
  const [showBuyXLM, setShowBuyXLM] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [alertMatchesDismissed, setAlertMatchesDismissed] = useState(false);
  const [withdrawHistory, setWithdrawHistory] = useState<WithdrawHistoryEntry[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [extendingJob, setExtendingJob] = useState<string | null>(null);
  const [spendingAnalytics, setSpendingAnalytics] = useState<ClientSpendingAnalytics | null>(null);
  const [spendingLoading, setSpendingLoading] = useState(false);
  const { success } = useToast();
  const { xlmPriceUsd } = usePriceContext();

  const isRepostable = (status: Job["status"]) => status === "cancelled";
  const alertMatches: Job[] = [];

  // Tooltip configurations for new users
  const tooltipConfigs: TooltipConfig[] = [
    {
      id: "post-job",
      targetSelector: '[href="/post-job"]',
      title: "Post Your First Job",
      description: "Click here to create a job posting and start hiring talented freelancers on the Stellar network.",
      position: "bottom",
      action: {
        label: "Post a Job",
        onClick: () => router.push("/post-job"),
      },
    },
    {
      id: "connect-wallet",
      targetSelector: '[data-testid="wallet-connect-button"]',
      title: "Connect Your Wallet",
      description: "Connect your Stellar wallet to send payments, receive funds, and interact with smart contracts.",
      position: "bottom",
    },
    {
      id: "browse-jobs",
      targetSelector: '[href="/jobs"]',
      title: "Browse Available Jobs",
      description: "Explore open job postings and submit proposals to projects that match your skills.",
      position: "bottom",
      action: {
        label: "Browse Jobs",
        onClick: () => router.push("/jobs"),
      },
    },
  ];

  // Filter tooltips based on dismissed state
  const activeTooltips = tooltipConfigs.filter(
    (tooltip) => !onboardingState.dismissedTooltips.includes(tooltip.id)
  );

  const handleCopy = async () => {
    if (!publicKey) return;
    const ok = await copyToClipboard(publicKey);
    if (ok) {
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2000);
    }
  };

  const handleRepost = (job: Job) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      REPOST_JOB_PREFILL_STORAGE_KEY,
      JSON.stringify({
        title: job.title,
        description: job.description,
        budget: job.budget,
        category: job.category,
        freelancer: job.freelancerAddress || "",
      }),
    );
    router.push("/post-job");
  };

  const refreshBalances = () => {
    if (!publicKey) return;
    fetchBalances(publicKey)
      .then(({ xlm, usdc }) => {
        setBalance(xlm);
        setUsdcBalance(usdc);
      })
      .catch(() => {});
  };

  const handleExtendJob = async (jobId: string) => {
    setExtendingJob(jobId);
    try {
      await extendJobExpiry(jobId);
      const jobs = await fetchMyJobs(publicKey!);
      setMyJobs(jobs);
    } finally {
      setExtendingJob(null);
    }
  };

  useEffect(() => {
    if (!publicKey) return;
    Promise.all([
      fetchMyJobs(publicKey),
      fetchMyApplications(publicKey),
      fetchBalances(publicKey),
    ])
      .then(([jobs, apps, balances]) => {
        setMyJobs(jobs);
        setMyApplications(apps);
        setBalance(balances.xlm);
        setUsdcBalance(balances.usdc);
      })
      .finally(() => setLoading(false));
  }, [publicKey]);

  useEffect(() => {
    setWithdrawHistory(loadWithdrawHistory());
  }, [showWithdraw]);

  useEffect(() => {
    if (!publicKey) return;
    fetchProposalTemplates().then(setTemplates).catch(() => {});
    fetchPriceAlertPreference(publicKey)
      .then((pref) => {
        if (!pref) return;
        setMinPrice(pref.min_xlm_price_usd ? String(pref.min_xlm_price_usd) : "");
        setMaxPrice(pref.max_xlm_price_usd ? String(pref.max_xlm_price_usd) : "");
        setEmailEnabled(Boolean(pref.email_notifications_enabled));
        setAlertEmail(pref.email || "");
      })
      .catch(() => {});
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey) return;
    setSpendingLoading(true);
    fetchClientSpendingAnalytics(publicKey)
      .then(setSpendingAnalytics)
      .catch(() => setSpendingAnalytics(null))
      .finally(() => setSpendingLoading(false));
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey) return;
    fetchProfile(publicKey)
      .then((profile) => setCanViewSpending(profile.role === "client" || profile.role === "both"))
      .catch(() => setCanViewSpending(true));
  }, [publicKey]);

  useEffect(() => {
    if (tab === "spending" && !canViewSpending) setTab("posted");
  }, [tab, canViewSpending]);

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
    <>
      {/* Welcome Modal */}
      <WelcomeModal
        isOpen={shouldShowWelcome}
        onClose={markWelcomeSeen}
        onGetStarted={() => {
          markWelcomeSeen();
          setTab("edit_profile");
        }}
      />

      {/* Tooltips for new users */}
      {!shouldShowWelcome && activeTooltips.length > 0 && (
        <Tooltips
          tooltips={activeTooltips}
          onDismiss={dismissTooltip}
          onDismissAll={dismissAllTooltips}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
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
                copied
                  ? "text-emerald-400 bg-emerald-400/10 border border-emerald-400/20"
                  : copyError
                  ? "text-red-400 bg-red-400/10 border border-red-400/20"
                  : "text-amber-600 hover:text-amber-300 hover:bg-amber-400/10 border border-transparent",
              )}
              title="Copy public key"
            >
              {copied ? "Copied!" : copyError ? "Failed" : "Copy"}
            </button>
          </div>
        </div>
        <Link href="/post-job" className="btn-primary text-sm py-2.5 px-5 flex-shrink-0">+ Post a Job</Link>
      </div>

      <div className="card mb-4 bg-gradient-to-br from-ink-800 to-ink-900 border-market-500/18">
        <p className="label mb-2">XLM Balance</p>
        {balance !== null ? (
          <p className="font-display text-4xl font-bold text-amber-100">
            {parseFloat(balance).toLocaleString("en-US", { maximumFractionDigits: 4 })}
            <span className="text-market-400 text-2xl ml-2">XLM</span>
          </p>
        ) : (
          <div className="h-10 w-48 bg-market-500/8 rounded-xl animate-pulse" />
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setShowBuyXLM(true)} className={parseFloat(balance || "0") < LOW_BALANCE_THRESHOLD_XLM ? "btn-primary text-xs py-1.5 px-3" : "btn-secondary text-xs py-1.5 px-3"}>Buy XLM</button>
          <button onClick={() => setShowWithdraw(true)} className="btn-secondary text-xs py-1.5 px-3">Withdraw to Bank</button>
        </div>
      </div>

      {usdcBalance !== null && (
        <div className="card mb-8 bg-gradient-to-br from-ink-800 to-ink-900 border-blue-500/18">
          <p className="label mb-2">USDC Balance</p>
          <p className="font-display text-4xl font-bold text-amber-100">
            {parseFloat(usdcBalance).toLocaleString("en-US", { maximumFractionDigits: 4 })}
            <span className="text-blue-400 text-2xl ml-2">USDC</span>
          </p>
        </div>
      )}

      {/* Job alert matches banner */}
      {!alertMatchesDismissed && alertMatches.length > 0 && (
        <div className="mb-6 rounded-xl border border-market-500/30 bg-market-500/8 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <BellIcon className="w-4 h-4 text-market-400 flex-shrink-0" />
              <p className="text-sm font-semibold text-market-300">
                {alertMatches.length} new job{alertMatches.length !== 1 ? "s" : ""} matching your alerts
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/jobs" className="text-xs text-market-400 hover:text-market-300 underline whitespace-nowrap">
                Browse all →
              </Link>
              <button
                onClick={() => setAlertMatchesDismissed(true)}
                className="text-amber-800 hover:text-amber-500 transition-colors text-lg leading-none"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {alertMatches.slice(0, 3).map((job) => (
              <Link key={job.id} href={`/jobs/${job.id}`}
                className="flex items-center justify-between rounded-lg px-3 py-2 bg-ink-900/50 hover:bg-market-500/10 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm text-amber-100 truncate font-medium">{job.title}</p>
                  <p className="text-xs text-amber-800">
                    {CATEGORY_ICONS[job.category] ?? ""} {job.category} · {formatXLM(job.budget)}
                  </p>
                </div>
                <span className="text-market-400 text-xs ml-2 flex-shrink-0">View →</span>
              </Link>
            ))}
            {alertMatches.length > 3 && (
              <p className="text-xs text-amber-800 px-3">+{alertMatches.length - 3} more — <Link href="/jobs" className="text-market-400 hover:underline">see all</Link></p>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-market-500/10 mb-6 overflow-x-auto">
        {(
          [
            "posted",
            "applied",
            "analytics",
            ...(canViewSpending ? (["spending"] as Tab[]) : []),
            "send",
            "edit_profile",
            "templates",
            "price_alerts",
            "withdrawals",
          ] as Tab[]
        ).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={clsx("px-6 py-3 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap", tab === t ? "border-market-400 text-market-300" : "border-transparent text-amber-700 hover:text-amber-400")}>
            {t === "posted" ? `Jobs Posted (${myJobs.length})` :
             t === "applied" ? `Applications (${myApplications.length})` :
             t === "analytics" ? "Job Analytics" :
             t === "spending" ? "Spending" :
             t === "send" ? "Send Payment" :
             t === "templates" ? "Proposal Templates" :
             t === "price_alerts" ? "Price Alerts" :
             t === "withdrawals" ? `Withdrawals (${withdrawHistory.length})` :
             "Edit Profile"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="card animate-pulse h-20" />)}</div>
      ) : tab === "posted" ? (
        myJobs.length === 0 ? (
          <div className="card text-center py-16">
            <p className="font-display text-xl text-amber-100 mb-2">No jobs posted yet</p>
            <p className="text-amber-800 text-sm mb-6">Post your first job and find a great freelancer</p>
            <Link href="/post-job" className="btn-primary text-sm">Post a Job →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end mb-2"><button onClick={() => exportJobsToCSV(myJobs)} className="btn-secondary text-xs px-3 py-1.5">Download CSV</button></div>
            {myJobs.map((job) => (
              <div key={job.id} className="card-hover flex items-center justify-between gap-4">
                <Link href={`/jobs/${job.id}`} className="flex-1 min-w-0 block">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={statusClass(job.status)}>{statusLabel(job.status)}</span>
                    <span className="text-xs text-amber-800">{job.category}</span>
                  </div>
                  <p className="font-display font-semibold text-amber-100 truncate">{job.title}</p>
                  <p className="text-xs text-amber-800 mt-1">{job.applicantCount} applicant{job.applicantCount !== 1 ? "s" : ""} · {timeAgo(job.createdAt)}</p>
                </Link>
                <div className="text-right flex-shrink-0">
                  <p className="font-mono font-semibold text-market-400">{formatXLM(job.budget)}</p>
                  {isRepostable(job.status) && <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => handleRepost(job)}>Repost Job</button>}
                </div>
              </div>
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
            <div className="flex justify-end mb-2"><button onClick={() => exportApplicationsToCSV(myApplications)} className="btn-secondary text-xs px-3 py-1.5">Download CSV</button></div>
            {myApplications.map((app) => (
              <Link key={app.id} href={`/jobs/${app.jobId}`} className="card-hover flex items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="text-amber-700 text-sm line-clamp-1">{app.proposal}</p>
                  <p className="text-xs text-amber-800 mt-1">{timeAgo(app.createdAt)}</p>
                </div>
                <p className="font-mono font-semibold text-market-400">{formatXLM(app.bidAmount)}</p>
              </Link>
            ))}
          </div>
        )
      ) : tab === "analytics" ? (
        selectedJob ? <JobAnalytics job={selectedJob} onExtend={() => handleExtendJob(selectedJob.id)} /> : (
          <div className="space-y-3">
            {myJobs.map((job) => (
              <button key={job.id} onClick={() => setSelectedJob(job)} className="btn-secondary text-sm px-3 py-2 mr-2 mb-2">{job.title}{extendingJob === job.id ? " (Extending...)" : ""}</button>
            ))}
          </div>
        )
      ) : tab === "spending" ? (
        <ClientSpendingTab analytics={spendingAnalytics} loading={spendingLoading} xlmPriceUsd={xlmPriceUsd} />
      ) : tab === "send" ? (
        <SendPaymentForm fromPublicKey={publicKey} />
      ) : tab === "templates" ? (
        <div className="space-y-4">
          <div className="card space-y-3">
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="input-field" placeholder="Template name" />
            <textarea value={templateContent} onChange={(e) => setTemplateContent(e.target.value)} className="textarea-field" rows={5} placeholder="Template proposal content" />
            <button className="btn-primary text-sm" onClick={async () => {
              if (!templateName.trim() || !templateContent.trim()) return;
              if (editingTemplateId) {
                const updated = await updateProposalTemplate(editingTemplateId, { name: templateName, content: templateContent });
                setTemplates((current) => current.map((item) => item.id === updated.id ? updated : item));
                setEditingTemplateId(null);
              } else {
                const created = await createProposalTemplate({ name: templateName, content: templateContent });
                setTemplates((current) => [created, ...current]);
              }
              setTemplateName("");
              setTemplateContent("");
            }}>{editingTemplateId ? "Update Template" : "Create Template"}</button>
          </div>
          {templates.map((template) => (
            <div key={template.id} className="card">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-amber-100 font-medium">{template.name}</p>
                <div className="flex gap-2">
                  <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => { setEditingTemplateId(template.id); setTemplateName(template.name); setTemplateContent(template.content); }}>Edit</button>
                  <button className="btn-secondary text-xs px-3 py-1.5" onClick={async () => { await deleteProposalTemplate(template.id); setTemplates((current) => current.filter((item) => item.id !== template.id)); }}>Delete</button>
                </div>
              </div>
              <p className="text-sm text-amber-700 whitespace-pre-wrap">{template.content}</p>
            </div>
          ))}
        </div>
      ) : tab === "price_alerts" ? (
        <div className="card space-y-4 max-w-lg">
          <input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className="input-field" placeholder="Alert if XLM drops below (USD)" />
          <input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="input-field" placeholder="Alert if XLM rises above (USD)" />
          <label className="flex items-center gap-2 text-sm text-amber-200">
            <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} />
            Enable email notifications
          </label>
          {emailEnabled && <input value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} className="input-field" placeholder="Email address" />}
          <button className="btn-primary text-sm" onClick={async () => {
            await upsertPriceAlertPreference(publicKey, {
              minXlmPriceUsd: minPrice ? Number(minPrice) : null,
              maxXlmPriceUsd: maxPrice ? Number(maxPrice) : null,
              emailNotificationsEnabled: emailEnabled,
              email: alertEmail,
            });
            success("Price alert settings saved");
          }}>Save Alerts</button>
        </div>
      ) : tab === "withdrawals" ? (
        withdrawHistory.length === 0 ? (
          <div className="card text-center py-16">
            <p className="font-display text-xl text-amber-100 mb-2">No withdrawals yet</p>
            <button onClick={() => setShowWithdraw(true)} className="btn-primary text-sm">Withdraw to Bank →</button>
          </div>
        ) : (
          <div className="space-y-3">
            {withdrawHistory.map((entry) => (
              <div key={entry.id} className="card">
                <p className="font-display font-semibold text-amber-100">{entry.amount} {entry.asset} → {entry.fiatCurrency}</p>
              </div>
            ))}
          </div>
        )
      ) : (
        <EditProfileForm publicKey={publicKey} />
      )}

      {showBuyXLM && <BuyXLMModal publicKey={publicKey} onClose={() => setShowBuyXLM(false)} onComplete={refreshBalances} />}
      {showWithdraw && (
        <WithdrawToBankModal
          publicKey={publicKey}
          onClose={() => {
            setShowWithdraw(false);
            setWithdrawHistory(loadWithdrawHistory());
            refreshBalances();
          }}
        />
      )}
      </div>
    </>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}
