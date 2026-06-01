/**
 * pages/jobs/index.tsx
 * Browse all open jobs with category filtering and search autocomplete.
 */
import JobCard, { JobCardSkeleton } from "@/components/JobCard";
import StateMessage from "@/components/StateMessage";
import { fetchJobs, fetchRecommendedJobs } from "@/lib/api";
import { JOB_CATEGORIES, CATEGORY_ICONS, categoryToSlug } from "@/utils/format";
import type { Job } from "@/utils/types";
import clsx from "clsx";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "@/lib/i18n";
import JobFiltersPanel, {
  ActiveFilterChips,
  type JobFilterQuery,
} from "@/components/JobFiltersPanel";
import { getTimezoneOffset } from "date-fns-tz";
import { getConnectedPublicKey } from "@/lib/wallet";
import { useBookmarks } from "@/hooks/useBookmarks";
import { createSavedSearch, fetchSavedSearches, type SavedSearch } from "@/lib/api";

interface Suggestion {
  type: string;
  value: string;
}

// ── Job Alert localStorage helpers ──────────────────────────────────────────
const ALERT_KEY = "marketpay_job_alerts";

function getAlerts(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(ALERT_KEY) ?? "[]"); }
  catch { return []; }
}

function saveAlerts(cats: string[]): void {
  localStorage.setItem(ALERT_KEY, JSON.stringify(cats));
  window.dispatchEvent(new Event("job-alerts-changed"));
}

function addAlert(cat: string): void {
  const current = getAlerts();
  if (!current.includes(cat)) saveAlerts([...current, cat]);
}

function removeAlert(cat: string): void {
  saveAlerts(getAlerts().filter((c) => c !== cat));
}


export default function JobsPage({ publicKey }: { publicKey?: string | null }) {
  const router = useRouter();
  const { t } = useTranslation("common");
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

  // ── Job-alert state ────────────────────────────────────────────────────────
  const [alertedCategories, setAlertedCategories] = useState<string[]>([]);
  const [alertStatus, setAlertStatus] = useState<"idle" | "granted" | "denied">("idle");
  const [viewerAddress, setViewerAddress] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [focusedJobId, setFocusedJobId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toggleBookmark } = useBookmarks();

  // ── Saved search state (Issue #284) ────────────────────────────────────────
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [savingSearch, setSavingSearch] = useState(false);
  const [saveSearchMsg, setSaveSearchMsg] = useState<string | null>(null);

  // Sync alertedCategories from localStorage on mount
  useEffect(() => {
    setAlertedCategories(getAlerts());
    const handler = () => setAlertedCategories(getAlerts());
    window.addEventListener("job-alerts-changed", handler);
    return () => window.removeEventListener("job-alerts-changed", handler);
  }, []);

  // Fetch saved searches for the current user
  useEffect(() => {
    if (!publicKey) return;
    fetchSavedSearches()
      .then(setSavedSearches)
      .catch(() => {});
  }, [publicKey]);

  let activeTimezone = manualTimezone || (useGeolocation ? userTimezone : "");
  const category = (router.query.category as string) || "";
  const status = (router.query.status as string) || "open";
  const minBudget = (router.query.minBudget as string) || "";
  const maxBudget = (router.query.maxBudget as string) || "";

  // Save current search filters as a saved search
  const handleSaveSearch = async () => {
    if (!publicKey) return;
    const queryParams: Record<string, string> = {};
    if (search.trim()) queryParams.search = search.trim();
    if (category) queryParams.category = category;
    if (status && status !== "open") queryParams.status = status;
    if (minBudget) queryParams.minBudget = minBudget;
    if (maxBudget) queryParams.maxBudget = maxBudget;
    if (activeTimezone) queryParams.timezone = activeTimezone;

    if (Object.keys(queryParams).length === 0) {
      setSaveSearchMsg("Add filters before saving a search.");
      setTimeout(() => setSaveSearchMsg(null), 3000);
      return;
    }

    // Check if already saved
    const alreadySaved = savedSearches.some((s) =>
      JSON.stringify(s.query_params) === JSON.stringify(queryParams)
    );
    if (alreadySaved) {
      setSaveSearchMsg("This search is already saved.");
      setTimeout(() => setSaveSearchMsg(null), 3000);
      return;
    }

    setSavingSearch(true);
    try {
      const created = await createSavedSearch({
        query_params: queryParams,
        notify_in_app: true,
        notify_email: false,
      });
      setSavedSearches((prev) => [created, ...prev]);
      setSaveSearchMsg("Search saved! You'll be notified of matching jobs.");
      setTimeout(() => setSaveSearchMsg(null), 4000);
    } catch {
      setSaveSearchMsg("Failed to save search. Try again.");
      setTimeout(() => setSaveSearchMsg(null), 3000);
    } finally {
      setSavingSearch(false);
    }
  };

  const hasActiveFilters = Boolean(
    search.trim() || category || (status && status !== "open") || minBudget || maxBudget || activeTimezone
  );

  useEffect(() => {
    if (jobs.length > 0 && !focusedJobId) {
      setFocusedJobId(jobs[0].id);
    }
  }, [jobs, focusedJobId]);

  useEffect(() => {
    const onFocusSearch = () => searchRef.current?.focus();
    const onToggleBookmark = () => {
      if (focusedJobId) toggleBookmark(focusedJobId);
    };
    window.addEventListener("shortcut-focus-search", onFocusSearch);
    window.addEventListener("shortcut-toggle-bookmark", onToggleBookmark);
    return () => {
      window.removeEventListener("shortcut-focus-search", onFocusSearch);
      window.removeEventListener("shortcut-toggle-bookmark", onToggleBookmark);
    };
  }, [focusedJobId, toggleBookmark]);

  const handleSetAlert = async (cat: string) => {
    if (alertedCategories.includes(cat)) {
      // Toggle off
      removeAlert(cat);
      return;
    }

    // Request notification permission
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setAlertStatus("granted");
      addAlert(cat);
      new Notification("Job alert set!", {
        body: `You'll be notified when new "${cat}" jobs are posted.`,
        icon: "/favicon.ico",
      });
    } else {
      setAlertStatus("denied");
    }
  };

  const pageFromQuery = Math.max(1, Number(router.query.page) || 1);
  const filterQuery: JobFilterQuery = {
    minBudget: minBudget || undefined,
    maxBudget: maxBudget || undefined,
    skills: (router.query.skills as string) || undefined,
    minClientRating: (router.query.minClientRating as string) || undefined,
    duration: (router.query.duration as string) || undefined,
    postedSince: (router.query.postedSince as string) || undefined,
    maxApplications: (router.query.maxApplications as string) || undefined,
  };

  const updateFilters = (
    patch: Partial<JobFilterQuery>,
    removeKeys?: string[],
  ) => {
    const next: Record<string, any> = { ...router.query, ...patch, page: undefined };
    for (const key of removeKeys || []) {
      delete next[key];
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") delete next[k];
    }
    router.push({ pathname: "/jobs", query: next }, undefined, { shallow: true });
  };

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

        activeTimezone = manualTimezone || (useGeolocation ? userTimezone : "");

        for (let page = 1; page <= pageFromQuery; page += 1) {
          const result = await fetchJobs({
            category: category || undefined,
            status: status || undefined,
            limit: 20,
            cursor,
            timezone: activeTimezone || undefined,
            viewerAddress: viewerAddress || undefined,
            minBudget: minBudget || undefined,
            maxBudget: maxBudget || undefined,
            skills: filterQuery.skills,
            minClientRating: filterQuery.minClientRating,
            duration: filterQuery.duration,
            postedSince: filterQuery.postedSince,
            maxApplications: filterQuery.maxApplications,
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
  }, [
    category,
    status,
    pageFromQuery,
    router.isReady,
    manualTimezone,
    useGeolocation,
    userTimezone,
    viewerAddress,
    minBudget,
    maxBudget,
    filterQuery.skills,
    filterQuery.minClientRating,
    filterQuery.duration,
    filterQuery.postedSince,
    filterQuery.maxApplications,
  ]);

  // Fetch suggestions with debounce
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoadingSuggestions(true);
    const q = query.toLowerCase();
    const fromCategories: Suggestion[] = JOB_CATEGORIES.filter((c) => c.toLowerCase().includes(q))
      .slice(0, 3)
      .map((c) => ({ type: "category", value: c }));
    const fromJobs: Suggestion[] = jobs
      .filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.skills.some((s) => s.toLowerCase().includes(q))
      )
      .slice(0, 5)
      .map((j) => ({ type: "job", value: j.title }));
    const combined = [...fromCategories, ...fromJobs];
    setSuggestions(combined);
    setShowSuggestions(combined.length > 0);
    setActiveSuggestion(0);
    setIsLoadingSuggestions(false);
  }, [jobs]);

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

  activeTimezone = manualTimezone || (useGeolocation ? userTimezone : "");
  const filtered = activeTimezone
    ? searchFiltered.filter((j) => isTimezoneCompatible(j.timezone))
    : searchFiltered;

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
      activeTimezone = manualTimezone || (useGeolocation ? userTimezone : "");

      const result = await fetchJobs({
        category: category || undefined,
        status: status || undefined,
        limit: 20,
        cursor: nextCursor,
        timezone: activeTimezone || undefined,
        viewerAddress: viewerAddress || undefined,
        minBudget: minBudget || undefined,
        maxBudget: maxBudget || undefined,
        skills: filterQuery.skills,
        minClientRating: filterQuery.minClientRating,
        duration: filterQuery.duration,
        postedSince: filterQuery.postedSince,
        maxApplications: filterQuery.maxApplications,
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

  const [showMobileFilters, setShowMobileFilters] = useState(false);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">

      {/* Recommended for you */}
      {publicKey && (recLoading || recommended.length > 0) && (
        <div className="mb-10">
          <h2 className="font-display text-xl font-bold text-amber-100 mb-4">{t("jobs.recommended")}</h2>
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
        <div className="flex items-center gap-2 flex-shrink-0">
          {publicKey && hasActiveFilters && (
            <button
              onClick={handleSaveSearch}
              disabled={savingSearch}
              className="flex items-center gap-1.5 btn-secondary text-sm py-2.5 px-4 min-h-[44px] disabled:opacity-50"
              title="Save this search for alerts"
            >
              {savingSearch ? (
                <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              )}
              Save Search
            </button>
          )}
          <Link href="/post-job" locale={false} className="btn-primary text-sm py-2.5 px-5 min-h-[44px] flex items-center">+ {t("nav.postJob")}</Link>
        </div>
      </div>
      {saveSearchMsg && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-market-500/10 border border-market-500/20 text-sm text-market-300 animate-fade-in">
          {saveSearchMsg}
        </div>
      )}

      {/* Search with Autocomplete */}
      <div className="relative mb-6">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-800" />
        <input
          ref={searchRef}
          data-job-search
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
                        <span className="text-amber-800 w-4 text-center">
                          {s.type === "job" ? "•" : s.type === "skill" ? "#" : "◎"}
                        </span>
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

      {/* Mobile filter toggle */}
      <button
        onClick={() => setShowMobileFilters(true)}
        className="lg:hidden mb-4 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-market-500/30 text-market-400 text-sm font-medium hover:bg-market-500/10 transition-colors min-h-[44px]"
        aria-label="Open filters"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
        </svg>
        Filters
        {(category || status !== "open" || minBudget || maxBudget || activeTimezone) && (
          <span className="w-2 h-2 rounded-full bg-market-400" />
        )}
      </button>

      {/* Mobile filter overlay */}
      {showMobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => setShowMobileFilters(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto bg-ink-900 border-t border-market-500/20 rounded-t-2xl p-6 space-y-6 animate-slide-up">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-lg font-bold text-amber-100">Filters</h3>
              <button
                onClick={() => setShowMobileFilters(false)}
                className="p-2 rounded-lg text-amber-700 hover:text-amber-300 hover:bg-market-500/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Close filters"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Mobile Status */}
            <div>
              <p className="label">{t("jobs.status.all")}</p>
              <div className="grid grid-cols-2 gap-2">
                {["open", "in_progress", "completed", ""].map((s) => (
                  <button key={s}
                    onClick={() => { setFilter("status", s); setShowMobileFilters(false); }}
                    className={clsx(
                      "w-full text-left px-4 py-3 rounded-lg text-sm transition-colors font-body min-h-[44px]",
                      status === s ? "bg-market-500/15 text-market-300 font-medium" : "text-amber-700 hover:text-amber-400 hover:bg-market-500/8"
                    )}>
                    {s === "" ? t("jobs.status.all") : s === "open" ? t("jobs.status.open") : s === "in_progress" ? t("jobs.status.inProgress") : t("jobs.status.completed")}
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Budget Range */}
            <div>
              <p className="label mb-2">{t("jobs.budget")}</p>
              <div className="flex gap-2 items-center mb-3">
                <input
                  type="number" placeholder="Min" value={minBudget}
                  onChange={(e) => setFilter("minBudget", e.target.value)}
                  className="w-full bg-market-900/40 border border-amber-900/30 rounded-lg px-3 py-2.5 text-sm text-amber-100 placeholder:text-amber-900/50 min-h-[44px]"
                />
                <span className="text-amber-900 text-xs font-bold">TO</span>
                <input
                  type="number" placeholder="Max" value={maxBudget}
                  onChange={(e) => setFilter("maxBudget", e.target.value)}
                  className="w-full bg-market-900/40 border border-amber-900/30 rounded-lg px-3 py-2.5 text-sm text-amber-100 placeholder:text-amber-900/50 min-h-[44px]"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <button onClick={() => setBudgetRange("", "100")} className="text-xs py-2.5 rounded-lg bg-market-500/5 border border-amber-900/20 text-amber-800 hover:border-amber-700/50 transition-colors min-h-[44px]">&lt; 100</button>
                <button onClick={() => setBudgetRange("100", "500")} className="text-xs py-2.5 rounded-lg bg-market-500/5 border border-amber-900/20 text-amber-800 hover:border-amber-700/50 transition-colors min-h-[44px]">100-500</button>
                <button onClick={() => setBudgetRange("500", "")} className="text-xs py-2.5 rounded-lg bg-market-500/5 border border-amber-900/20 text-amber-800 hover:border-amber-700/50 transition-colors min-h-[44px]">500+</button>
                {(minBudget || maxBudget) && (
                  <button onClick={() => setBudgetRange("", "")} className="text-xs py-2.5 rounded-lg bg-market-900/40 border border-market-500/30 text-market-400 hover:text-market-300 font-bold min-h-[44px]">CLEAR</button>
                )}
              </div>
            </div>

            {/* Mobile Category */}
            <div>
              <p className="label">{t("jobs.category")}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setFilter("category", ""); setShowMobileFilters(false); }}
                  className={clsx(
                    "w-full text-left px-3 py-2.5 rounded-lg text-sm font-body min-h-[44px]",
                    !category ? "bg-market-500/20 text-market-300 font-medium" : "text-amber-700 hover:text-amber-400"
                  )}
                >
                  🗂️ All
                </button>
                {JOB_CATEGORIES.map((cat) => (
                  <button key={cat}
                    onClick={() => { setFilter("category", cat); setShowMobileFilters(false); }}
                    className={clsx(
                      "w-full text-left px-3 py-2.5 rounded-lg text-sm font-body min-h-[44px]",
                      category === cat ? "bg-market-500/20 text-market-300 font-medium" : "text-amber-700 hover:text-amber-400"
                    )}
                  >
                    {CATEGORY_ICONS[cat] ?? ""} {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Apply button */}
            <button
              onClick={() => setShowMobileFilters(false)}
              className="w-full btn-primary py-3 text-sm min-h-[44px]"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-6">
        <aside className="hidden lg:block w-52 flex-shrink-0 space-y-6">
          <div className="hidden lg:block border-b border-market-500/10 pb-4 mb-2">
            <p className="label mb-3">{t("jobs.filters")}</p>
            <JobFiltersPanel
              query={filterQuery}
              onQueryChange={updateFilters}
              collapsible={false}
            />
          </div>
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
                  <div key={cat} className="flex items-center gap-1 group/catrow">
                    <button onClick={() => setFilter("category", cat)}
                      className={clsx(
                        "flex-1 text-left px-3 py-2 rounded-lg text-sm font-body transition-all duration-200",
                        category === cat
                          ? "bg-market-500/20 text-market-300 font-medium ring-1 ring-market-500/30"
                          : "text-amber-700 hover:text-amber-400 hover:bg-market-500/8 hover:translate-x-0.5"
                      )}>
                      {CATEGORY_ICONS[cat] ?? ""} {cat}
                      <span className="ml-1 text-xs text-amber-800">({count})</span>
                    </button>

                    {/* Set job alert bell button */}
                    <button
                      id={`alert-btn-${cat.replace(/\s+/g, "-").toLowerCase()}`}
                      onClick={() => handleSetAlert(cat)}
                      title={isAlerted ? `Remove alert for "${cat}"` : `Set alert for "${cat}"`}
                      className={clsx(
                        "p-1.5 rounded-md transition-all duration-150 flex-shrink-0",
                        isAlerted
                          ? "text-market-300 bg-market-500/20 ring-1 ring-market-500/30"
                          : "text-amber-900 hover:text-market-400 hover:bg-market-500/10 opacity-0 group-hover/catrow:opacity-100"
                      )}
                    >
                      <BellIcon className="w-3.5 h-3.5" filled={isAlerted} />
                    </button>
                  </div>
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
            <StateMessage
              type="error"
              title={t("jobs.errorTitle")}
              description={t("jobs.tryAdjusting")}
              ctaLabel={t("jobs.errorRetry")}
              onCta={() => window.location.reload()}
            />
          ) : filtered.length === 0 ? (
            <div className="card text-center py-16 border border-amber-500 bg-amber-500/10">
              <h2 className="font-display text-xl mb-2 text-amber-100">No jobs found</h2>
              <p className="text-sm text-amber-800 mb-6 max-w-xs mx-auto">No jobs are currently available.</p>
              <Link href="/post-job" className="btn-primary text-sm">Post the first job</Link>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                {filtered.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    isFocused={focusedJobId === job.id}
                    onFocus={() => setFocusedJobId(job.id)}
                  />
                ))}
              </div>

              {nextCursor && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="btn-secondary text-sm min-w-40 min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
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

function BellIcon({ className, filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

function BriefcaseMiniIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" width={20} height={20}>
      <path fillRule="evenodd" d="M6 3.5A1.5 1.5 0 017.5 2h5A1.5 1.5 0 0114 3.5v1.5h2.5A1.5 1.5 0 0118 6.5v10a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 012 16.5v-10A1.5 1.5 0 013.5 5H6V3.5zM8 7a1 1 0 00-1 1v2a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
    </svg>
  );
}

function TagMiniIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" width={20} height={20}>
      <path fillRule="evenodd" d="M5.5 3A2.5 2.5 0 003 5.5v2.879a2.5 2.5 0 00.732 1.767l6.5 6.5a2.5 2.5 0 003.536 0l2.878-2.878a2.5 2.5 0 000-3.536l-6.5-6.5A2.5 2.5 0 008.38 3H5.5zM6 7a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  );
}

function CategoryMiniIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" width={20} height={20}>
      <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v1.5a1.5 1.5 0 01-3 0V6z" clipRule="evenodd" />
      <path d="M6 12a2 2 0 012-2h8a2 2 0 012 2v2a2 2 0 01-2 2H8a2 2 0 01-2-2v-2z" />
    </svg>
  );
}
