/**
 * pages/dashboard.tsx
 * User dashboard — shows posted jobs, applications, and wallet balance.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import Link from "next/link";
import { useRouter } from "next/router";
import WalletConnect from "@/components/WalletConnect";
import {
  fetchMyJobs, fetchMyApplications, fetchApplications, fetchMyInvitations, declineInvitation,
  fetchProposalTemplates, fetchProfile,
  fetchClientSpendingAnalytics, fetchPriceAlertPreference, upsertPriceAlertPreference,
  fetchSavedSearches, updateSavedSearch, deleteSavedSearch,
  createProposalTemplate, updateProposalTemplate, deleteProposalTemplate,
} from "@/lib/api";
import { getXLMBalance, getUSDCBalance, streamAccountTransactions } from "@/lib/stellar";
import { formatXLM } from "@/utils/format";
import type { Job, Application, ClientSpendingAnalytics, JobInvitation, BulkActionResponse } from "@/utils/types";
import EditProfileForm from "@/components/EditProfileForm";
import SendPaymentForm from "@/components/SendPaymentForm";
import WalletAddressDisplay from "@/components/WalletAddressDisplay";
import { useToast } from "@/components/Toast";
import clsx from "clsx";
import dynamic from "next/dynamic";
import JobTimeline from "@/components/JobTimeline";
import BulkJobActionBar from "@/components/BulkJobActionBar";
import JobStatusTimeline from "@/components/JobStatusTimeline";
import ExtendJobModal from "@/components/ExtendJobModal";
import ClientSpendingTab from "@/components/ClientSpendingTab";
import EarningsChart from "@/components/EarningsChart";
import PostedJobsTab from "@/components/dashboard-tabs/PostedJobsTab";
import AppliedJobsTab from "@/components/dashboard-tabs/AppliedJobsTab";
import InvitationsTab from "@/components/dashboard-tabs/InvitationsTab";
import ProposalComparison from "@/components/ProposalComparison";
import { usePriceContext } from "@/contexts/PriceContext";
import ProfileCompletenessWidget from "@/components/ProfileCompletenessWidget";
import { useOnboarding } from "@/hooks/useOnboarding";
import XlmPriceWidget from "@/components/XlmPriceWidget";
import StateMessage from "@/components/StateMessage";
import BuyXLMModal from "@/components/BuyXLMModal";
import WithdrawToBankModal from "@/components/WithdrawToBankModal";

// Dynamic imports for heavy components
const JobAnalytics = dynamic(() => import("@/components/JobAnalytics"), {
  loading: () => <div className="animate-pulse bg-market-900/30 h-64 rounded-xl" />,
  ssr: false,
});

const ReferralDashboard = dynamic(() => import("@/components/ReferralDashboard"), {
  loading: () => <div className="animate-pulse bg-market-900/30 h-64 rounded-xl" />,
  ssr: false,
});

const LOW_BALANCE_THRESHOLD_XLM = 5;
const IS_CONTRACT_MOCK_DEV_MODE =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true";
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

type Tab = "posted" | "applied" | "proposals" | "invitations" | "analytics" | "earnings" | "spending" | "send" | "edit_profile" | "templates" | "price_alerts" | "withdrawals" | "saved_searches" | "referrals";
const REPOST_JOB_PREFILL_STORAGE_KEY = "marketpay_repost_job_prefill";

async function fetchBalances(
  publicKey: string,
): Promise<{ xlm: string; usdc: string }> {
  const horizonUrl =
    process.env.NEXT_PUBLIC_HORIZON_URL ||
    "https://horizon-testnet.stellar.org";
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

function syncDashboardNavBadge(count: number) {
  if (typeof document === "undefined") return;

  const navLink = document.querySelector('a[href="/dashboard"]');
  if (!(navLink instanceof HTMLElement)) return;

  navLink.classList.add("relative");

  let badge = navLink.querySelector("[data-dashboard-badge]");
  if (count <= 0) {
    badge?.remove();
    return;
  }

  if (!(badge instanceof HTMLSpanElement)) {
    badge = document.createElement("span");
    badge.setAttribute("data-dashboard-badge", "true");
    badge.className = "absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-market-400 text-ink-900 text-[10px] font-bold flex items-center justify-center shadow-[0_0_18px_rgba(251,191,36,0.45)]";
    navLink.appendChild(badge);
  }

  badge.textContent = count > 9 ? "9+" : String(count);
}

export default function Dashboard({ publicKey, onConnect }: DashboardProps) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("posted");
  const [canViewSpending, setCanViewSpending] = useState(true);
  const [myJobs, setMyJobs] = useState<Job[]>([]);
  const [myApplications, setMyApplications] = useState<Application[]>([]);
  const [jobApplications, setJobApplications] = useState<Map<string, Application[]>>(new Map());
  const [myInvitations, setMyInvitations] = useState<JobInvitation[]>([]);
  const [balance, setBalance]           = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance]   = useState<string | null>(null);
  const [notificationCount, setNotificationCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const latestJobsRef = useRef<Job[]>([]);
  const latestApplicationsRef = useRef<Application[]>([]);
  const latestJobApplicationsRef = useRef<Map<string, Application[]>>(new Map());
  const seenNotificationsRef = useRef<Set<string>>(new Set());
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [extendModalJob, setExtendModalJob] = useState<Job | null>(null);
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<string | null>(null);
  const [confirmDeleteSearch, setConfirmDeleteSearch] = useState<string | null>(null);

  // ── Missing state declarations (referenced throughout component) ──────────
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showBuyXLM, setShowBuyXLM] = useState(false);
  const [withdrawHistory, setWithdrawHistory] = useState<Array<{ id: string; amount: string; asset: string; fiatCurrency: string }>>([]);
  const [spendingAnalytics, setSpendingAnalytics] = useState<ClientSpendingAnalytics | null>(null);
  const [spendingLoading, setSpendingLoading] = useState(false);
  const [savedSearches, setSavedSearches] = useState<Array<{ id: string; query_params: Record<string, string>; notify_in_app: boolean; notify_email: boolean; created_at: string }>>([]);
  const [savedSearchesLoading, setSavedSearchesLoading] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; content: string }>>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [alertEmail, setAlertEmail] = useState("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [alertMatchesDismissed, setAlertMatchesDismissed] = useState(false);
  const [alertMatches, setAlertMatches] = useState<Job[]>([]);
  const [extendingJob, setExtendingJob] = useState<string | null>(null);

  // ── Destructure onboarding progress ──────────────────────────────────────
  const { checklistItems, progress } = useOnboarding(publicKey);

  // ── Derived values ────────────────────────────────────────────────────────
  const { xlmPriceUsd } = usePriceContext();
  const { success } = toast;
  const router = useRouter();

  // ── Missing local helpers ─────────────────────────────────────────────────
  function loadWithdrawHistory(): Array<{ id: string; amount: string; asset: string; fiatCurrency: string }> {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("marketpay_withdraw_history") : null;
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;
    try {
      const [xlm, usdc] = await Promise.all([
        getXLMBalance(publicKey),
        getUSDCBalance(publicKey),
      ]);
      setBalance(xlm);
      setUsdcBalance(usdc);
    } catch {
      // ignore
    }
  }, [publicKey]);

  const handleExtendJob = useCallback((jobId: string) => {
    setExtendingJob(jobId);
    const job = myJobs.find((j) => j.id === jobId) ?? null;
    setExtendModalJob(job);
  }, [myJobs]);

  const handleRepost = useCallback((job: Job) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(REPOST_JOB_PREFILL_STORAGE_KEY, JSON.stringify(job));
    }
    router.push("/post-job");
  }, [router]);

  const handleResetContractMock = useCallback(() => {
    if (typeof window !== "undefined") {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("mock_escrow_"))
        .forEach((k) => localStorage.removeItem(k));
    }
  }, []);


  const handleJobExtended = useCallback((updated: Job) => {
    setMyJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
    setExtendModalJob(null);
  }, []);

  const bulkResult = useCallback(
    (ids: string[], ok: boolean): BulkActionResponse => ({
      success: ok,
      succeeded: ok ? ids.length : 0,
      failed: ok ? 0 : ids.length,
      processedCount: ids.length,
      failedCount: ok ? 0 : ids.length,
      results: ids.map((id) => ({ id, success: ok })),
    }),
    [],
  );

  const handleBulkCancel = useCallback(async () => {
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedJobIds);
      await Promise.all(ids.map((id) => fetch(`/api/jobs/${id}/cancel`, { method: "POST" })));
      setSelectedJobIds(new Set());
      return bulkResult(ids, true);
    } catch {
      return bulkResult(Array.from(selectedJobIds), false);
    } finally {
      setBulkLoading(false);
    }
  }, [selectedJobIds, bulkResult]);

  const handleBulkExtend = useCallback(async () => {
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedJobIds);
      await Promise.all(ids.map((id) => fetch(`/api/jobs/${id}/extend`, { method: "POST" })));
      setSelectedJobIds(new Set());
      return bulkResult(ids, true);
    } catch {
      return bulkResult(Array.from(selectedJobIds), false);
    } finally {
      setBulkLoading(false);
    }
  }, [selectedJobIds, bulkResult]);

  const handleBulkBoost = useCallback(async () => {
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedJobIds);
      await Promise.all(ids.map((id) => fetch(`/api/jobs/${id}/boost`, { method: "POST" })));
      setSelectedJobIds(new Set());
      return bulkResult(ids, true);
    } catch {
      return bulkResult(Array.from(selectedJobIds), false);
    } finally {
      setBulkLoading(false);
    }
  }, [selectedJobIds, bulkResult]);

  const loadDashboardData = useCallback(async () => {
    if (!publicKey) return null;

    const [jobs, apps, invitations, bal, usdc] = await Promise.all([
      fetchMyJobs(publicKey),
      fetchMyApplications(publicKey),
      fetchMyInvitations().catch((): JobInvitation[] => []),
      getXLMBalance(publicKey),
      getUSDCBalance(publicKey),
    ]);

    const jobApplications = new Map<string, Application[]>();
    const applicationLists = await Promise.all(
      jobs.map((job) =>
        fetchApplications(job.id).catch(() => [])
      )
    );

    jobs.forEach((job, index) => {
      jobApplications.set(job.id, applicationLists[index]);
    });

    setMyJobs(jobs);
    setMyApplications(apps);
    setJobApplications(jobApplications);
    setMyInvitations(invitations);
    setBalance(bal);
    setUsdcBalance(usdc);
    latestJobsRef.current = jobs;
    latestApplicationsRef.current = apps;
    latestJobApplicationsRef.current = jobApplications;

    return { jobs, apps, jobApplications, invitations };
  }, [publicKey]);

  const pushNotification = useCallback(
    (key: string, message: string, variant: "success" | "info" = "info") => {
      if (seenNotificationsRef.current.has(key)) return;

      seenNotificationsRef.current.add(key);
      setNotificationCount((count) => count + 1);
      if (variant === "success") {
        toast.success(message);
        return;
      }
      toast.info(message);
    },
    [toast]
  );

  const refreshNotifications = useCallback(async () => {
    if (!publicKey) return;
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    refreshPromiseRef.current = (async () => {
      const previousApplications = latestApplicationsRef.current;
      const previousJobApplications = latestJobApplicationsRef.current;
      const nextData = await loadDashboardData();
      if (!nextData) return;

      const { jobs, apps, jobApplications } = nextData;

      for (const job of jobs) {
        const previousIds = new Set(
          (previousJobApplications.get(job.id) ?? []).map((application) => application.id)
        );

        for (const application of jobApplications.get(job.id) ?? []) {
          if (!previousIds.has(application.id)) {
            pushNotification(
              `job:${job.id}:application:${application.id}`,
              `New application received for: ${job.title}`,
              "success"
            );
          }
        }
      }

      const previousStatuses = new Map(
        previousApplications.map((application) => [application.id, application.status])
      );

      for (const application of apps) {
        const previousStatus = previousStatuses.get(application.id);
        if (previousStatus && previousStatus !== application.status) {
          pushNotification(
            `application:${application.id}:status:${application.status}`,
            `Application status updated: ${application.status}`,
            application.status === "accepted" ? "success" : "info"
          );
        }
      }
    })().finally(() => {
      refreshPromiseRef.current = null;
    });

    return refreshPromiseRef.current;
  }, [loadDashboardData, publicKey, pushNotification]);

  useEffect(() => {
    if (!publicKey) return;

    loadDashboardData()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [loadDashboardData, publicKey]);

  useEffect(() => {
    syncDashboardNavBadge(notificationCount);
    return () => syncDashboardNavBadge(0);
  }, [notificationCount]);

  useEffect(() => {
    if (!publicKey) {
      setNotificationCount(0);
      seenNotificationsRef.current.clear();
      syncDashboardNavBadge(0);
      return;
    }

    const stopStreaming = streamAccountTransactions(publicKey, () => {
      void refreshNotifications();
    });

    return () => {
      stopStreaming();
    };
  }, [publicKey, refreshNotifications]);

  useEffect(() => {
    setWithdrawHistory(loadWithdrawHistory());
  }, [showWithdraw]);

  useEffect(() => {
    if (!publicKey) return;
    fetchProposalTemplates()
      .then(setTemplates)
      .catch(() => {});
    fetchPriceAlertPreference(publicKey)
      .then((pref) => {
        if (!pref) return;
        setMinPrice(
          pref.min_xlm_price_usd ? String(pref.min_xlm_price_usd) : "",
        );
        setMaxPrice(
          pref.max_xlm_price_usd ? String(pref.max_xlm_price_usd) : "",
        );
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
      .then((profile) =>
        setCanViewSpending(
          profile.role === "client" || profile.role === "both",
        ),
      )
      .catch(() => setCanViewSpending(true));
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey) return;
    setSavedSearchesLoading(true);
    fetchSavedSearches()
      .then(setSavedSearches)
      .catch(() => {})
      .finally(() => setSavedSearchesLoading(false));
  }, [publicKey]);

  useEffect(() => {
    if (tab === "spending" && !canViewSpending) setTab("posted");
  }, [tab, canViewSpending]);

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-amber-100 mb-3">
            Dashboard
          </h1>
          <p className="text-amber-800">
            Connect your wallet to view your jobs and applications
          </p>
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
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display text-3xl font-bold text-amber-100">Dashboard</h1>
            {notificationCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-market-400/15 px-2.5 py-1 text-xs font-semibold text-market-300 border border-market-400/25">
                {notificationCount} new
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <WalletAddressDisplay address={publicKey} />
          </div>
          <Link
            href="/post-job"
            className="btn-primary text-sm py-2.5 px-5 flex-shrink-0"
          >
            + Post a Job
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          <div className="lg:col-span-2 space-y-4">
            <div className="card bg-gradient-to-br from-ink-800 to-ink-900 border-market-500/18">
              <p className="label mb-2">XLM Balance</p>
              {balance !== null ? (
                <p className="font-display text-4xl font-bold text-amber-100">
                  {parseFloat(balance).toLocaleString("en-US", {
                    maximumFractionDigits: 4,
                  })}
                  <span className="text-market-400 text-2xl ml-2">XLM</span>
                </p>
              ) : (
                <div className="h-10 w-48 bg-market-500/8 rounded-xl animate-pulse" />
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setShowBuyXLM(true)}
                  className={
                    parseFloat(balance || "0") < LOW_BALANCE_THRESHOLD_XLM
                      ? "btn-primary text-xs py-1.5 px-3"
                      : "btn-secondary text-xs py-1.5 px-3"
                  }
                >
                  Buy XLM
                </button>
                <button
                  onClick={() => setShowWithdraw(true)}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  Withdraw to Bank
                </button>
                {IS_CONTRACT_MOCK_DEV_MODE && (
                  <button
                    onClick={handleResetContractMock}
                    className="btn-secondary text-xs py-1.5 px-3 border-red-400/30 text-red-300 hover:bg-red-400/10"
                    title="Mock-only: clears locally persisted escrow test data"
                  >
                    Reset Mock
                  </button>
                )}
              </div>
              {IS_CONTRACT_MOCK_DEV_MODE && (
                <p className="mt-2 text-xs text-amber-700">
                  Mock-only contract escrow state is persisted in this browser for
                  local development and can be cleared with Reset Mock.
                </p>
              )}
            </div>

            {usdcBalance !== null && (
              <div className="card bg-gradient-to-br from-ink-800 to-ink-900 border-blue-500/18">
                <p className="label mb-2">USDC Balance</p>
                <p className="font-display text-4xl font-bold text-amber-100">
                  {parseFloat(usdcBalance).toLocaleString("en-US", {
                    maximumFractionDigits: 4,
                  })}
                  <span className="text-blue-400 text-2xl ml-2">USDC</span>
                </p>
              </div>
            )}
          </div>
          <div className="lg:col-span-1">
            <XlmPriceWidget />
          </div>
        </div>

        {/* Profile completeness widget */}
        {!progress.isComplete && (
          <div className="mb-6">
            <ProfileCompletenessWidget
              completionPercentage={progress.completionPercentage}
              isComplete={progress.isComplete}
              checklistItems={checklistItems}
            />
          </div>
        )}

        {/* Job alert matches banner */}
        {!alertMatchesDismissed && alertMatches.length > 0 && (
          <div className="mb-6 rounded-xl border border-market-500/30 bg-market-500/8 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <BellIcon className="w-4 h-4 text-market-400 flex-shrink-0" />
                <p className="text-sm font-semibold text-market-300">
                  {alertMatches.length} new job
                  {alertMatches.length !== 1 ? "s" : ""} matching your alerts
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/jobs"
                  className="text-xs text-market-400 hover:text-market-300 underline whitespace-nowrap"
                >
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
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="flex items-center justify-between rounded-lg px-3 py-2 bg-ink-900/50 hover:bg-market-500/10 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-amber-100 truncate font-medium">
                      {job.title}
                    </p>
                    <p className="text-xs text-amber-800">
                      {CATEGORY_ICONS[job.category] ?? ""} {job.category} ·{" "}
                      {formatXLM(job.budget)}
                    </p>
                  </div>
                  <span className="text-market-400 text-xs ml-2 flex-shrink-0">
                    View →
                  </span>
                </Link>
              ))}
              {alertMatches.length > 3 && (
                <p className="text-xs text-amber-800 px-3">
                  +{alertMatches.length - 3} more —{" "}
                  <Link
                    href="/jobs"
                    className="text-market-400 hover:underline"
                  >
                    see all
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}

      {/* Tabs */}
      {(() => {
        const totalProposalCount = (() => {
          let count = 0;
          jobApplications.forEach((apps) => { count += apps.length; });
          return count;
        })();
        const tabIds: Tab[] = [
          "posted",
          "applied",
          "proposals",
          "invitations",
          "analytics",
          "earnings",
          ...(canViewSpending ? (["spending"] as Tab[]) : []),
          "send",
          "edit_profile",
          "templates",
          "price_alerts",
          "withdrawals",
          "saved_searches",
        ];
        const tabLabel = (t: Tab): string =>
          t === "posted" ? `Jobs Posted (${myJobs.length})` :
          t === "applied" ? `Applications (${myApplications.length})` :
          t === "proposals" ? `Proposals (${totalProposalCount})` :
          t === "invitations" ? `Invitations${myInvitations.length > 0 ? ` (${myInvitations.length})` : ""}` :
          t === "analytics" ? "Job Analytics" :
          t === "earnings" ? "Earnings" :
          t === "spending" ? "Spending" :
          t === "send" ? "Send" :
          t === "templates" ? "Templates" :
          t === "price_alerts" ? "Price Alerts" :
          t === "withdrawals" ? `Withdrawals (${withdrawHistory.length})` :
          t === "saved_searches" ? `Saved Searches${savedSearches.length > 0 ? ` (${savedSearches.length})` : ""}` :
          "Edit Profile";

        return (
          <>
            {/* Desktop/tablet: horizontal tab row — sm and up. */}
            <div className="hidden sm:flex border-b border-market-500/10 mb-6 overflow-x-auto">
              {tabIds.map((t) => (
                <button key={t} onClick={() => setTab(t)} className={clsx("px-6 py-3 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap", tab === t ? "border-market-400 text-market-300" : "border-transparent text-amber-700 hover:text-amber-400")}>
                  {tabLabel(t)}
                </button>
              ))}
            </div>

            {/* Mobile: dropdown — Issue #859. A 13-item horizontal tab bar
                overflows and truncates on narrow screens; a native select
                is both compact and gets the OS's own accessible picker UI
                for free. */}
            <div className="sm:hidden mb-6">
              <label htmlFor="dashboard-tab-select" className="sr-only">
                Dashboard section
              </label>
              <select
                id="dashboard-tab-select"
                value={tab}
                onChange={(e) => setTab(e.target.value as Tab)}
                className="w-full px-4 py-3 rounded-xl bg-ink-900/60 border border-market-500/20 text-sm font-medium text-amber-100"
              >
                {tabIds.map((t) => (
                  <option key={t} value={t}>
                    {tabLabel(t)}
                  </option>
                ))}
              </select>
            </div>
          </>
        );
      })()}

        {loading ? (
          <div className="space-y-6 animate-pulse">
            {/* Balance cards skeleton */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="card h-24" />
              <div className="card h-24" />
              <div className="card h-24" />
            </div>

            {/* Tab content skeleton */}
            <div className="card space-y-4">
              <div className="h-6 w-32 bg-market-500/10 rounded" />
              <div className="space-y-3">
                <div className="h-16 bg-market-500/8 rounded" />
                <div className="h-16 bg-market-500/8 rounded" />
                <div className="h-16 bg-market-500/8 rounded" />
              </div>
            </div>
          </div>
        ) : tab === "posted" ? (
          <PostedJobsTab
            myJobs={myJobs}
            onExtendJob={handleExtendJob}
            onRepost={handleRepost}
            extendModalJob={extendModalJob}
            onJobExtended={handleJobExtended}
            onCloseExtendModal={() => setExtendModalJob(null)}
          />
        ) : tab === "applied" ? (
          <AppliedJobsTab myApplications={myApplications} />
        ) : tab === "proposals" ? (
          <ProposalComparison
            myJobs={myJobs}
            jobApplications={jobApplications}
            publicKey={publicKey}
          />
        ) : tab === "analytics" ? (
          selectedJob ? (
            <JobAnalytics
              job={selectedJob}
              onExtend={() => handleExtendJob(selectedJob.id)}
            />
          ) : (
            <div className="space-y-3">
              {myJobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => setSelectedJob(job)}
                  className="btn-secondary text-sm px-3 py-2 mr-2 mb-2"
                >
                  {job.title}
                  {extendingJob === job.id ? " (Extending...)" : ""}
                </button>
              ))}
            </div>
          )
        ) : tab === "earnings" ? (
          <EarningsChart publicKey={publicKey} />
        ) : tab === "spending" ? (
          <ClientSpendingTab
            analytics={spendingAnalytics}
            loading={spendingLoading}
            xlmPriceUsd={xlmPriceUsd}
          />
        ) : tab === "send" ? (
          <SendPaymentForm fromPublicKey={publicKey} />
        ) : tab === "templates" ? (
          <>
          <div className="space-y-4">
            <div className="card space-y-3">
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
                    const updated = await updateProposalTemplate(
                      editingTemplateId,
                      { name: templateName, content: templateContent },
                    );
                    setTemplates((current) =>
                      current.map((item) =>
                        item.id === updated.id ? updated : item,
                      ),
                    );
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
            {templates.length === 0 ? (
              <StateMessage
                type="empty"
                title="No proposal templates"
                description="Create a template to speed up your proposals"
                ctaLabel="Create Template"
                onCta={() => {
                  setTemplateName('');
                  setTemplateContent('');
                }}
              />
            ) : (
              templates.map((template) => (
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
                        onClick={() => setConfirmDeleteTemplate(template.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-amber-700 whitespace-pre-wrap">
                    {template.content}
                  </p>
                </div>
              )))}
          </div>

          <ConfirmDialog
            open={confirmDeleteTemplate !== null}
            title="Delete Proposal Template"
            description="Are you sure you want to delete this proposal template? This action cannot be undone."
            confirmLabel="Yes, Delete"
            onConfirm={async () => {
              if (!confirmDeleteTemplate) return;
              await deleteProposalTemplate(confirmDeleteTemplate);
              setTemplates((current) =>
                current.filter((item) => item.id !== confirmDeleteTemplate),
              );
              setConfirmDeleteTemplate(null);
              success("Template deleted");
            }}
            onCancel={() => setConfirmDeleteTemplate(null)}
          />

          <InvitationsTab
            myInvitations={myInvitations}
            onDecline={async (id) => {
              try {
                await declineInvitation(id);
                setMyInvitations((prev) => prev.filter((i) => i.id !== id));
                success("Invitation declined.");
              } catch {
                // ignore
              }
            }}
          />
          </>
        ) : tab === "price_alerts" ? (
          (!minPrice && !maxPrice && !emailEnabled) ? (
            <StateMessage
              type="empty"
              title="No price alerts set"
              description="Configure alerts to stay informed about XLM price changes"
              ctaLabel="Add Alert"
              onCta={() => {
                // focus could be added later
              }}
            />
          ) : (
            <div className="card space-y-4 max-w-lg">
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
          )
        ) : tab === "withdrawals" ? (
          withdrawHistory.length === 0 ? (
            <StateMessage
              type="empty"
              title="No withdrawals yet"
              description="Add a withdrawal to move funds to your bank account"
              ctaLabel="Withdraw now"
              onCta={() => setShowWithdraw(true)}
            />
          ) : (
            <div className="space-y-3">
              {withdrawHistory.map((entry) => (
                <div key={entry.id} className="card">
                  <p className="font-display font-semibold text-amber-100">
                    {entry.amount} {entry.asset} → {entry.fiatCurrency}
                  </p>
                </div>
              ))}
            </div>
          )
        ) : tab === "saved_searches" ? (
          <>
          {savedSearchesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="card animate-pulse h-20" />
              ))}
            </div>
          ) : savedSearches.length === 0 ? (
            <StateMessage
              type="empty"
              title="No saved searches"
              description="Save a search on the Jobs page to get notified when matching jobs are posted"
              ctaLabel="Browse Jobs"
              onCta={() => router.push("/jobs")}
            />
          ) : (
            <>
            <div className="space-y-3">
              {savedSearches.map((s) => (
                <div key={s.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {Object.entries(s.query_params).map(([key, val]) => (
                        <span
                          key={key}
                          className="text-xs bg-market-500/10 text-market-400 border border-market-500/20 px-2 py-0.5 rounded-md"
                        >
                          {key}: {val}
                        </span>
                      ))}
                      {Object.keys(s.query_params).length === 0 && (
                        <span className="text-xs text-amber-700">All jobs</span>
                      )}
                    </div>
                    <p className="text-xs text-amber-800">
                      Saved {new Date(s.created_at).toLocaleDateString()} ·
                      In-app: {s.notify_in_app ? "\u2713" : "\u2715"} ·
                      Email: {s.notify_email ? "\u2713" : "\u2715"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={async () => {
                        try {
                          const updated = await updateSavedSearch(s.id, {
                            notify_in_app: !s.notify_in_app,
                          });
                          setSavedSearches((prev) =>
                            prev.map((x) => (x.id === updated.id ? updated : x))
                          );
                          success("Notification preference updated");
                        } catch {
                          // ignore
                        }
                      }}
                      className={`text-xs px-3 py-2 rounded-lg border min-h-[44px] transition-colors ${
                        s.notify_in_app
                          ? "bg-market-500/15 text-market-300 border-market-500/30"
                          : "bg-ink-800 text-amber-700 border-market-500/10"
                      }`}
                    >
                      In-app
                    </button>
                    <button
                      onClick={() => setConfirmDeleteSearch(s.id)}
                      className="text-xs px-3 py-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 min-h-[44px] transition-colorsbg-red-500/10 min-h-[44px] transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <ConfirmDialog
              open={confirmDeleteSearch !== null}
              title="Remove Saved Search"
              description="Are you sure you want to remove this saved search? This action cannot be undone."
              confirmLabel="Yes, Remove"
              onConfirm={async () => {
                if (!confirmDeleteSearch) return;
                try {
                  await deleteSavedSearch(confirmDeleteSearch);
                  setSavedSearches((prev) => prev.filter((x) => x.id !== confirmDeleteSearch));
                  setConfirmDeleteSearch(null);
                  success("Saved search removed");
                } catch {
                  // ignore
                }
              }}
              onCancel={() => setConfirmDeleteSearch(null)}
            />
            </>
          )}
          </>
        ) : tab === "referrals" ? (
          <ReferralDashboard publicKey={publicKey} />
        ) : (
          <EditProfileForm publicKey={publicKey} />
        )}

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

      <BulkJobActionBar
        selectedCount={selectedJobIds.size}
        onCancel={handleBulkCancel}
        onExtend={handleBulkExtend}
        onBoost={handleBulkBoost}
        onClearSelection={() => setSelectedJobIds(new Set())}
        loading={bulkLoading}
      />

      {extendModalJob && (
        <ExtendJobModal
          job={extendModalJob}
          onClose={() => setExtendModalJob(null)}
          onExtended={handleJobExtended}
        />
      )}
    </div>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
      />
    </svg>
  );
}
