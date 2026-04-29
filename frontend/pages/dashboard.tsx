/**
 * pages/dashboard.tsx
 * User dashboard — shows posted jobs, applications, and wallet balance.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import WalletConnect from "@/components/WalletConnect";
import { fetchMyJobs, fetchMyApplications, fetchUnreadCount } from "@/lib/api";
import { getXLMBalance, getUSDCBalance, streamAccountTransactions } from "@/lib/stellar";
import { formatXLM, shortenAddress, timeAgo, statusLabel, statusClass, copyToClipboard, exportJobsToCSV, exportApplicationsToCSV, CATEGORY_ICONS } from "@/utils/format";
import type { Job, Application } from "@/utils/types";
import EditProfileForm from "@/components/EditProfileForm";
import SendPaymentForm from "@/components/SendPaymentForm";
import BuyXLMModal from "@/components/BuyXLMModal";
import WithdrawToBankModal, {
  loadWithdrawHistory,
  type WithdrawHistoryEntry,
} from "@/components/WithdrawToBankModal";
import { useToast } from "@/components/Toast";
import clsx from "clsx";
import JobAnalytics from "@/components/JobAnalytics";

const LOW_BALANCE_THRESHOLD_XLM = 5;

// ── Job Alert localStorage helpers (mirrors jobs/index.tsx) ─────────────────
const ALERT_KEY = "marketpay_job_alerts";

function getAlertSubscriptions(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(ALERT_KEY) ?? "[]"); }
  catch { return []; }
}

function clearAlertSubscription(cat: string): void {
  const current = getAlertSubscriptions();
  const updated = current.filter((c) => c !== cat);
  localStorage.setItem(ALERT_KEY, JSON.stringify(updated));
  window.dispatchEvent(new Event("job-alerts-changed"));
}

interface DashboardProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

type Tab = "posted" | "applied" | "send" | "edit_profile" | "templates" | "price_alerts" | "withdrawals";
const REPOST_JOB_PREFILL_STORAGE_KEY = "marketpay_repost_job_prefill";

export default function Dashboard({ publicKey, onConnect }: DashboardProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("posted");
  const [myJobs, setMyJobs] = useState<Job[]>([]);
  const [myApplications, setMyApplications] = useState<Application[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [balance, setBalance]           = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const [processedTxs, setProcessedTxs] = useState<Set<string>>(new Set());
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
  const [withdrawHistory, setWithdrawHistory] = useState<WithdrawHistoryEntry[]>([]);
  const { info, success } = useToast();

  const isRepostable = (status: Job["status"]) => status === "expired" || status === "cancelled";

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

  const handleHireAgain = (job: Job) => {
    router.push({
      pathname: "/post-job",
      query: {
        category: job.category,
        freelancer: job.freelancerAddress || "",
      },
    });
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
      })
    );
    router.push("/post-job");
  };

  const refreshBalances = () => {
    if (!publicKey) return;
    Promise.all([getXLMBalance(publicKey), getUSDCBalance(publicKey)])
      .then(([bal, usdc]) => {
        setBalance(bal);
        setUsdcBalance(usdc);
      })
      .catch(() => {});
  };

  const handleExtendJob = async (jobId: string) => {
    setExtendingJob(jobId);
    try {
      await extendJobExpiry(jobId);
      // Refresh jobs to update expiry info
      const jobs = await fetchMyJobs(publicKey!);
      setMyJobs(jobs);
    } catch (e) {
      console.error(e);
    } finally {
      setExtendingJob(null);
    }
  };

  // Sync alert subscriptions from localStorage
  useEffect(() => {
    const sync = () => setAlertSubscriptions(getAlertSubscriptions());
    sync();
    window.addEventListener("job-alerts-changed", sync);
    return () => window.removeEventListener("job-alerts-changed", sync);
  }, []);

  // Check for new matching jobs whenever subscriptions change
  useEffect(() => {
    if (alertSubscriptions.length === 0) {
      setAlertMatches([]);
      window.dispatchEvent(new CustomEvent("job-alert-matches", { detail: { count: 0 } }));
      return;
    }
    // Fetch open jobs for each subscribed category and collect matches
    Promise.all(
      alertSubscriptions.map((cat) =>
        fetchJobs({ category: cat, status: "open", limit: 5 }).then((r) => r.jobs)
      )
    )
      .then((results) => {
        const seen = new Set<string>();
        const matches: Job[] = [];
        for (const batch of results) {
          for (const job of batch) {
            if (!seen.has(job.id)) { seen.add(job.id); matches.push(job); }
          }
        }
        setAlertMatches(matches);
        setAlertMatchesDismissed(false);
        if (matches.length > 0) {
          window.dispatchEvent(new CustomEvent("job-alert-matches", { detail: { count: matches.length } }));
        }
      })
      .catch(console.error);
  }, [alertSubscriptions]);

  useEffect(() => {
    if (!publicKey) return;

    Promise.all([
      fetchMyJobs(publicKey),
      fetchMyApplications(publicKey),
      getXLMBalance(publicKey),
      getUSDCBalance(publicKey),
      fetchUnreadCount(),
    ])
      .then(([jobs, apps, bal, usdc, unread]) => {
        setMyJobs(jobs);
        setMyApplications(apps);
        setBalance(bal);
        setUsdcBalance(usdc);
        setUnreadCount(unread);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    const onTransaction = (tx: any) => {
      if (processedTxs.has(tx.hash)) return;
      setProcessedTxs((prev) => new Set(prev).add(tx.hash));

      const jobId = tx.memo;
      if (!jobId) return;

      const job = myJobs.find((j) => j.id === jobId);
      if (job) {
        success(`New application received for: ${job.title}`);
        window.dispatchEvent(new CustomEvent("stellar-activity", { detail: { type: "job", id: jobId } }));
        fetchMyJobs(publicKey).then(setMyJobs);
        return;
      }

      const app = myApplications.find((a) => a.jobId === jobId);
      if (app) {
        info(`Application status updated for: ${jobId.slice(0, 8)}...`);
        window.dispatchEvent(new CustomEvent("stellar-activity", { detail: { type: "app", id: jobId } }));
        fetchMyApplications(publicKey).then(setMyApplications);
      }
    };

    const closeStream = streamAccountTransactions(publicKey, onTransaction);
    return () => {
      closeStream();
    };
  }, [publicKey, myJobs, myApplications, processedTxs, info, success]);

  useEffect(() => {
    if (!publicKey) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const wsUrl = apiUrl.replace(/^http/, "ws") + "/ws/realtime";
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.event === "job:invited" && message?.payload?.recipientAddress === publicKey) {
          success(`You were invited to a job (${String(message.payload.jobId).slice(0, 8)}...)`);
        }
        if (message?.event === "price:alert" && message?.payload?.recipientAddress === publicKey) {
          info(`XLM price alert: $${message.payload.currentPriceUsd}`);
        }
      } catch (_) {}
    };

    return () => ws.close();
  }, [publicKey, info, success]);

  useEffect(() => {
    setWithdrawHistory(loadWithdrawHistory());
  }, [showWithdraw]);

  useEffect(() => {
    if (!publicKey) return;
    fetchProposalTemplates().then(setTemplates).catch(() => {});
    fetchPriceAlertPreference(publicKey).then((pref) => {
      if (!pref) return;
      setMinPrice(pref.min_xlm_price_usd ? String(pref.min_xlm_price_usd) : "");
      setMaxPrice(pref.max_xlm_price_usd ? String(pref.max_xlm_price_usd) : "");
      setEmailEnabled(Boolean(pref.email_notifications_enabled));
      setAlertEmail(pref.email || "");
    }).catch(() => {});
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
                  : "text-amber-600 hover:text-amber-300 hover:bg-amber-400/10 border border-transparent"
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

      <div className="card mb-4 bg-gradient-to-br from-ink-800 to-ink-900 border-market-500/18 relative overflow-hidden">
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
            <div className="mt-3 flex flex-wrap gap-2">
              {balance !== null && parseFloat(balance) < LOW_BALANCE_THRESHOLD_XLM && (
                <button
                  onClick={() => setShowBuyXLM(true)}
                  className="btn-primary text-xs py-1.5 px-3"
                  data-testid="buy-xlm-button"
                >
                  Buy XLM
                </button>
              )}
              {balance !== null && parseFloat(balance) >= LOW_BALANCE_THRESHOLD_XLM && (
                <button
                  onClick={() => setShowBuyXLM(true)}
                  className="btn-secondary text-xs py-1.5 px-3"
                  data-testid="buy-xlm-button"
                >
                  Buy XLM
                </button>
              )}
              <button
                onClick={() => setShowWithdraw(true)}
                className="btn-secondary text-xs py-1.5 px-3"
                data-testid="withdraw-to-bank-button"
              >
                Withdraw to Bank
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 text-center">
            {[
              { label: "Jobs Posted", value: myJobs.length },
              { label: "Applied To", value: myApplications.length },
              { label: "Active Jobs", value: myJobs.filter((j) => j.status === "in_progress").length },
            ].map((stat) => (
              <div key={stat.label} className="bg-ink-900/50 rounded-xl p-3 border border-market-500/10">
                <p className="font-display text-2xl font-bold text-market-400">{stat.value}</p>
                <p className="text-xs text-amber-800 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {usdcBalance !== null && (
        <div className="card mb-8 bg-gradient-to-br from-ink-800 to-ink-900 border-blue-500/18 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/4 rounded-full blur-2xl pointer-events-none" />
          <div className="relative">
            <p className="label mb-2">USDC Balance</p>
            <p className="font-display text-4xl font-bold text-amber-100">
              {parseFloat(usdcBalance).toLocaleString("en-US", { maximumFractionDigits: 4 })}
              <span className="text-blue-400 text-2xl ml-2">USDC</span>
            </p>
          </div>
        </div>
      )}

      <div className="flex border-b border-market-500/10 mb-6 overflow-x-auto">
        {(["posted", "applied", "send", "edit_profile", "templates", "price_alerts", "withdrawals"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx(
              "px-6 py-3 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap relative",
              tab === t ? "border-market-400 text-market-300" : "border-transparent text-amber-700 hover:text-amber-400"
            )}>
            {t === "posted"    ? `Jobs Posted (${myJobs.length})` :
             t === "applied"   ? (
               <>
                 <span>Applications</span>
                 {unreadCount > 0 && (
                   <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500 text-white">
                     {unreadCount > 99 ? "99+" : unreadCount}
                   </span>
                 )}
               </>
             ) :
             t === "send"      ? "Send Payment" :
             "Edit Profile"}
            {t === "job_alerts" && alertSubscriptions.length > 0 && (
              <span className="absolute top-2 right-1 w-2 h-2 bg-market-400 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="card animate-pulse h-20" />)}
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
                Download CSV
              </button>
            </div>

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
                  <div className="text-right flex-shrink-0 space-y-2">
                    <p className="font-mono font-semibold text-market-400">{formatXLM(job.budget)}</p>
                    {isRepostable(job.status) && (
                      <button
                        type="button"
                        className="btn-secondary text-xs px-3 py-1.5"
                        onClick={() => handleRepost(job)}
                      >
                        Repost Job
                      </button>
                    )}
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
            <div className="flex justify-end mb-2">
              <button
                onClick={() => exportApplicationsToCSV(myApplications)}
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-2"
              >
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
      ) : tab === "analytics" ? (
        <div className="space-y-4">
          {myJobs.length === 0 ? (
            <div className="card text-center py-16">
              <p className="font-display text-xl text-amber-100 mb-2">No jobs posted yet</p>
              <p className="text-amber-800 text-sm mb-6">Post a job to see analytics</p>
              <Link href="/post-job" className="btn-primary text-sm">Post a Job →</Link>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex gap-4 overflow-x-auto pb-2">
                {myJobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
                    className={clsx(
                      "btn-secondary px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all",
                      selectedJob?.id === job.id
                        ? "bg-market-500/20 text-market-300 border-market-400"
                        : "bg-ink-900/50 text-amber-700 hover:text-amber-300 border-transparent"
                    )}
                  >
                    {job.title}
                  </button>
                ))}
              </div>
              {selectedJob ? (
                <JobAnalytics job={selectedJob} onExtend={() => handleExtendJob(selectedJob.id)} />
              ) : (
                <div className="card text-center py-12">
                  <p className="text-amber-800">Select a job to view its analytics</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : tab === "send" ? (
        <div className="space-y-4">
          <div className="card space-y-3">
            <p className="text-sm text-amber-100 font-medium">
              Proposal Templates ({templates.length}/10)
            </p>
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="input-field"
              placeholder="Template name"
            />
            <textarea
              value={templateContent}
              onChange={(e) => setTemplateContent(e.target.value)}
              className="textarea-field"
              rows={5}
              placeholder="Template proposal content"
            />
            <button
              className="btn-primary text-sm"
              onClick={async () => {
                if (!templateName.trim() || !templateContent.trim()) return;
                if (editingTemplateId) {
                  const updated = await updateProposalTemplate(editingTemplateId, {
                    name: templateName,
                    content: templateContent,
                  });
                  setTemplates((current) => current.map((item) => item.id === updated.id ? updated : item));
                  setEditingTemplateId(null);
                } else {
                  const created = await createProposalTemplate({
                    name: templateName,
                    content: templateContent,
                  });
                  setTemplates((current) => [created, ...current]);
                }
                setTemplateName("");
                setTemplateContent("");
              }}
            >
              {editingTemplateId ? "Update Template" : "Create Template"}
            </button>
          </div>
          <div className="space-y-3">
            {templates.map((template) => (
              <div key={template.id} className="card">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-amber-100 font-medium">{template.name}</p>
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary text-xs px-3 py-1.5"
                      onClick={() => {
                        setEditingTemplateId(template.id);
                        setTemplateName(template.name);
                        setTemplateContent(template.content);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-secondary text-xs px-3 py-1.5"
                      onClick={async () => {
                        await deleteProposalTemplate(template.id);
                        setTemplates((current) => current.filter((item) => item.id !== template.id));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-sm text-amber-700 whitespace-pre-wrap">{template.content}</p>
              </div>
            ))}
          </div>
        </div>
      ) : tab === "price_alerts" ? (
        <div className="card space-y-4 max-w-lg">
          <h3 className="font-display text-xl text-amber-100">XLM Price Alerts</h3>
          <input
            type="number"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            className="input-field"
            placeholder="Alert if XLM drops below (USD)"
          />
          <input
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            className="input-field"
            placeholder="Alert if XLM rises above (USD)"
          />
          <label className="flex items-center gap-2 text-sm text-amber-200">
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
            />
            Enable email notifications
          </label>
          {emailEnabled && (
            <input
              value={alertEmail}
              onChange={(e) => setAlertEmail(e.target.value)}
              className="input-field"
              placeholder="Email address"
            />
          )}
          <button
            className="btn-primary text-sm"
            onClick={async () => {
              await upsertPriceAlertPreference(publicKey, {
                minXlmPriceUsd: minPrice ? Number(minPrice) : null,
                maxXlmPriceUsd: maxPrice ? Number(maxPrice) : null,
                emailNotificationsEnabled: emailEnabled,
                email: alertEmail,
              });
              success("Price alert settings saved");
            }}
          >
            Save Alerts
          </button>
        </div>
      ) : tab === "withdrawals" ? (
        withdrawHistory.length === 0 ? (
          <div className="card text-center py-16">
            <p className="font-display text-xl text-amber-100 mb-2">No withdrawals yet</p>
            <p className="text-amber-800 text-sm mb-6">
              Convert your XLM or USDC to USD, EUR, or NGN — paid directly to your bank account.
            </p>
            <button
              onClick={() => setShowWithdraw(true)}
              className="btn-primary text-sm"
              data-testid="empty-state-withdraw-button"
            >
              Withdraw to Bank →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {withdrawHistory.map((entry) => (
              <div key={entry.id} className="card flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2.5 py-0.5 rounded-full border bg-market-500/10 text-market-400 border-market-500/20">
                      {entry.flow}
                    </span>
                    <span className="text-xs text-amber-700">{entry.status}</span>
                  </div>
                  <p className="font-display font-semibold text-amber-100 truncate">
                    {entry.amount} {entry.asset} → {entry.fiatCurrency}
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    {new Date(entry.startedAt).toLocaleString()}
                    {entry.externalTxId && ` · Bank ref ${entry.externalTxId.slice(0, 12)}…`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )
      ) : tab === "edit_profile" ? (
        <EditProfileForm publicKey={publicKey} />
      ) : null}

      {showBuyXLM && (
        <BuyXLMModal
          publicKey={publicKey}
          onClose={() => setShowBuyXLM(false)}
          onComplete={refreshBalances}
        />
      )}
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
  );
}
