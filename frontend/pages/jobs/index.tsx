/**
 * pages/jobs/index.tsx
 * Browse all open jobs with category filtering and search autocomplete.
 */
import JobCard, { JobCardSkeleton } from "@/components/JobCard";
import { fetchJobs, fetchRecommendedJobs } from "@/lib/api";
import { JOB_CATEGORIES, CATEGORY_ICONS } from "@/utils/format";
import type { Job } from "@/utils/types";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useRef, useCallback } from "react";
import { getTimezoneOffset, toZonedTime } from "date-fns-tz";

export default function JobsPage({ publicKey }: { publicKey?: string | null }) {
  const router = useRouter();
  const { i18n } = useTranslation("common");
  const t = (key: string): string => i18n.t(key) as string;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [recommended, setRecommended] = useState<(Job & { matchScore: number })[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [userTimezone, setUserTimezone] = useState<string>("");
  const [manualTimezone, setManualTimezone] = useState<string>("");
  const [useGeolocation, setUseGeolocation] = useState<boolean>(false);
  const [geoLoading, setGeoLoading] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);


  const category = (router.query.category as string) || "";
  const status = (router.query.status as string) || "open";
  const pageFromQuery = Math.max(1, Number(router.query.page) || 1);
  const minBudget = (router.query.minBudget as string) || "";
  const maxBudget = (router.query.maxBudget as string) || "";

  // Detect user's timezone from browser
  useEffect(() => {
    const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setUserTimezone(detectedTz);
    getConnectedPublicKey().then((publicKey) => {
      if (publicKey) setViewerAddress(publicKey);
    }).catch(() => {});
  }, []);

  // Fetch recommended jobs when wallet is connected
  useEffect(() => {
    if (!publicKey) { setRecommended([]); return; }
    setRecLoading(true);
    fetchRecommendedJobs(publicKey)
      .then(setRecommended)
      .catch(() => setRecommended([]))
      .finally(() => setRecLoading(false));
  }, [publicKey]);

  // Handle geolocation-based timezone detection
  const handleGeolocation = () => {
    setGeoLoading(true);
    setGeoError(null);

    const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setUserTimezone(detectedTz);
    setUseGeolocation(true);
    setGeoLoading(false);
  };

  // Check if job timezone is within ±3 hours of user timezone
  const isTimezoneCompatible = (jobTimezone: string | undefined): boolean => {
    if (!jobTimezone) return true;
    if (!userTimezone) return true;

    try {
      const now = new Date();
      const userOffset = getTimezoneOffset(userTimezone, now);
      const jobOffset = getTimezoneOffset(jobTimezone, now);
      const diffHours = Math.abs(userOffset - jobOffset) / (1000 * 60 * 60);
      return diffHours <= 3;
    } catch (err) {
      return true;
    }
  };

  useEffect(() => {
    if (!router.isReady) return;

    let isCancelled = false;

    async function loadJobs() {
      setLoading(true);
      setError(null);

      try {
        let cursor: string | undefined;
        let loadedNextCursor: string | null = null;
        let pagesLoaded = 0;
        let allJobs: Job[] = [];

        const activeTimezone = manualTimezone || (useGeolocation ? userTimezone : "");

        for (let page = 1; page <= pageFromQuery; page += 1) {
          const result = await fetchJobs({
            category: category || undefined,
            status: status || undefined,
            limit: 20,
            cursor,
            timezone: activeTimezone || undefined,
            viewerAddress: viewerAddress || undefined,
          });

          const seenIds = new Set(allJobs.map((job) => job.id));
          const uniqueNewJobs = result.jobs.filter((job) => !seenIds.has(job.id));
          allJobs = allJobs.concat(uniqueNewJobs);
          loadedNextCursor = result.nextCursor;
          pagesLoaded = page;

          if (!result.nextCursor) break;
          cursor = result.nextCursor;
        }

        if (!isCancelled) {
          setJobs(allJobs);
          setNextCursor(loadedNextCursor);
          setCurrentPage(pagesLoaded);
        }
      } catch (_) {
        if (!isCancelled) setError("Could not load jobs.");
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    loadJobs();

    return () => { isCancelled = true; };
  }, [category, status, pageFromQuery, router.isReady, manualTimezone, useGeolocation, userTimezone, viewerAddress]);

  // Fetch suggestions with debounce
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoadingSuggestions(true);
    try {
      const data = await fetchJobSuggestions(query);
      setSuggestions(data);
      setShowSuggestions(data.length > 0);
      setActiveSuggestion(0);
    } catch (err) {
      console.error("Suggestion fetch error:", err);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearch(value);

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  };

  const handleSuggestionClick = (suggestion: Suggestion) => {
    setSearch(suggestion.value);
    setShowSuggestions(false);
    if (suggestion.type === 'category') {
      router.push(`/jobs/category/${categoryToSlug(suggestion.value)}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveSuggestion(prev => Math.min(prev + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveSuggestion(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (suggestions[activeSuggestion]) {
          handleSuggestionClick(suggestions[activeSuggestion]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchFiltered = search.trim()
    ? jobs.filter((j) =>
      j.title.toLowerCase().includes(search.toLowerCase()) ||
      j.description.toLowerCase().includes(search.toLowerCase()) ||
      j.skills.some((s) => s.toLowerCase().includes(search.toLowerCase()))
    )
    : jobs;

  const minN = minBudget.trim() ? parseFloat(minBudget) : NaN;
  const maxN = maxBudget.trim() ? parseFloat(maxBudget) : NaN;
  const budgetFiltered =
    !Number.isNaN(minN) || !Number.isNaN(maxN)
      ? searchFiltered.filter((j) => {
          const b = parseFloat(j.budget);
          if (Number.isNaN(b)) return false;
          if (!Number.isNaN(minN) && b < minN) return false;
          if (!Number.isNaN(maxN) && b > maxN) return false;
          return true;
        })
      : searchFiltered;

  const activeTimezone = manualTimezone || (useGeolocation ? userTimezone : "");
  const filtered = activeTimezone
    ? budgetFiltered.filter((j) => isTimezoneCompatible(j.timezone))
    : budgetFiltered;

  const setFilter = (key: string, val: string) => {
    router.push(
      { pathname: "/jobs", query: { ...router.query, [key]: val || undefined, page: undefined } },
      undefined,
      { shallow: true }
    );
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;

    setLoadingMore(true);
    setError(null);

    try {
      const activeTimezone = manualTimezone || (useGeolocation ? userTimezone : "");

      const result = await fetchJobs({
        category: category || undefined,
        status: status || undefined,
        limit: 20,
        cursor: nextCursor,
        timezone: activeTimezone || undefined,
        viewerAddress: viewerAddress || undefined,
      });

      setJobs((prev) => {
        const seenIds = new Set(prev.map((job) => job.id));
        const uniqueNewJobs = result.jobs.filter((job) => !seenIds.has(job.id));
        return prev.concat(uniqueNewJobs);
      });
      setNextCursor(result.nextCursor);

      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      router.push(
        { pathname: "/jobs", query: { ...router.query, page: String(nextPage) } },
        undefined,
        { shallow: true }
      );
    } catch (_) {
      setError("Could not load more jobs.");
    } finally {
      setLoadingMore(false);
    }
  };

  const setBudgetRange = (min: string, max: string) => {
    router.push({
      pathname: "/jobs",
      query: { ...router.query, minBudget: min || undefined, maxBudget: max || undefined }
    }, undefined, { shallow: true });
  };

  const groupedSuggestions = suggestions.reduce((acc, s) => {
    if (!acc[s.type]) acc[s.type] = [];
    acc[s.type].push(s);
    return acc;
  }, {} as Record<string, Suggestion[]>);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">

      {/* Recommended for you */}
      {publicKey && (recLoading || recommended.length > 0) && (
        <div className="mb-10">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-4">Recommended for you</h2>
          {recLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => <JobCardSkeleton key={`rec-skeleton-${i}`} />)}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recommended.map((job) => (
                <div key={job.id} className="relative">
                  <JobCard job={job} />
                  {job.matchScore > 0 && (
                    <span className="absolute top-3 right-3 bg-market-500/20 text-market-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-market-500/30">
                      {job.matchScore}% match
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-amber-100 mb-1">{t("jobs.title")}</h1>
          <p className="text-amber-800 text-sm">{loading ? t("jobs.loading") : `${filtered.length} ${filtered.length !== 1 ? t("jobs.foundPlural") : t("jobs.found")}`}</p>
        </div>
        <Link href="/post-job" locale={false} className="btn-primary text-sm py-2.5 px-5 flex-shrink-0">+ {t("nav.postJob")}</Link>
      </div>

      {/* Search with Autocomplete */}
      <div className="relative mb-6">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-800" />
        <input
          ref={searchRef}
          type="text" value={search} onChange={handleSearchChange} onKeyDown={handleKeyDown}
          placeholder={t("jobs.searchPlaceholder")}
          className="input-field pl-10"
          onFocus={() => search.length >= 2 && setShowSuggestions(suggestions.length > 0)}
        />
        {showSuggestions && (
          <div ref={suggestionsRef} className="absolute z-10 w-full mt-1 bg-ink-800 border border-amber-900/30 rounded-lg shadow-xl max-h-60 overflow-y-auto">
            {isLoadingSuggestions ? (
              <div className="px-4 py-3 text-sm text-amber-800">{t("jobs.loading")}</div>
            ) : (
              Object.entries(groupedSuggestions).map(([type, items]) => (
                <div key={type}>
                  <div className="px-4 py-1 text-xs font-semibold text-amber-700 uppercase bg-ink-900/50">
                    {type === 'title' ? 'Job Titles' : type === 'skill' ? 'Skills' : 'Categories'}
                  </div>
                  {(items as Suggestion[]).map((s, idx) => {
                    const globalIdx = suggestions.indexOf(s);
                    return (
                      <div
                        key={`${s.type}-${s.value}`}
                        onClick={() => handleSuggestionClick(s)}
                        className={clsx(
                          "px-4 py-2 text-sm cursor-pointer flex items-center gap-2",
                          globalIdx === activeSuggestion ? "bg-market-500/20 text-market-300" : "text-amber-100 hover:bg-market-500/10"
                        )}
                      >
                        {s.type === 'title' ? <BriefcaseMiniIcon /> : s.type === 'skill' ? <TagMiniIcon /> : <CategoryMiniIcon />}
                        {s.value}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* Sidebar filters */}
        <aside className="hidden lg:block w-52 flex-shrink-0 space-y-6">
          {/* Status */}
          <div>
            <p className="label">{t("jobs.status.all")}</p>
            <div className="space-y-1">
              {["open", "in_progress", "completed", ""].map((s) => (
                <button key={s}
                  onClick={() => setFilter("status", s)}
                  className={clsx(
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body",
                    status === s ? "bg-market-500/15 text-market-300 font-medium" : "text-amber-700 hover:text-amber-400 hover:bg-market-500/8"
                  )}>
                  {s === "" ? t("jobs.status.all") : s === "open" ? t("jobs.status.open") : s === "in_progress" ? t("jobs.status.inProgress") : t("jobs.status.completed")}
                </button>
              ))}
            </div>
          </div>

          {/* Budget Range */}
          <div className="pt-2">
            <p className="label mb-2">{t("jobs.budget")}</p>
            <div className="flex gap-2 items-center mb-3">
              <input
                type="number" placeholder="Min" value={minBudget}
                onChange={(e) => setFilter("minBudget", e.target.value)}
                className="w-full bg-market-900/40 border border-amber-900/30 rounded px-2 py-1 text-xs text-amber-100 placeholder:text-amber-900/50"
              />
              <span className="text-amber-900 text-[10px] font-bold">TO</span>
              <input
                type="number" placeholder="Max" value={maxBudget}
                onChange={(e) => setFilter("maxBudget", e.target.value)}
                className="w-full bg-market-900/40 border border-amber-900/30 rounded px-2 py-1 text-xs text-amber-100 placeholder:text-amber-900/50"
              />
            </div>

            {/* Presets */}
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              <button
                onClick={() => setBudgetRange("", "100")}
                className="text-[10px] py-1.5 rounded bg-market-500/5 border border-amber-900/20 text-amber-800 hover:border-amber-700/50 transition-colors"
              >
                &lt; 100
              </button>
              <button
                onClick={() => setBudgetRange("100", "500")}
                className="text-[10px] py-1.5 rounded bg-market-500/5 border border-amber-900/20 text-amber-800 hover:border-amber-700/50 transition-colors"
              >
                100-500
              </button>
              <button
                onClick={() => setBudgetRange("500", "")}
                className="text-[10px] py-1.5 rounded bg-market-500/5 border border-amber-900/20 text-amber-800 hover:border-amber-700/50 transition-colors"
              >
                500+
              </button>
              {(minBudget || maxBudget) && (
                <button
                  onClick={() => setBudgetRange("", "")}
                  className="text-[10px] py-1.5 rounded bg-market-900/40 border border-market-500/30 text-market-400 hover:text-market-300 font-bold"
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>

          {/* Category */}
          <div>
            <p className="label">{t("jobs.category")}</p>
            <div className="space-y-1">
              <Link href="/jobs" locale={false}
                className={clsx(
                  "w-full text-left px-3 py-2 rounded-lg text-sm font-body transition-all duration-200 block",
                  !category
                    ? "bg-market-500/20 text-market-300 font-medium ring-1 ring-market-500/30"
                    : "text-amber-700 hover:text-amber-400 hover:bg-market-500/8 hover:translate-x-0.5"
                )}>
                🗂️ {t("jobs.allCategories")}
                <span className="ml-1 text-xs text-amber-800">({jobs.length})</span>
              </Link>
              {JOB_CATEGORIES.map((cat) => {
                const count = jobs.filter((j) => j.category === cat).length;
                const isAlerted = alertedCategories.includes(cat);
                return (
                  <Link key={cat} href={`/jobs/category/${categoryToSlug(cat)}`} locale={false}
                    className={clsx(
                      "w-full text-left px-3 py-2 rounded-lg text-sm font-body transition-all duration-200 block",
                      category === cat
                        ? "bg-market-500/20 text-market-300 font-medium ring-1 ring-market-500/30"
                        : "text-amber-700 hover:text-amber-400 hover:bg-market-500/8 hover:translate-x-0.5"
                    )}>
                    {CATEGORY_ICONS[cat] ?? ""} {cat}
                    <span className="ml-1 text-xs text-amber-800">({count})</span>
                  </Link>
                );
              })}
            </div>

          {/* Alert permission denied warning */}
          {alertStatus === "denied" && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              Notifications blocked. Enable them in browser settings to use job alerts.
            </div>
          )}

          {/* Active alerts summary */}
          {alertedCategories.length > 0 && (
            <div className="px-3 py-2 rounded-lg bg-market-500/8 border border-market-500/20 text-xs text-market-400 space-y-1">
              <p className="font-semibold flex items-center gap-1">
                <BellIcon className="w-3 h-3" filled />
                Active alerts ({alertedCategories.length})
              </p>
              {alertedCategories.map((c) => (
                <div key={c} className="flex items-center justify-between">
                  <span className="text-amber-700 truncate">{CATEGORY_ICONS[c] ?? ""} {c}</span>
                  <button
                    onClick={() => removeAlert(c)}
                    className="text-amber-900 hover:text-red-400 transition-colors ml-1 flex-shrink-0"
                    title={`Remove "${c}" alert`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          </div>

          {/* Timezone Filter */}
          <div>
            <p className="label">{t("jobs.timezone")}</p>
            <div className="space-y-2">
              <button
                onClick={handleGeolocation}
                disabled={geoLoading}
                className={clsx(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-body flex items-center gap-2",
                  useGeolocation ? "bg-market-500/15 text-market-300 font-medium" : "text-amber-700 hover:text-amber-400 hover:bg-market-500/8",
                  geoLoading && "opacity-50 cursor-not-allowed"
                )}
              >
                {geoLoading ? (
                  <SpinnerIcon className="w-3 h-3 animate-spin" />
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
                {geoLoading ? t("jobs.detecting") : useGeolocation ? `${t("jobs.myLocation")} (${userTimezone})` : t("jobs.useMyLocation")}
              </button>

              {geoError && (
                <p className="text-xs text-red-400 px-1">{geoError}</p>
              )}

              <select
                value={manualTimezone}
                onChange={(e) => {
                  setManualTimezone(e.target.value);
                  setUseGeolocation(false);
                }}
                className="w-full bg-market-900/40 border border-amber-900/30 rounded px-2 py-1.5 text-xs text-amber-100 appearance-none cursor-pointer"
              >
                <option value="">{t("jobs.allTimezones")}</option>
                <option value="UTC">UTC (Universal)</option>
                <option value="America/New_York">America/New York</option>
                <option value="America/Los_Angeles">America/Los Angeles</option>
                <option value="America/Chicago">America/Chicago</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Paris">Europe/Paris</option>
                <option value="Europe/Berlin">Europe/Berlin</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="Asia/Singapore">Asia/Singapore</option>
                <option value="Asia/Kolkata">Asia/Kolkata</option>
                <option value="Australia/Sydney">Australia/Sydney</option>
                <option value="Pacific/Auckland">Pacific/Auckland</option>
              </select>

              {(activeTimezone) && (
                <button
                  onClick={() => {
                    setManualTimezone("");
                    setUseGeolocation(false);
                  }}
                  className="text-[10px] py-1.5 rounded bg-market-900/40 border border-market-500/30 text-market-400 hover:text-market-300 font-bold w-full"
                >
                  CLEAR TIMEZONE
                </button>
              )}

              <p className="text-[10px] text-amber-800/60 px-1">
                {t("jobs.withinTimezone")}
              </p>
            </div>
          </div>
        </aside>

        {/* Job grid */}
        <div className="flex-1">
          {loading ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <JobCardSkeleton key={`job-skeleton-${i}`} />
              ))}
            </div>
          ) : error ? (
            <div className="card text-center py-12">
              <p className="text-red-400 mb-3">{error}</p>
              <button onClick={() => window.location.reload()} className="btn-secondary text-sm">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card text-center py-16">
              <p className="font-display text-xl text-amber-100 mb-2">{t("jobs.noJobsFound")}</p>
              <p className="text-amber-800 text-sm mb-6">{t("jobs.tryAdjusting")}</p>
              <Link href="/post-job" locale={false} className="btn-primary text-sm">{t("jobs.postFirstJob")} →</Link>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                {filtered.map((job) => <JobCard key={job.id} job={job} />)}
              </div>

              {nextCursor && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="btn-secondary text-sm min-w-40 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {loadingMore && <SpinnerIcon className="w-4 h-4 animate-spin" />}
                    {loadingMore ? t("jobs.loading") : t("jobs.loadMore")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a9 9 0 109 9" />
    </svg>
  );
}

function BriefcaseMiniIcon() {
  return (
    <svg className="w-3 h-3 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
    </svg>
  );
}

function TagMiniIcon() {
  return (
    <svg className="w-3 h-3 text-market-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  );
}

function CategoryMiniIcon() {
  return (
    <svg className="w-3 h-3 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}
