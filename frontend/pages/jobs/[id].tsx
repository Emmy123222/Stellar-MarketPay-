import TimeTracker from "@/components/TimeTracker";
import FeeEstimationModal from "@/components/FeeEstimationModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useCallback, useEffect, useState } from "react";
import { useRealtimeBids } from "@/hooks/useRealtimeBids";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import type { GetServerSideProps } from "next";
import ApplicationForm from "@/components/ApplicationForm";
import WalletConnect from "@/components/WalletConnect";
import RatingForm from "@/components/RatingForm";
import ShareJobModal from "@/components/ShareJobModal";
import { usePriceContext } from "@/contexts/PriceContext";
import {
  fetchJob,
  fetchApplications,
  acceptApplication,
  releaseEscrow,
  raiseDispute,
  inviteFreelancer,
  mintCompletionCertificate,
  fetchNftCertificateByJob,
  submitDeliverableHash,
} from "@/lib/api";
import {
  formatXLM,
  formatDate,
  timeAgo,
  shortenAddress,
  statusLabel,
  statusClass,
  formatUSDEquivalent,
} from "@/utils/format";
import {
  accountUrl,
  buildReleaseEscrowTransaction,
  buildMintCertificateTx,
  submitSignedSorobanTransaction,
  buildPartialReleaseTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { optionalClientEnv } from "@/lib/env";
import type { Transaction } from "@stellar/stellar-sdk";
import type { Application, Job } from "@/utils/types";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import RealtimeBidComparison from "@/components/RealtimeBidComparison";

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
  Pick<JobDetailProps, "ssrJob" | "ogBaseUrl">
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
    const ssrJob: JobDetailProps["ssrJob"] = {
      id: String(data.id),
      title: String(data.title || ""),
      description: String(data.description || ""),
      category: String(data.category || ""),
      budget: String(data.budget || ""),
      currency: String(data.currency || "XLM") as Job["currency"],
      status: String(data.status || "open") as Job["status"],
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
  const { xlmPriceUsd } = usePriceContext();
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
  const [mintingCertificate, setMintingCertificate] = useState(false);
  const [certificateMinted, setCertificateMinted] = useState(false);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
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
  // Invite freelancer state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteFreelancerAddress, setInviteFreelancerAddress] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const { addRecentJob } = useRecentlyViewed();

  const isClient = Boolean(publicKey && job?.clientAddress === publicKey);
  const isFreelancer = Boolean(publicKey && job?.freelancerAddress === publicKey);
  const hasApplied = optimisticallyApplied || applications.some((a) => a.freelancerAddress === publicKey);

  // ── fetchApplications wrapper for useRealtimeBids ────────────────────────
  const fetchAppsForJob = useCallback(async (): Promise<Application[]> => {
    if (!jobId) return [];
    try {
      return await fetchApplications(jobId);
    } catch {
      return [];
    }
  }, [jobId]);

  // ── Real-time bids via useRealtimeBids ───────────────────────────────────
  const {
    applications: realtimeApplications,
  } = useRealtimeBids({
    jobId: jobId ?? "",
    initialApplications: applications,
    fetchApplications: fetchAppsForJob,
  });

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
        addRecentJob(jobId);
      })
      .catch(() => router.push("/jobs"))
      .finally(() => setLoading(false));
  }, [jobId, router.isReady, router, addRecentJob]);

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

      // AC: After escrow release, mint a proof-of-work NFT certificate for
      // the freelancer. The client signs the mint transaction with their
      // wallet (the contract requires client auth), then the backend records
      // it so it can be rendered and shared via URL.
      await handleMintCertificate();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not complete escrow release.");
    } finally {
      setReleasingEscrow(false);
    }
  };

  /**
   * Build + sign + submit the on-chain `mint_certificate` Soroban call and
   * record the certificate in the backend. Safe to call standalone (retry)
   * or chained after a successful escrow release.
   */
  const handleMintCertificate = async () => {
    if (!publicKey || !job) return;
    if (!job.escrowContractId) {
      setCertificateError("This job has no escrow contract ID, so a certificate cannot be minted.");
      return;
    }

    setMintingCertificate(true);
    setCertificateError(null);

    try {
      const prepared = await buildMintCertificateTx(job.escrowContractId, job.id, job.title, publicKey);
      const { signedXDR, error: signError } = await signTransactionWithWallet(prepared.toXDR());

      if (signError || !signedXDR) {
        setCertificateError(signError || "Signing was cancelled.");
        return;
      }

      const { hash } = await submitSignedSorobanTransaction(signedXDR);
      await mintCompletionCertificate({
        jobId: job.id,
        clientAddress: publicKey,
        contractTxHash: hash,
      });
      setCertificateMinted(true);
    } catch (error: unknown) {
      setCertificateError(
        error instanceof Error ? error.message : "Could not mint the completion certificate.",
      );
    } finally {
      setMintingCertificate(false);
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

  // On load, if the job is already completed, check whether a certificate was
  // previously minted so returning visitors see the shareable link instead of
  // a (client-only) mint button.
  useEffect(() => {
    if (!jobId || !job || job.status !== "completed") return;
    let cancelled = false;
    fetchNftCertificateByJob(jobId)
      .then(() => {
        if (!cancelled) setCertificateMinted(true);
      })
      .catch(() => {
        // No certificate yet (404) or backend unavailable — treat as unminted.
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, job?.status]);

  const handleInviteFreelancer = async () => {
    if (!publicKey || !job) return;
    if (!inviteFreelancerAddress || !/^G[A-Z0-9]{55}$/.test(inviteFreelancerAddress)) {
      setInviteError("Please enter a valid Stellar public key (starts with G, 56 characters)");
      return;
    }

    setInviting(true);
    setInviteError(null);

    try {
      await inviteFreelancer(job.id, inviteFreelancerAddress);
      setShowInviteModal(false);
      setInviteFreelancerAddress("");
    } catch (e: any) {
      setInviteError(e.response?.data?.error || "Failed to invite freelancer.");
    } finally {
      setInviting(false);
    }
  };

  const handleConfirmTimeoutRefundFee = (_details: { maxFeeMultiplier: number; maxFeeStroops: bigint }) => {
    console.debug(
      `[FeeEstimationModal] User confirmed with maxFeeMultiplier=${_details.maxFeeMultiplier}, maxFeeStroops=${_details.maxFeeStroops.toString()}`
    );
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
                    <span>{realtimeApplications.length} application{realtimeApplications.length === 1 ? "" : "s"}</span>
                    {job.deadline && <span>Deadline: {formatDate(job.deadline)}</span>}
                  </div>

                  <div className="sm:text-right">
                    <p className="text-xs text-amber-800 mb-1">Budget</p>
                    <p className="font-mono font-bold text-xl sm:text-2xl text-market-400">{formatXLM(job.budget)} {job.currency}</p>
                    {xlmPriceUsd !== null && (
                      <p className="text-xs text-amber-700 mt-1">
                        {formatUSDEquivalent(job.budget, xlmPriceUsd)}
                      </p>
                    )}
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

          <div className="mt-5 flex gap-4">
            <button
              onClick={() => setShowShareModal(true)}
              className="text-xs text-market-400 hover:text-market-300 underline"
            >
              Share job
            </button>
            {isClient && job.visibility === "invite_only" && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="text-xs text-market-400 hover:text-market-300 underline"
              >
                Invite freelancer
              </button>
            )}
          </div>
        </div>

        {/* ── TimeTracker ── */}
        {(isFreelancer || isClient) && job.status === "in_progress" && (
          <TimeTracker jobId={job.id} isFreelancer={isFreelancer} isClient={isClient} />
        )}

        {/* ── Applications list (client only, real-time via RealtimeBidComparison) ── */}
        {isClient && (
          <div className="mb-6">
            <RealtimeBidComparison
              jobId={job.id}
              initialApplications={applications}
              isClient={isClient}
              fetchApplications={fetchAppsForJob}
              onAcceptApplication={handleAcceptApplication}
            />
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
              onClick={() => setShowReleaseConfirm(true)}
              disabled={releasingEscrow}
              className="btn-primary w-full sm:w-auto"
            >
              {releasingEscrow ? "Releasing..." : "Release Escrow"}
            </button>

            <ConfirmDialog
              open={showReleaseConfirm}
              title="Release Escrow"
              description="This will release all escrowed funds to the freelancer. This is an irreversible on-chain action."
              confirmLabel="Yes, Release Escrow"
              variant="danger"
              requireTypedConfirm
              typedConfirmText="CONFIRM"
              actionDetails={`Job: ${job?.title || ""} · Amount: ${job?.budget || ""} ${job?.currency || ""}`}
              onConfirm={handleReleaseEscrow}
              onCancel={() => setShowReleaseConfirm(false)}
              loading={releasingEscrow}
            />

            {releaseSuccess && (
              <p className="mt-3 text-emerald-400 text-sm">Escrow released successfully.</p>
            )}
          </div>
        )}

        {/* ── Submit Deliverable Hash (freelancer, in_progress) ── */}
        {isFreelancer && job.status === "in_progress" && (
          <div className="card mb-6">
            <h2 className="font-display text-lg sm:text-xl font-bold text-amber-100 mb-3">
              Submit Deliverable
            </h2>
            <p className="text-sm text-amber-700 mb-4">
              Submit the SHA-256 hash of your completed deliverable.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const hash = formData.get("deliverableHash") as string;
                if (!hash || !publicKey) return;
                try {
                  setActionError(null);
                  await submitDeliverableHash(job.id, publicKey, hash);
                  alert("Deliverable hash submitted successfully.");
                  (e.target as HTMLFormElement).reset();
                } catch (err: any) {
                  setActionError(err.response?.data?.error || err.message || "Failed to submit hash.");
                }
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                name="deliverableHash"
                placeholder="64-character hex string (SHA-256)"
                className="input-field flex-1"
                pattern="^[0-9a-fA-F]{64}$"
                required
              />
              <button type="submit" className="btn-primary">
                Submit
              </button>
            </form>
          </div>
        )}

        {actionError && (
          <p className="mt-3 mb-6 text-red-400 text-sm">{actionError}</p>
        )}

        {/* ── Proof-of-work certificate (after completion) ── */}
        {job.status === "completed" && publicKey && (
          <div className="card mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl" aria-hidden="true">🏅</span>
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-bold text-amber-100">
                    Proof-of-Work Certificate
                  </h2>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Minted as an on-chain Soroban NFT to the freelancer when the escrow was released.
                  </p>
                </div>
              </div>

              {certificateMinted ? (
                <Link
                  href={`/certificates/job/${job.id}`}
                  className="btn-primary text-sm whitespace-nowrap text-center"
                >
                  View Certificate ↗
                </Link>
              ) : isClient ? (
                <button
                  onClick={handleMintCertificate}
                  disabled={mintingCertificate}
                  className="btn-primary text-sm whitespace-nowrap"
                >
                  {mintingCertificate ? "Minting certificate…" : "Mint Certificate"}
                </button>
              ) : (
                <p className="text-xs text-amber-800 text-right">
                  The client mints the certificate when they release the escrow.
                </p>
              )}
            </div>

            {mintingCertificate && (
              <p className="mt-3 text-market-400 text-sm flex items-center gap-2">
                <Spinner /> Sign the mint transaction in your wallet to award the certificate…
              </p>
            )}
            {certificateError && (
              <p className="mt-3 text-red-400 text-sm">{certificateError}</p>
            )}
            {certificateMinted && (
              <p className="mt-3 text-emerald-400 text-sm">
                Certificate minted successfully — share it with anyone via its public URL.
              </p>
            )}
          </div>
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
          <button
            type="button"
            aria-label="Close dispute dialog"
            className="absolute inset-0 w-full bg-ink-950/80 backdrop-blur-sm cursor-default"
            onClick={() => setShowDisputeModal(false)}
          />
          <div className="relative w-full max-w-md bg-ink-900 border border-market-500/20 rounded-2xl p-4 sm:p-6 shadow-2xl animate-scale-in max-h-[90vh] overflow-y-auto">
            <h3 className="font-display text-lg sm:text-xl font-bold text-amber-100 mb-2">Raise a Dispute</h3>
            <p className="text-xs sm:text-sm text-amber-800 mb-6">Flag this job for admin review. This will block escrow release until resolved.</p>

            <div className="space-y-4">
              <div>
                <label htmlFor="reason" className="label">Reason</label>
                <select id="reason"
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
                <label htmlFor="description" className="label">Description</label>
                <textarea id="description"
                  value={disputeDescription}
                  onChange={(e) => setDisputeDescription(e.target.value)}
                  className="input-field min-h-[100px]"
                  placeholder="Describe the issue in detail..."
                />
              </div>
            </div>

            {actionError && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {actionError}
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowDisputeModal(false)}
                className="btn-secondary flex-1 text-xs sm:text-sm py-2.5 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleRaiseDispute}
                disabled={raisingDispute}
                className="btn-primary flex-1 text-xs sm:text-sm py-2.5 min-h-[44px]"
              >
                {raisingDispute ? "Submitting..." : "Raise Dispute"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Freelancer modal ── */}
      {showInviteModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close invite dialog"
            className="absolute inset-0 w-full bg-ink-950/80 backdrop-blur-sm cursor-default"
            onClick={() => setShowInviteModal(false)}
          />
          <div className="relative w-full max-w-md bg-ink-900 border border-market-500/20 rounded-2xl p-4 sm:p-6 shadow-2xl animate-scale-in">
            <h3 className="font-display text-lg sm:text-xl font-bold text-amber-100 mb-2">Invite Freelancer</h3>
            <p className="text-xs sm:text-sm text-amber-800 mb-6">Enter the freelancer&apos;s Stellar public key to invite them to this job.</p>

            <div className="space-y-4">
              <div>
                <label htmlFor="freelancer-public-key" className="label">Freelancer Public Key</label>
                <input id="freelancer-public-key"
                  type="text"
                  value={inviteFreelancerAddress}
                  onChange={(e) => setInviteFreelancerAddress(e.target.value)}
                  className="input-field"
                  placeholder="G..."
                  maxLength={56}
                />
                <p className="text-xs text-amber-800 mt-1">Must start with G and be 56 characters long</p>
              </div>
            </div>

            {inviteError && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {inviteError}
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteFreelancerAddress("");
                  setInviteError(null);
                }}
                className="btn-secondary flex-1 text-xs sm:text-sm py-2.5 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleInviteFreelancer}
                disabled={inviting}
                className="btn-primary flex-1 text-xs sm:text-sm py-2.5 min-h-[44px]"
              >
                {inviting ? "Inviting..." : "Send Invitation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
