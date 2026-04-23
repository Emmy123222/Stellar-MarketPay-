/**
 * pages/freelancers/[publicKey].tsx
 * Public freelancer profile (read-only, from GET /api/profiles/:publicKey).
 */
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import FreelancerTierBadge from "@/components/FreelancerTierBadge";
import { fetchPublicProfile, fetchProfileStats, fetchResponseTime } from "@/lib/api";
import {
  availabilityStatusLabel,
  availabilitySummary,
  formatXLM,
  shortenAddress,
} from "@/utils/format";
import { accountUrl, isValidStellarAddress } from "@/lib/stellar";
import type { AvailabilityStatus, PortfolioItem, UserProfile, ProfileStats, ResponseTimeStats } from "@/utils/types";

type LoadState =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "ok"; profile: UserProfile };

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

function getAvailabilityBadgeClass(status?: AvailabilityStatus | null) {
  if (status === "available")
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (status === "busy")
    return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  if (status === "unavailable")
    return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-market-500/10 text-market-300 border-market-500/20";
}

export default function PublicFreelancerProfilePage({
  publicKey,
}: {
  publicKey: string | null;
}) {
  const router = useRouter();
  const rawKey = typeof router.query.publicKey === "string" ? router.query.publicKey : "";
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [responseTime, setResponseTime] = useState<ResponseTimeStats | null>(null);

  const handleEndorse = async (skill: string) => {
    if (!publicKey || isOwner) return;
    setEndorsingSkill(skill);
    try {
      await endorseSkill(rawKey, skill);
      const refreshed = await fetchSkillEndorsements(rawKey);
      setEndorsements(refreshed);
    } catch (error: unknown) {
      console.error("Endorsement error:", error);
      alert(error instanceof Error ? error.message : "Failed to endorse skill");
    } finally {
      setEndorsingSkill(null);
    }
  };

  const titleBase = useMemo(() => {
    if (state.status === "ok" && state.profile.displayName?.trim()) {
      return `${state.profile.displayName.trim()} · MarketPay`;
    }
    if (rawKey && isValidStellarAddress(rawKey)) {
      return `${shortenAddress(rawKey)} · MarketPay`;
    }
    return "Freelancer profile · MarketPay";
  }, [state, rawKey]);

  const metaDescription = useMemo(() => {
    if (state.status === "ok" && state.profile.bio?.trim()) {
      const bio = state.profile.bio.trim();
      return bio.length > 160 ? `${bio.slice(0, 157)}...` : bio;
    }
    return "View freelancer profile on Stellar MarketPay.";
  }, [state]);

  useEffect(() => {
    if (!router.isReady) return;

    if (!rawKey) {
      setState({ status: "not_found" });
      return;
    }

    if (!isValidStellarAddress(rawKey)) {
      setState({ status: "invalid" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const [profile, profileStats, profileResponseTime] = await Promise.all([
          fetchPublicProfile(rawKey),
          fetchProfileStats(rawKey),
          fetchResponseTime(rawKey)
        ]);

        if (cancelled) return;
        
        if (profile === null) {
          setState({ status: "not_found" });
        } else {
          setState({ status: "ok", profile });
          setStats(profileStats);
          setResponseTime(profileResponseTime);
        }
      } catch (error: unknown) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Could not load profile.";
        setState({ status: "error", message });
      }
    })();

    // Fetch badges separately (non-blocking)
    fetchSkillBadges(rawKey)
      .then((data) => { if (!cancelled) setBadges(data.filter((b) => b.passed)); })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [router.isReady, rawKey]);

  const explorerHref =
    rawKey && isValidStellarAddress(rawKey) ? accountUrl(rawKey) : "#";

  return (
    <>
      <Head>
        <title>{titleBase}</title>
        <meta name="description" content={metaDescription} />
        <meta property="og:title" content={titleBase} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="profile" />
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

        {state.status === "loading" && (
          <div className="card space-y-4 animate-pulse" aria-busy="true">
            <div className="h-8 bg-market-500/10 rounded w-2/3" />
            <div className="h-4 bg-market-500/8 rounded w-1/2" />
            <div className="h-24 bg-market-500/8 rounded w-full" />
          </div>
        )}

        {state.status === "invalid" && (
          <div className="card border-amber-900/30 text-center py-12 sm:py-16">
            <p className="font-display text-xl text-amber-100 mb-2">
              Invalid address
            </p>
            <p className="text-amber-800 text-sm max-w-md mx-auto">
              This URL does not contain a valid Stellar public key. Check the
              link and try again.
            </p>
          </div>
        )}

        {state.status === "not_found" && (
          <div className="card border-market-500/20 text-center py-12 sm:py-16">
            <p className="font-display text-xl text-amber-100 mb-2">
              Profile not found
            </p>
            <p className="text-amber-800 text-sm max-w-md mx-auto mb-6">
              No profile exists for this wallet yet. The freelancer may not have
              set up their profile.
            </p>
            <Link href="/jobs" className="btn-secondary text-sm inline-flex">
              Browse jobs
            </Link>
          </div>
        )}

        {state.status === "error" && (
          <div className="card border-red-500/20 text-center py-12 sm:py-16">
            <p className="font-display text-xl text-amber-100 mb-2">
              Something went wrong
            </p>
            <p className="text-red-400/90 text-sm max-w-md mx-auto">
              {state.message}
            </p>
          </div>
        )}

        {state.status === "ok" && (
          <article className="card border-market-500/15 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6 mb-6">
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-amber-100 break-words">
                  {state.profile.displayName?.trim() ||
                    shortenAddress(state.profile.publicKey)}
                </h1>
                <div className="mt-3 flex flex-wrap gap-2">
                  <FreelancerTierBadge tier={state.profile.tier} className="text-sm" />
                  {responseTime?.averageDays !== null && responseTime.averageDays <= 3 && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-market-500/10 text-market-400 border border-market-500/20">
                      ⚡ Fast Responder
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-amber-800 mt-2 font-mono break-all">
                  {state.profile.publicKey}
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
                {isOwner && !state.profile.isKycVerified && (
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
                  className={`text-xs px-2.5 py-1 rounded-full border ${getAvailabilityBadgeClass(
                    state.profile.availability?.status,
                  )}`}
                >
                  {availabilityStatusLabel(state.profile.availability?.status)}
                </span>
              </div>
              <p className="text-sm text-amber-700/90">
                {availabilitySummary(state.profile.availability) ||
                  "Availability has not been set yet."}
              </p>
            </div>

            {state.profile.bio?.trim() ? (
              <div className="mb-6 sm:mb-8">
                <h2 className="label mb-2">Bio</h2>
                <p className="text-amber-700/90 text-sm sm:text-base leading-relaxed whitespace-pre-wrap">
                  {state.profile.bio.trim()}
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
                  {state.profile.completedJobs ?? 0}
                </p>
              </div>
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Total earned</p>
                <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                  {formatXLM(state.profile.totalEarnedXLM ?? "0")}
                </p>
              </div>
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Freelancer tier</p>
                <FreelancerTierBadge
                  tier={state.profile.tier}
                  className="mt-2"
                />
              </div>
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Average rating</p>
                <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                  {state.profile.rating?.toFixed(2) ?? "New"}
                </p>
              </div>
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Success rate</p>
                <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                  {stats ? `${stats.successRate}%` : "—"}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-amber-800 mt-1">
                  {stats?.acceptedApplications || 0} / {stats?.totalApplications || 0} accepted
                </p>
              </div>
              <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-4">
                <p className="label mb-1">Avg. completion</p>
                <p className="font-display text-2xl sm:text-3xl font-bold text-market-400">
                  {responseTime?.averageDays !== null ? `${responseTime?.averageDays}d` : "—"}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-amber-800 mt-1">
                  Acceptance to release
                </p>
              </div>
            </div>

            <div className="mb-6 sm:mb-8">
              <h2 className="label mb-3">Skills</h2>
              {state.profile.skills && state.profile.skills.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {state.profile.skills.map((skill) => {
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
                  {badges.map((b) => (
                    <li key={b.skill} className="relative group">
                      <span className="inline-flex items-center gap-1.5 text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-3 py-1.5 rounded-full cursor-default">
                        ✓ {b.skill.charAt(0).toUpperCase() + b.skill.slice(1)}
                      </span>
                      {/* Score tooltip */}
                      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-ink-900 border border-market-500/20 px-2.5 py-1 text-xs text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10">
                        Score: {b.score}% · {new Date(b.taken_at).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Verified skill badges */}
            {badges.length > 0 && (
              <div className="mb-6 sm:mb-8">
                <h2 className="label mb-3">Verified Skills</h2>
                <ul className="flex flex-wrap gap-2">
                  {badges.map((b) => (
                    <li key={b.skill} className="relative group">
                      <span className="inline-flex items-center gap-1.5 text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-3 py-1.5 rounded-full cursor-default">
                        ✓ {b.skill.charAt(0).toUpperCase() + b.skill.slice(1)}
                      </span>
                      {/* Score tooltip */}
                      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-ink-900 border border-market-500/20 px-2.5 py-1 text-xs text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10">
                        Score: {b.score}% · {new Date(b.taken_at).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="label">Portfolio</h2>
                <p className="text-xs text-amber-800">
                  {(state.profile.portfolioItems || []).length}/10
                </p>
              </div>

              {state.profile.portfolioItems &&
              state.profile.portfolioItems.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {state.profile.portfolioItems.map((item, index) => (
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
          </article>
        )}
      </div>
    </>
  );
}
