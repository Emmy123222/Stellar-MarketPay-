import TimeTracker from "@/components/TimeTracker";
import FeeEstimationModal from "@/components/FeeEstimationModal";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import type { GetServerSideProps } from "next";
import ApplicationForm from "@/components/ApplicationForm";
import WalletConnect from "@/components/WalletConnect";
import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";
import {
  fetchJob,
  fetchApplications,
  acceptApplication,
  releaseEscrow,
  raiseDispute,
} from "@/lib/api";
import {
  formatXLM,
  formatDate,
  timeAgo,
  shortenAddress,
  statusLabel,
  statusClass,
} from "@/utils/format";
import {
  accountUrl,
  buildReleaseEscrowTransaction,
  submitSignedSorobanTransaction,
  buildPartialReleaseTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { optionalClientEnv } from "@/lib/env";
import type { Transaction } from "@stellar/stellar-sdk";
import type { Application, Job } from "@/utils/types";

// ── Site-wide canonical origin used in OG/Twitter meta tags (#487) ─────────
// RESOLVED_AT_BUILD is the build-time fallback used by client-rendered
// meta tags (post-hydration Head updates). For server-rendered meta tags in
// getServerSideProps we prefer the request host so staging branches do not
// self-canonicalize to production (see OG_BASE_URL below).
const SITE_URL =
  optionalClientEnv(
    "NEXT_PUBLIC_SITE_URL",
    "https://marketpay.stellar.org",
  ).replace(/\/$/, "");
const BACKEND_URL =
  optionalClientEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000").replace(/\/$/, "");
const TWITTER_SITE_HANDLE = optionalClientEnv("NEXT_PUBLIC_TWITTER_SITE", "");

interface JobDetailProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
  /** Server-rendered snapshot of the job used for SEO/social meta tags. */
  ssrJob?: Pick<
    Job,
    | "id"
    | "title"
    | "description"
    | "category"
    | "budget"
    | "currency"
    | "status"
    | "skills"
    | "clientAddress"
    | "createdAt"
  > | null;
  /** Origin used for canonical / og:url / og:image — request-host or build-time fallback. */
  ogBaseUrl: string;
}

/** Trim a string for use in meta descriptions and og:description. */
function truncate(text: string, max = 200): string {
  if (!text) return "";
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

/**
 * Server-side data fetch used to populate Open Graph and Twitter Card
 * meta tags before HTML reaches the social-media crawler.
 *
 * If the backend is unavailable, we fall through with `ssrJob: null` and
 * the client-side fetch will populate the live UI; meta tags then degrade
 * gracefully to a generic preview.
 *
 * `ogBaseUrl` is computed from the request host so staging / preview
 * branches canonicalize to themselves instead of leaking production URLs.
 */
export const getServerSideProps: GetServerSideProps<
  JobDetailProps & { ogBaseUrl: string }
> = async ({ params, req }) => {
  const jobId = typeof params?.id === "string" ? params.id : "";
  const host =
    (req?.headers?.["x-forwarded-host"] as string | undefined) ||
    (req?.headers?.host as string | undefined) ||
    "";
  const proto =
    (req?.headers?.["x-forwarded-proto"] as string | undefined) ||
    (req?.headers?.["x-forwarded-protocol"] as string | undefined) ||
    "https";
  const ogBaseUrl = host
    ? `${proto}://${host}`
    : SITE_URL;

  if (!jobId) return { props: { ssrJob: null, ogBaseUrl } };

  try {
    // Forward the request origin so the backend can apply any geo headers.
    const headers: Record<string, string> = { Accept: "application/json" };
    if (req?.headers?.cookie) headers.cookie = req.headers.cookie;
    if (req?.headers?.["user-agent"]) headers["user-agent"] = req.headers["user-agent"];

    const res = await fetch(`${BACKEND_URL}/api/jobs/${encodeURIComponent(jobId)}`, {
      headers,
      // Don't let ISR cache stale job data — jobs change frequently.
      cache: "no-store",
    });
    if (!res.ok) return { props: { ssrJob: null, ogBaseUrl } };
    const body = await res.json();
    const data = body?.data;
    if (!body?.success || !data || typeof data !== "object" || !data.id) {
      return { props: { ssrJob: null, ogBaseUrl } };
    }
    // Whitelist fields we actually need in meta tags to keep payload tiny.
    const ssrJob = {
      id: String(data.id),
      title: String(data.title || ""),
      description: String(data.description || ""),
      category: String(data.category || ""),
      budget: String(data.budget || ""),
      currency: String(data.currency || "XLM"),
      status: String(data.status || "open"),
      skills: Array.isArray(data.skills) ? data.skills.map(String) : [],
      clientAddress: String(data.clientAddress || ""),
      createdAt: String(data.createdAt || ""),
    };
    return { props: { ssrJob, ogBaseUrl } };
  } catch {
    return { props: { ssrJob: null, ogBaseUrl } };
  }
};

function badgeClass(status: string) {
  if (status === "accepted") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (status === "rejected") return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-market-500/10 text-market-400 border-market-500/20";
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function JobDetail({ publicKey, onConnect, ssrJob, ogBaseUrl }: JobDetailProps) {
  const router = useRouter();
  const jobId = typeof router.query.id === "string" ? router.query.id : null;

  const [job, setJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [optimisticallyApplied, setOptimisticallyApplied] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [releasingEscrow, setReleasingEscrow] = useState(false);
  const [releaseSuccess, setReleaseSuccess] = useState(false);
  const [prefillData, setPrefillData] = useState<any>(null);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [raisingDispute, setRaisingDispute] = useState(false);
  // Escrow timeout state
  const [timeoutLedger, setTimeoutLedger] = useState<number | null>(null);
  const [currentLedger, setCurrentLedger] = useState(0);
  const [timeoutCountdown, setTimeoutCountdown] = useState<string | null>(null);
  const [timeoutRefundSuccess, setTimeoutRefundSuccess] = useState(false);
  const [pendingTimeoutRefund, setPendingTimeoutRefund] = useState<Transaction | null>(null);
  // Milestone/partial-release state
  const [releasingMilestoneIndex, setReleasingMilestoneIndex] = useState<number | null>(null);
  const [pendingRelease, setPendingRelease] = useState<{ transaction: Transaction; fnName: string } | null>(null);

  const isClient = Boolean(publicKey && job?.clientAddress === publicKey);
  const isFreelancer = Boolean(publicKey && job?.freelancerAddress === publicKey);
  const hasApplied = optimisticallyApplied || applications.some((a) => a.freelancerAddress === publicKey);

  useEffect(() => {
    if (!jobId || !router.isReady) return;

    const { prefill } = router.query;
    if (typeof prefill === "string") {
      try {
        setPrefillData(JSON.parse(Buffer.from(prefill, "base64").toString("utf8")));
      } catch {
        setPrefillData(null);
      }
    }

    Promise.all([fetchJob(jobId), fetchApplications(jobId)])
      .then(([loadedJob, loadedApplications]) => {
        setJob(loadedJob);
        setApplications(loadedApplications);
      })
      .catch(() => router.push("/jobs"))
      .finally(() => setLoading(false));
  }, [jobId, router.isReady, router]);

  const handleAcceptApplication = async (applicationId: string) => {
    if (!publicKey || !jobId) return;
    try {
      setActionError(null);
      await acceptApplication(applicationId, publicKey);
      const [updatedJob, updatedApplications] = await Promise.all([
        fetchJob(jobId),
        fetchApplications(jobId),
      ]);
      setJob(updatedJob);
      setApplications(updatedApplications);
    } catch {
      setActionError("Failed to accept application.");
    }
  };

  const handleReleaseEscrow = async () => {
    if (!publicKey || !job) return;
    if (!job.escrowContractId) {
      setActionError("This job has no escrow contract ID.");
      return;
    }

    setReleasingEscrow(true);
    setActionError(null);

    try {
      const prepared = await buildReleaseEscrowTransaction(job.escrowContractId, job.id, publicKey);
      const { signedXDR, error: signError } = await signTransactionWithWallet(prepared.toXDR());

      if (signError || !signedXDR) {
        setActionError(signError || "Signing was cancelled.");
        return;
      }

      const { hash } = await submitSignedSorobanTransaction(signedXDR);
      await releaseEscrow(job.id, publicKey, hash);

      const refreshedJob = await fetchJob(job.id);
      setJob(refreshedJob);
      setReleaseSuccess(true);
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not complete escrow release.");
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
      setPendingRelease({ transaction: tx, fnName: "release_escrow" });
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

  const handleConfirmTimeoutRefundFee = () => {
    setPendingTimeoutRefund(null);
  };

  const handleCancelTimeoutRefundFee = () => {
    setPendingTimeoutRefund(null);
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-pulse">
        {/* Back button */}
        <div className="h-6 w-24 bg-market-500/8 rounded mb-6" />

        {/* Job detail card */}
        <div className="card space-y-6">
          {/* Status badges */}
          <div className="flex gap-2">
            <div className="h-6 w-20 bg-market-500/10 rounded-full" />
            <div className="h-6 w-16 bg-market-500/10 rounded-full" />
          </div>

          {/* Title */}
          <div className="h-10 bg-market-500/10 rounded w-3/4" />

          {/* Meta info row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex gap-3">
              <div className="h-4 w-24 bg-market-500/8 rounded" />
              <div className="h-4 w-20 bg-market-500/8 rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-16 bg-market-500/8 rounded" />
              <div className="h-8 w-32 bg-market-500/10 rounded" />
            </div>
          </div>

          {/* Description section */}
          <div className="space-y-3 pt-4 border-t border-market-500/10">
            <div className="h-5 w-32 bg-market-500/10 rounded" />
            <div className="h-4 bg-market-500/8 rounded w-full" />
            <div className="h-4 bg-market-500/8 rounded w-11/12" />
            <div className="h-4 bg-market-500/8 rounded w-5/6" />
          </div>

          {/* Skills section */}
          <div className="space-y-3 pt-4 border-t border-market-500/10">
            <div className="h-5 w-28 bg-market-500/10 rounded" />
            <div className="flex flex-wrap gap-2">
              <div className="h-7 w-20 bg-market-500/10 rounded-full" />
              <div className="h-7 w-24 bg-market-500/10 rounded-full" />
              <div className="h-7 w-16 bg-market-500/10 rounded-full" />
            </div>
          </div>

          {/* Applications section */}
          <div className="space-y-3 pt-4 border-t border-market-500/10">
            <div className="h-5 w-36 bg-market-500/10 rounded" />
            <div className="space-y-3">
              <div className="h-16 bg-market-500/8 rounded" />
              <div className="h-16 bg-market-500/8 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Use the server-resolved base URL once available so the canonical link
  // and og:url match the host the user actually requested. Fall back to the
  // build-time SITE_URL while the client bundle hydrates without SSR data.
  const baseUrl = ogBaseUrl || SITE_URL;

  /** Build the OG-image URL or a sentinel that the OG route interprets as "render the branded fallback". */
  const ogImageUrlFor = (id: string | undefined) =>
    id ? `${baseUrl}/api/og/${id}` : `${baseUrl}/api/og/missing`;

  if (!job) {
    // Even before client hydration completes, render SEO/OG meta tags from
    // the SSR snapshot so crawlers see a useful preview.
    const metaJob = ssrJob ?? null;
    const metaTitle = metaJob?.title
      ? `${metaJob.title} - Stellar MarketPay`
      : "Job - Stellar MarketPay";
    const metaDescription = truncate(metaJob?.description || "", 200);
    const metaUrl = `${baseUrl}/jobs/${metaJob?.id || ""}`;
    const metaImage = ogImageUrlFor(metaJob?.id);

    return (
      <>
        <Head>
          <title>{metaTitle}</title>
          <meta name="description" content={metaDescription} />
          <link rel="canonical" href={metaUrl} />
          <meta property="og:type" content="website" />
          <meta property="og:site_name" content="Stellar MarketPay" />
          <meta property="og:title" content={metaJob?.title || "Open job on Stellar MarketPay"} />
          <meta property="og:description" content={metaDescription} />
          <meta property="og:url" content={metaUrl} />
          <meta property="og:image" content={metaImage} />
          <meta property="og:image:secure_url" content={metaImage} />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:alt" content={`${metaJob?.title || "Job preview"} on Stellar MarketPay`} />
          <meta property="og:locale" content="en_US" />
          <meta name="twitter:card" content="summary_large_image" />
          {TWITTER_SITE_HANDLE ? (
            <meta name="twitter:site" content={TWITTER_SITE_HANDLE} />
          ) : null}
          <meta name="twitter:title" content={metaJob?.title || "Open job on Stellar MarketPay"} />
          <meta name="twitter:description" content={metaDescription} />
          <meta name="twitter:image" content={metaImage} />
          <meta name="twitter:image:alt" content={`${metaJob?.title || "Job preview"} on Stellar MarketPay`} />
        </Head>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 text-center">
          <p className="text-amber-700">Loading job…</p>
        </div>
      </>
    );
  }

  // Live job data is available — use it to populate full social meta tags
  // including the dynamic Open Graph image rendered by /api/og/[jobId].
  const ogTitle = job.title;
  const ogDescription = truncate(job.description, 200);
  const ogUrl = `${baseUrl}/jobs/${job.id}`;
  const ogImage = ogImageUrlFor(job.id);
  const ogBudget = `${formatXLM(job.budget, 2)} ${job.currency}`.trim();

  return (
    <>
      <Head>
        <title>{job.title} - Stellar MarketPay</title>
        <meta name="description" content={ogDescription} />
        <link rel="canonical" href={ogUrl} />

        {/* ── Open Graph (#487) ───────────────────────────────────────── */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Stellar MarketPay" />
        <meta property="og:title" content={ogTitle} />
        <meta property="og:description" content={ogDescription} />
        <meta property="og:url" content={ogUrl} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:secure_url" content={ogImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={`${job.title} — ${ogBudget} on Stellar MarketPay`} />
        <meta property="og:locale" content="en_US" />

        {/* ── Twitter Card (#487) ─────────────────────────────────────── */}
        <meta name="twitter:card" content="summary_large_image" />
        {TWITTER_SITE_HANDLE ? (
          <meta name="twitter:site" content={TWITTER_SITE_HANDLE} />
        ) : null}
        <meta name="twitter:title" content={ogTitle} />
        <meta name="twitter:description" content={ogDescription} />
        <meta name="twitter:image" content={ogImage} />
        <meta name="twitter:image:alt" content={`${job.title} — ${ogBudget} on Stellar MarketPay`} />
      </Head>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-amber-800 hover:text-amber-400 transition-colors mb-6 min-h-[44px]"
        >
          ← Back to Jobs
        </Link>

        {/* ── Job detail card ── */}
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
                )}
              </div>

              <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 leading-snug">
                {job.title}
              </h1>

                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex flex-wrap gap-3 text-xs sm:text-sm text-amber-700">
                    <span>Posted {timeAgo(job.createdAt)}</span>
                    <span>{applications.length} application{applications.length === 1 ? "" : "s"}</span>
                    {job.deadline && <span>Deadline: {formatDate(job.deadline)}</span>}
                  </div>

                  <div className="sm:text-right">
                    <p className="text-xs text-amber-800 mb-1">Budget</p>
                    <p className="font-mono font-bold text-xl sm:text-2xl text-market-400">{formatXLM(job.budget)} {job.currency}</p>
                    <a
                      href={accountUrl(job.clientAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-xs sm:text-sm text-amber-700 hover:text-market-400 transition-colors"
                    >
                      Client: {shortenAddress(job.clientAddress)} ↗
                    </a>
                  </div>
                </div>
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

          {actionError && (
            <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {actionError}
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

        {/* ── TimeTracker ── */}
        {(isFreelancer || isClient) && job.status === "in_progress" && (
          <TimeTracker jobId={job.id} isFreelancer={isFreelancer} isClient={isClient} />
        )}

        {/* ── Applications list (client only) ── */}
        {isClient && applications.length > 0 && (
          <div className="mb-6">
            <h2 className="font-display text-xl font-bold text-amber-100 mb-4">
              Applications ({applications.length})
            </h2>

            <div className="space-y-4">
              {applications.map((application) => (
                <div key={application.id} className="card">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-3">
                    <a
                      href={accountUrl(application.freelancerAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="address-tag hover:border-market-500/40 transition-colors break-all text-xs"
                    >
                      {shortenAddress(application.freelancerAddress)} ↗
                    </a>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <span className="font-mono text-market-400 font-semibold text-xs sm:text-sm whitespace-nowrap">
                        {formatXLM(application.bidAmount)}
                      </span>
                      <span className={`text-xs px-2.5 py-1 rounded-full border flex-shrink-0 ${badgeClass(application.status)}`}>
                        {application.status}
                      </span>
                    </div>
                  </div>

                  <p className="text-amber-700/80 text-xs sm:text-sm leading-relaxed mb-4 break-words">
                    {application.proposal}
                  </p>

                  {application.status === "pending" && job.status === "open" && (
                    <button
                      onClick={() => handleAcceptApplication(application.id)}
                      className="btn-secondary text-xs sm:text-sm py-2 px-4 min-h-[44px] flex items-center w-full sm:w-auto"
                    >
                      Accept Proposal
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Apply section (non-client, open jobs) ── */}
        {job.status === "open" && !isClient && (
          <>
            {hasApplied ? (
              <div className="card text-center py-8 border-market-500/20 mb-6">
                <div className="flex items-center justify-center gap-2 mb-1">
                  {optimisticallyApplied && !applications.some((a) => a.freelancerAddress === publicKey) && (
                    <svg className="animate-spin h-4 w-4 text-market-400" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  <p className="text-market-400 font-medium">Application submitted</p>
                </div>
                <p className="text-amber-800 text-sm">
                  The client will review your proposal shortly.
                </p>
              </div>
            ) : showApplyForm && publicKey ? (
              <ApplicationForm
                job={job}
                publicKey={publicKey}
                prefillData={prefillData}
                onOptimisticSubmit={() => setOptimisticallyApplied(true)}
                onRevert={() => setOptimisticallyApplied(false)}
                onSuccess={() => {
                  setShowApplyForm(false);
                  fetchApplications(job.id).then(setApplications);
                }}
              />
            ) : (
              <div className="text-center mb-6">
                <button
                  onClick={() => setShowApplyForm(true)}
                  className="btn-primary text-sm sm:text-base px-6 sm:px-10 py-2.5 sm:py-3.5 w-full sm:w-auto"
                >
                  Apply for this Job
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Escrow timeout countdown + refund UI ── */}
        {job.escrowContractId && timeoutLedger && job.status !== "completed" && job.status !== "cancelled" && (
          <div className="card mb-6">
            <h2 className="font-display text-lg font-bold text-amber-100 mb-3">Escrow Timeout</h2>

            {timeoutRefundSuccess ? (
              <div>
                <p className="text-market-400 font-medium">Timeout refund processed successfully.</p>
              </div>
            ) : timeoutCountdown && currentLedger < timeoutLedger ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-amber-700">Auto-refund available in:</span>
                <span className="font-mono text-sm text-market-400 bg-market-500/8 px-3 py-1 rounded border border-market-500/15">
                  {timeoutCountdown}
                </span>
              </div>
            ) : isClient && currentLedger >= timeoutLedger ? (
              <div>
                <p className="text-sm text-red-400 mb-3">
                  The freelancer did not start work within the timeout period. You can claim a refund.
                </p>
                <WalletConnect onConnect={onConnect} />
              </div>
            ) : (
              <p className="text-sm text-amber-700">
                Timeout period has expired. Only the client can claim a refund.
              </p>
            )}
          </div>
        )}

        {/* ── Escrow release (client, in_progress) ── */}
        {isClient && job.status === "in_progress" && (
          <div className="card mb-6">
            <h2 className="font-display text-lg sm:text-xl font-bold text-amber-100 mb-3">
              Escrow
            </h2>

            <button
              onClick={handleReleaseEscrow}
              disabled={releasingEscrow}
              className="btn-primary w-full sm:w-auto"
            >
              {releasingEscrow ? "Releasing..." : "Release Escrow"}
            </button>

            {releaseSuccess && (
              <p className="mt-3 text-emerald-400 text-sm">Escrow released successfully.</p>
            )}
          </div>
        )}

        {actionError && (
          <p className="mt-3 mb-6 text-red-400 text-sm">{actionError}</p>
        )}

        {/* ── Rating form (after completion) ── */}
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

      {/* ── Modals ── */}
      {showShareModal && (
        <ShareJobModal job={job} onClose={() => setShowShareModal(false)} />
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

      {/* ── Dispute modal ── */}
      {showDisputeModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => setShowDisputeModal(false)} />
          <div className="relative w-full max-w-md bg-ink-900 border border-market-500/20 rounded-2xl p-4 sm:p-6 shadow-2xl animate-scale-in max-h-[90vh] overflow-y-auto">
            <h3 className="font-display text-lg sm:text-xl font-bold text-amber-100 mb-2">Raise a Dispute</h3>
            <p className="text-xs sm:text-sm text-amber-800 mb-6">Flag this job for admin review. This will block escrow release until resolved.</p>
            
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
                  rows={3}
                  className="textarea-field"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mt-6 sm:mt-8">
              <button
                onClick={() => setShowDisputeModal(false)}
                className="btn-secondary text-sm py-2.5"
                disabled={raisingDispute}
              >
                Cancel
              </button>
              <button
                onClick={handleRaiseDispute}
                className="btn-primary text-sm py-2.5 flex items-center justify-center gap-2"
                disabled={raisingDispute || !disputeReason || !disputeDescription}
              >
                {raisingDispute ? <Spinner /> : "Raise Dispute"}
              </button>
            </div>
            {actionError && (
              <p className="mt-3 text-red-400 text-xs sm:text-sm text-center">{actionError}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
