/**
 * pages/freelancers/[username].tsx
 * Public developer portfolio (Issue #1553) — read-only, entirely public.
 *
 * Reachable without authentication: the page never wraps itself in an
 * auth guard, tolerates a null/unauthenticated `publicKey` session, and
 * never force-redirects a guest visitor.
 *
 * The [username] param accepts either a Stellar account id (how every
 * in-app link is built) or a display-name slug such as /freelancers/jane-doe.
 *
 * Privacy guard: the "Verified work history" section maps over the
 * freelancer's completed jobs and renders a record ONLY when that job's own
 * escrow record carries `client_consent_public === true`. Missing or
 * unreachable escrow records fail closed, so nothing is ever exposed
 * without explicit client consent.
 */
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { mutate } from "swr";
import FreelancerTierBadge from "@/components/FreelancerTierBadge";
import ReputationBadge from "@/components/ReputationBadge";
import FreelancerProfileSkeleton from "@/components/FreelancerProfileSkeleton";
import StateMessage from "@/components/StateMessage";
import { useToast } from "@/components/Toast";
import { useApi } from "@/hooks/useApi";
import {
  endorseSkill,
  fetchEscrow,
  fetchFreelancerEarnings,
  fetchFreelancerNftCertificates,
  fetchProfiles,
  fetchPublicProfile,
  fetchRatings,
  fetchSkillBadges,
  fetchSkillEndorsements,
  fetchUserCertificates,
  verifyIdentity,
  type CertificateData,
  type EarningPayment,
  type NftCertificateData,
} from "@/lib/api";
import { accountUrl, explorerUrl, isValidStellarAddress } from "@/lib/stellar";
import {
  availabilityBadgeClass,
  availabilityStatusLabel,
  availabilitySummary,
  formatXLM,
  shortenAddress,
} from "@/utils/format";
import type {
  PortfolioItem,
  Rating,
  SkillBadge,
  SkillEndorsement,
  UserProfile,
} from "@/utils/types";

// ─── Data helpers ───────────────────────────────────────────────────────────

/** Newest-first cap so a very long history can't trigger a request storm. */
const WORK_HISTORY_SCAN_LIMIT = 20;

/**
 * Subset of the escrow row returned by GET /api/escrow/:jobId.
 * `client_consent_public` is the flag that gates public rendering of a job.
 */
interface EscrowRecord {
  job_id?: string;
  status?: string;
  amount_xlm?: string;
  client_consent_public?: boolean;
}

function slugifyDisplayName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Resolve the [username] route param to a profile payload.
 * Accepts a Stellar account id (how in-app links are built) or a
 * display-name slug resolved against the freelancer directory.
 */
async function fetchPortfolioProfile(
  username: string,
): Promise<UserProfile | null> {
  if (isValidStellarAddress(username)) {
    return fetchPublicProfile(username);
  }

  const { profiles } = await fetchProfiles({
    role: "freelancer",
    search: username,
    limit: 20,
  });

  const wanted = username.toLowerCase();
  return (
    profiles.find(
      (candidate) => candidate.displayName?.trim().toLowerCase() === wanted,
    ) ??
    profiles.find(
      (candidate) =>
        candidate.displayName != null &&
        slugifyDisplayName(candidate.displayName) === wanted,
    ) ??
    null
  );
}

/**
 * Historical completed jobs joined with their on-chain escrow records,
 * filtered through the strict privacy guard: a job is returned ONLY when
 * its own escrow record explicitly sets `client_consent_public === true`.
 * Missing or unreachable escrow records fail closed (job stays hidden).
 */
async function fetchConsentedWorkHistory(
  publicKey: string,
): Promise<EarningPayment[]> {
  const earnings = await fetchFreelancerEarnings(publicKey);
  const payments = earnings.payments ?? [];

  const joined = await Promise.all(
    payments.slice(0, WORK_HISTORY_SCAN_LIMIT).map(async (payment) => {
      const escrow: EscrowRecord | null = await fetchEscrow(
        payment.jobId,
      ).catch(() => null);
      return { payment, escrow };
    }),
  );

  return joined
    .filter(({ escrow }) => escrow?.client_consent_public === true)
    .map(({ payment }) => payment);
}

// ─── Portfolio helpers ──────────────────────────────────────────────────────

function getPortfolioHref(item: PortfolioItem) {
  if (item.type === "stellar_tx") {
    return `https://stellar.expert/explorer/public/tx/${encodeURIComponent(item.url)}`;
  }
  return item.url;
}

function getPortfolioTypeLabel(item: PortfolioItem) {
  switch (item.type) {
    case "github":
      return "GitHub Repo";
    case "live":
      return "Live URL";
    case "stellar_tx":
      return "Stellar Proof";
    default:
      return "Portfolio";
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function PublicDeveloperPortfolioPage({
  publicKey,
}: {
  /** Connected wallet — may be null for public/guest visitors. */
  publicKey: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [verifying, setVerifying] = useState(false);
  const [endorsingSkill, setEndorsingSkill] = useState<string | null>(null);

  const rawParam = router.query.username;
  const username = typeof rawParam === "string" ? rawParam.trim() : "";

  // Cache keys stay null until the route has hydrated, so guest sessions
  // and SSR renders never trigger a fetch, throw, or redirect.
  const profileKey =
    router.isReady && username ? `portfolio:profile:${username}` : null;
  const { data: profile, error: profileError } = useApi<UserProfile | null>(
    profileKey,
    () => fetchPortfolioProfile(username),
  );

  const profileAddress = profile?.publicKey ?? null;
  const isOwner = Boolean(
    publicKey && profileAddress && publicKey === profileAddress,
  );

  const { data: endorsements = [] } = useApi<SkillEndorsement[]>(
    profileAddress ? `portfolio:endorsements:${profileAddress}` : null,
    () => fetchSkillEndorsements(profileAddress!),
  );
  const { data: allBadges = [] } = useApi<SkillBadge[]>(
    profileAddress ? `portfolio:badges:${profileAddress}` : null,
    () => fetchSkillBadges(profileAddress!),
  );
  const badges = allBadges.filter((badge) => badge.passed);
  const { data: skillCertificates = [] } = useApi<CertificateData[]>(
    profileAddress ? `portfolio:certificates:${profileAddress}` : null,
    () => fetchUserCertificates(profileAddress!),
  );
  const { data: ratings = [] } = useApi<Rating[]>(
    profileAddress ? `portfolio:ratings:${profileAddress}` : null,
    () => fetchRatings(profileAddress!),
  );
  const { data: nftCertificates = [] } = useApi<NftCertificateData[]>(
    profileAddress ? `portfolio:nft-certificates:${profileAddress}` : null,
    () => fetchFreelancerNftCertificates(profileAddress!),
  );
  const { data: workHistory = [] } = useApi<EarningPayment[]>(
    profileAddress ? `portfolio:work-history:${profileAddress}` : null,
    () => fetchConsentedWorkHistory(profileAddress!),
  );

  // ── Load-state derivation (guest-safe: no auth redirect, no throw) ──
  const routeMissing = router.isReady && !username;
  const notFound = routeMissing || (profileKey !== null && profile === null);
  const loadError =
    profile === undefined && profileError != null ? profileError : null;
  const loading =
    !router.isReady ||
    (!routeMissing &&
      profileKey !== null &&
      profile === undefined &&
      profileError == null);

  const handleVerifyIdentity = async () => {
    if (!profileAddress || !profileKey) return;
    setVerifying(true);
    try {
      // Mocking DID verification flow (e.g. SpruceID/Rebase)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const mockDidHash = `did:pkh:stellar:${profileAddress}#marketpay-kyc-${Date.now()}`;
      const updatedProfile = await verifyIdentity(profileAddress, mockDidHash);
      await mutate(profileKey, updatedProfile, { revalidate: false });
    } catch (error) {
      console.error("Verification error:", error);
    } finally {
      setVerifying(false);
    }
  };

  const handleEndorse = async (skill: string) => {
    if (!publicKey || !profileAddress || isOwner) return;
    setEndorsingSkill(skill);
    try {
      await endorseSkill(profileAddress, skill);
      await mutate(`portfolio:endorsements:${profileAddress}`);
    } catch (error: unknown) {
      console.error("Endorsement error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to endorse skill",
      );
    } finally {
      setEndorsingSkill(null);
    }
  };

  const displayName = profile?.displayName?.trim() ?? "";

  // ── OpenGraph / social-preview meta ──
  const titleBase = useMemo(() => {
    if (displayName) {
      return `${displayName} · Developer Portfolio | Stellar MarketPay`;
    }
    if (profileAddress) {
      return `${shortenAddress(profileAddress)} · Developer Portfolio | Stellar MarketPay`;
    }
    if (username) {
      return `${username} · Developer Portfolio | Stellar MarketPay`;
    }
    return "Developer Portfolio · Stellar MarketPay";
  }, [displayName, profileAddress, username]);

  const metaDescription = useMemo(() => {
    const bio = profile?.bio?.trim();
    if (bio) return bio.length > 160 ? `${bio.slice(0, 157)}...` : bio;
    const name =
      displayName ||
      (profileAddress ? shortenAddress(profileAddress) : "This developer");
    return `${name}'s verified work history, skills, and on-chain certificates on Stellar MarketPay.`;
  }, [profile, displayName, profileAddress]);

  const ogImage = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(
    profileAddress || username || "marketpay",
  )}`;

  // ── Average platform review rating ──
  const ratingAverage = useMemo(() => {
    if (profile?.rating != null) return profile.rating;
    if (ratings.length > 0) {
      return (
        ratings.reduce((sum, rating) => sum + rating.stars, 0) / ratings.length
      );
    }
    return null;
  }, [profile?.rating, ratings]);
  const ratingCount = profile?.ratingCount ?? ratings.length;

  const explorerHref = profileAddress ? accountUrl(profileAddress) : "#";

  return (
    <>
      <Head>
        <title>{titleBase}</title>
        <meta name="description" content={metaDescription} />
        {/* OpenGraph card — rich preview when the portfolio URL is shared */}
        <meta property="og:title" content={titleBase} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="profile" />
        <meta property="og:image" content={ogImage} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={titleBase} />
        <meta name="twitter:description" content={metaDescription} />
      </Head>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 animate-fade-in">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1.5 text-sm text-amber-800 hover:text-amber-400 transition-colors mb-6 sm:mb-8"
        >
          ← Back to Jobs
        </Link>

        {loading && <FreelancerProfileSkeleton />}

        {!loading && routeMissing && (
          <div className="card border-market-500/20 text-center py-12 sm:py-16">
            <p className="font-display text-xl text-amber-100 mb-2">
              Profile not found
            </p>
            <p className="text-amber-800 text-sm max-w-md mx-auto mb-6">
              This URL does not reference a developer profile. Check the link
              and try again.
            </p>
            <Link href="/jobs" className="btn-secondary text-sm inline-flex">
              Browse jobs
            </Link>
          </div>
        )}

        {!loading && !routeMissing && notFound && (
          <div className="card border-market-500/20 text-center py-12 sm:py-16">
            <p className="font-display text-xl text-amber-100 mb-2">
              Profile not found
            </p>
            <p className="text-amber-800 text-sm max-w-md mx-auto mb-6">
              No profile exists for this username or wallet yet. The developer
              may not have set up their profile.
            </p>
            <Link href="/jobs" className="btn-secondary text-sm inline-flex">
              Browse jobs
            </Link>
          </div>
        )}

        {!loading && loadError && (
          <div className="space-y-4">
            <FreelancerProfileSkeleton />
            <div className="text-center">
              <p className="text-red-400/90 text-sm max-w-md mx-auto mb-2">
                {loadError.message || "Could not load profile."}
              </p>
              <button
                onClick={() => {
                  if (profileKey) mutate(profileKey);
                }}
                className="btn-primary text-sm"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {!loading && !loadError && profile && (
          <article className="card border-market-500/15 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6 mb-6">
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 break-words">
                  {displayName || shortenAddress(profile.publicKey)}
                </h1>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <ReputationBadge userId={profile.publicKey} size="md" />
                  <FreelancerTierBadge
                    tier={profile.tier}
                    className="text-sm"
                  />
                  {profile.isKycVerified && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold uppercase tracking-wider">
                      <svg
                        className="w-3 h-3"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M2.166 4.9l7.19-3.17c.41-.18.88-.18 1.28 0l7.19 3.17c.43.19.71.63.71 1.1v3.47c0 4.35-2.52 8.35-6.39 10.15-.36.17-.77.17-1.13 0-3.87-1.8-6.39-5.8-6.39-10.15V6c0-.47.28-.91.71-1.1zM10 5a1 1 0 10-2 0v4H7a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V5z"
                          clipRule="evenodd"
                        />
                      </svg>
                      KYC Verified
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-amber-800 mt-2 font-mono break-all">
                  {profile.publicKey}
                </p>
              </div>
              <div className="flex flex-col sm:items-end gap-2 shrink-0 w-full sm:w-auto">
                <a
                  href={explorerHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-sm w-full sm:w-auto text-center"
                >
                  View on Stellar Expert →
                </a>
                {isOwner && !profile.isKycVerified && (
                  <button
                    onClick={handleVerifyIdentity}
                    disabled={verifying}
                    className="btn-primary text-sm w-full sm:w-auto flex items-center justify-center gap-2"
                  >
                    {verifying ? (
                      <>
                        <svg
                          className="animate-spin h-4 w-4"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Verifying...
                      </>
                    ) : (
                      "Verify Identity (DID)"
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="mb-6 sm:mb-8 rounded-xl border border-market-500/15 bg-ink-900/50 p-4">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h2 className="label !mb-0">Availability</h2>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full border ${availabilityBadgeClass(
                    profile.availability?.status,
                  )}`}
                >
                  {availabilityStatusLabel(profile.availability?.status)}
                </span>
              </div>
              <p className="text-sm text-amber-700/90">
                {availabilitySummary(profile.availability) ||
                  "Availability has not been set yet."}
              </p>
            </div>

            {profile.bio?.trim() ? (
              <div className="mb-6 sm:mb-8">
                <h2 className="label mb-2">Bio</h2>
                <p className="text-amber-700/90 text-sm sm:text-base leading-relaxed whitespace-pre-wrap">
                  {profile.bio.trim()}
                </p>
              </div>
            ) : (
              <p className="text-amber-900/80 text-sm italic mb-6 sm:mb-8">
                No bio yet.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Completed jobs</p>
                <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                  {profile.completedJobs ?? 0}
                </p>
              </div>
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Total earned</p>
                <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                  {formatXLM(profile.totalEarnedXLM ?? "0")}
                </p>
              </div>
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Freelancer tier</p>
                <FreelancerTierBadge tier={profile.tier} className="mt-2" />
              </div>
              {ratingAverage == null ? (
                <StateMessage
                  type="empty"
                  title="No reviews yet"
                  description="Be the first to hire this freelancer"
                  ctaLabel="Hire now"
                  onCta={() => router.push(`/jobs?search=${profile.publicKey}`)}
                />
              ) : (
                <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                  <p className="label mb-1">Average rating</p>
                  <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                    {ratingAverage.toFixed(2)}
                  </p>
                  {ratingCount > 0 && (
                    <p className="text-xs text-amber-800 mt-1">
                      {ratingCount} review{ratingCount !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              )}
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Success rate</p>
                <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                  {profile.completedJobs || 0} completed
                </p>
              </div>
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Avg. completion</p>
                <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                  —
                </p>
                <p className="text-[10px] uppercase tracking-wider text-amber-800 mt-1">
                  Acceptance to release
                </p>
              </div>
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Referrals</p>
                <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                  {profile.referralCount ?? 0}
                </p>
              </div>
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Reputation Bonus</p>
                <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                  +{profile.reputationPoints ?? 0}
                </p>
              </div>
            </div>

            <div className="mb-6 sm:mb-8">
              <h2 className="label mb-3">Skills</h2>
              {profile.skills && profile.skills.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {profile.skills.map((skill) => {
                    const end = endorsements.find((e) => e.skill === skill);
                    const count = end?.count ?? 0;
                    return (
                      <li
                        key={skill}
                        className="group relative inline-flex items-center gap-2 text-sm bg-market-500/10 text-market-300/90 border border-market-500/20 px-3 py-1.5 rounded-full"
                      >
                        <span>{skill}</span>
                        {count > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-market-400/80 bg-market-500/10 border border-market-500/20 rounded-full px-1.5 py-0.5">
                            <svg
                              className="w-3 h-3"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                              aria-hidden="true"
                            >
                              <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                            </svg>
                            {count}
                          </span>
                        )}
                        {publicKey && !isOwner && (
                          <button
                            onClick={() => handleEndorse(skill)}
                            disabled={endorsingSkill === skill}
                            className="inline-flex items-center gap-0.5 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full px-2 py-0.5 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                            aria-label={`Endorse ${skill}`}
                          >
                            {endorsingSkill === skill ? (
                              <svg
                                className="w-3 h-3 animate-spin"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                  fill="none"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                />
                              </svg>
                            ) : (
                              <svg
                                className="w-3 h-3"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                                aria-hidden="true"
                              >
                                <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                              </svg>
                            )}
                            Endorse
                          </button>
                        )}
                        {end && end.endorsers.length > 0 && (
                          <div className="absolute left-0 -top-2 -translate-y-full w-56 bg-ink-900 border border-market-500/20 rounded-lg shadow-lg p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 pointer-events-none">
                            <p className="text-xs text-amber-800 mb-1 font-semibold">
                              Endorsed by
                            </p>
                            <ul className="space-y-1">
                              {end.endorsers.slice(0, 5).map((addr) => (
                                <li
                                  key={addr}
                                  className="text-xs text-amber-700/90 font-mono truncate"
                                >
                                  {shortenAddress(addr)}
                                </li>
                              ))}
                              {end.endorsers.length > 5 && (
                                <li className="text-xs text-amber-800 italic">
                                  +{end.endorsers.length - 5} more
                                </li>
                              )}
                            </ul>
                            <div className="absolute left-4 -bottom-1 w-2 h-2 bg-ink-900 border-b border-r border-market-500/20 rotate-45" />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-amber-900/80 text-sm italic">
                  No skills listed yet.
                </p>
              )}
            </div>

            {/* Verified skill badges */}
            {badges.length > 0 && (
              <div className="mb-6 sm:mb-8">
                <h2 className="label mb-3">Verified Skills</h2>
                <ul className="flex flex-wrap gap-2">
                  {badges.map((badge) => {
                    const cert = skillCertificates.find(
                      (c) =>
                        c.skill.toLowerCase() === badge.skill.toLowerCase(),
                    );
                    return (
                      <li key={badge.skill} className="relative group">
                        <span className="inline-flex items-center gap-1.5 text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-3 py-1.5 rounded-full">
                          ✓{" "}
                          {badge.skill.charAt(0).toUpperCase() +
                            badge.skill.slice(1)}
                        </span>
                        {/* Score tooltip */}
                        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-ink-900 border border-market-500/20 px-2.5 py-1 text-xs text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10">
                          Score: {badge.score}% ·{" "}
                          {new Date(badge.taken_at).toLocaleDateString()}
                          {cert && (
                            <>
                              <br />
                              <a
                                href={`/certificates/${cert.id}`}
                                className="text-market-400 underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                View Certificate
                              </a>
                            </>
                          )}
                        </span>
                        {cert && (
                          <Link
                            href={`/certificates/${cert.id}`}
                            className="ml-1 inline-flex items-center text-[10px] text-market-400 hover:text-market-300 underline"
                          >
                            Verify
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="mb-6 sm:mb-8">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="label">Portfolio</h2>
                <p className="text-xs text-amber-800">
                  {(profile.portfolioItems || []).length}/10
                </p>
              </div>

              {profile.portfolioItems && profile.portfolioItems.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {profile.portfolioItems.map((item, index) => (
                    <a
                      key={`${item.type}-${item.url}-${index}`}
                      href={getPortfolioHref(item)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border border-market-500/15 bg-ink-900/50 p-4 hover:border-market-400/40 hover:bg-ink-900/70 transition-colors"
                    >
                      <p className="text-xs uppercase tracking-[0.18em] text-market-300/80 mb-2">
                        {getPortfolioTypeLabel(item)}
                      </p>
                      <h3 className="text-amber-100 font-medium text-base break-words mb-2">
                        {item.title}
                      </h3>
                      <p className="text-sm text-amber-700/90 break-all">
                        {item.type === "stellar_tx"
                          ? item.url
                          : getPortfolioHref(item)}
                      </p>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-amber-900/80 text-sm italic">
                  No portfolio items yet.
                </p>
              )}
            </div>

            {/* Verified on-chain work history — client consent required (Issue #1553) */}
            <div className="mt-6 sm:mt-8">
              <h2 className="label mb-3">Verified work history</h2>
              {workHistory.length > 0 ? (
                <ul className="space-y-3">
                  {workHistory.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-market-500/10 bg-ink-900/50 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/jobs/${payment.jobId}`}
                          className="text-sm font-medium text-amber-100 hover:text-market-400 transition-colors truncate block"
                        >
                          {payment.jobTitle || shortenAddress(payment.jobId)}
                        </Link>
                        <p className="text-xs text-amber-800 mt-0.5">
                          {payment.releasedAt
                            ? new Date(payment.releasedAt).toLocaleDateString()
                            : "—"}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-market-400">
                        {formatXLM(payment.amountXlm)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-amber-900/80 text-sm italic">
                  No completed jobs have been shared publicly yet.
                </p>
              )}
            </div>

            {/* Earned NFT certificates */}
            <div className="mt-6 sm:mt-8">
              <h2 className="label mb-3">Earned certificates</h2>
              {nftCertificates.length > 0 ? (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {nftCertificates.map((cert) => (
                    <li
                      key={cert.id}
                      className="rounded-xl border border-market-500/15 bg-ink-900/50 p-4"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <p className="text-xs uppercase tracking-[0.18em] text-market-300/80">
                          NFT Certificate
                        </p>
                        {cert.txHash && (
                          <a
                            href={explorerUrl(cert.txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-market-400 hover:text-market-300 underline shrink-0"
                          >
                            On-chain proof
                          </a>
                        )}
                      </div>
                      <h3 className="text-amber-100 font-medium text-base break-words mb-1">
                        {cert.jobTitle || shortenAddress(cert.jobId)}
                      </h3>
                      <p className="text-xs text-amber-800">
                        {cert.completionDate
                          ? new Date(cert.completionDate).toLocaleDateString()
                          : "—"}
                        {cert.amountXlm
                          ? ` · ${formatXLM(cert.amountXlm)}`
                          : ""}
                      </p>
                      {cert.verifyUrl && (
                        <a
                          href={cert.verifyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-2 text-xs text-market-400 hover:text-market-300 underline"
                        >
                          Verify certificate
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-amber-900/80 text-sm italic">
                  No certificates earned yet.
                </p>
              )}
            </div>

            {/* Ratings & reviews */}
            <div className="mt-6 sm:mt-8">
              <h2 className="label mb-3">
                Reviews
                {ratings.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-amber-800 normal-case tracking-normal">
                    {ratings.length} total
                  </span>
                )}
              </h2>
              {ratings.length > 0 ? (
                <ul className="space-y-4">
                  {ratings.map((rating) => (
                    <li
                      key={rating.id}
                      className="rounded-xl border border-market-500/10 bg-ink-900/50 p-4"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span
                          className="text-market-400 font-semibold text-sm"
                          aria-label={`${rating.stars} stars`}
                        >
                          {"★".repeat(rating.stars)}
                          {"☆".repeat(5 - rating.stars)}
                        </span>
                        <span className="text-xs text-amber-800">
                          {new Date(rating.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      {rating.review ? (
                        <p className="text-sm text-amber-700/90 leading-relaxed">
                          {rating.review}
                        </p>
                      ) : null}
                      <p className="text-xs text-amber-900/70 font-mono mt-2">
                        {shortenAddress(rating.raterAddress)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-amber-900/80 text-sm italic">
                  No reviews yet.
                </p>
              )}
            </div>
          </article>
        )}
      </div>
    </>
  );
}
