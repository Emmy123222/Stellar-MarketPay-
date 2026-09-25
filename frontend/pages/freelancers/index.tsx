/**
 * pages/freelancers/index.tsx
 * Browse freelancers with availability status filtering.
 */
import Head from "next/head";
import React, { useEffect, useState } from "react";
import { fetchProfiles } from "@/lib/api";
import {
  fetchSavedSearches,
  createSavedSearch,
  deleteSavedSearch,
  type SavedSearch,
} from "@/lib/api/savedSearches";
import FreelancerCard from "@/components/FreelancerCard";
import { availabilityStatusLabel } from "@/utils/format";
import type { AvailabilityStatus, UserProfile } from "@/utils/types";
import { useApi } from "@/hooks/useApi";

const availabilityOptions = [
  { value: "", label: "All statuses" },
  { value: "available", label: "Available" },
  { value: "busy", label: "Busy" },
  { value: "unavailable", label: "Unavailable" },
];

export default function FreelancersBrowsePage() {
  const [search, setSearch]           = useState("");
  const [availability, setAvailability] = useState<AvailabilityStatus | "">("");

  // Saved searches state
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [savingSearch, setSavingSearch]   = useState(false);
  const [saveSearchMsg, setSaveSearchMsg] = useState<string | null>(null);
  const [loadingSaved, setLoadingSaved]   = useState(true);

  useEffect(() => {
    let active = true;
    fetchSavedSearches()
      .then((searches) => {
        if (active) setSavedSearches(searches || []);
      })
      .catch(() => {
        // Fallback gracefully if unauthenticated or network error
      })
      .finally(() => {
        if (active) setLoadingSaved(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSaveSearch = async () => {
    const queryParams: Record<string, any> = {};
    if (search.trim()) queryParams.search = search.trim();
    if (availability) queryParams.availability = availability;

    if (Object.keys(queryParams).length === 0) {
      setSaveSearchMsg("Add search or availability filters before saving.");
      setTimeout(() => setSaveSearchMsg(null), 3000);
      return;
    }

    // Check if duplicate
    const alreadySaved = savedSearches.some((s) => {
      const qp = s.query_params || {};
      return (
        (qp.search || "") === (queryParams.search || "") &&
        (qp.availability || "") === (queryParams.availability || "")
      );
    });
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
      setSaveSearchMsg("Search saved successfully!");
      setTimeout(() => setSaveSearchMsg(null), 3000);
    } catch {
      setSaveSearchMsg("Failed to save search. Please try again.");
      setTimeout(() => setSaveSearchMsg(null), 3000);
    } finally {
      setSavingSearch(false);
    }
  };

  const handleApplySavedSearch = (saved: SavedSearch) => {
    const qp = saved.query_params || {};
    setSearch(qp.search || "");
    setAvailability((qp.availability as AvailabilityStatus) || "");
  };

  const handleDeleteSavedSearch = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteSavedSearch(id);
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // ignore
    }
  };

  // Stable cache key — changes when filters change, invalidating stale cache.
  const cacheKey = `freelancers:${availability}:${search}`;

  const { data, error, isLoading, isValidating } = useApi<{ profiles: UserProfile[]; nextCursor: string | null; hasMore: boolean }>(
    cacheKey,
    () =>
      fetchProfiles({
        role: "freelancer",
        availability: availability || undefined,
        search: search || undefined,
        limit: 60,
      }),
  );

  const profiles = data?.profiles ?? [];

  return (
    <>
      <Head>
        <title>Browse Freelancers | Stellar MarketPay</title>
      </Head>

      <main className="max-w-7xl mx-auto px-4 py-10 sm:px-6">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-amber-400/80">Freelancers</p>
            <h1 className="font-display text-4xl font-semibold text-amber-100 sm:text-5xl">
              Browse talent by availability.
            </h1>
          </div>
          <p className="max-w-2xl text-amber-300 text-sm leading-6">
            Filter freelancers by availability status and search skills, names, or account IDs.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="card space-y-5 p-6">
            <div>
              <h2 className="label">Filter</h2>
              <p className="text-amber-500 text-sm">Show freelancers by availability status.</p>
            </div>

            <div className="space-y-4">
              <label htmlFor="availability" className="block text-sm font-medium text-amber-100">Availability</label>
              <select id="availability"
                value={availability}
                onChange={(event) => setAvailability(event.target.value as AvailabilityStatus | "")}
                className="input-field w-full"
              >
                {availabilityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-4">
              <label htmlFor="search" className="block text-sm font-medium text-amber-100">Search</label>
              <input id="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by skills, name, or address"
                className="input-field w-full"
              />
            </div>

            {/* Save this search button */}
            <div className="pt-2">
              <button
                type="button"
                id="save-this-search-btn"
                onClick={handleSaveSearch}
                disabled={savingSearch}
                className="btn-secondary w-full flex items-center justify-center gap-2 py-2 text-sm disabled:opacity-50"
              >
                {savingSearch ? (
                  <span className="w-4 h-4 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                  </svg>
                )}
                Save this search
              </button>
              {saveSearchMsg && (
                <p className="mt-2 text-xs text-market-300 bg-market-500/10 border border-market-500/20 rounded p-1.5 text-center">
                  {saveSearchMsg}
                </p>
              )}
            </div>

            {/* My Searches panel */}
            <div className="pt-4 border-t border-[rgba(251,191,36,0.08)]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="label text-amber-100">My Searches</h3>
                {savedSearches.length > 0 && (
                  <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full font-medium">
                    {savedSearches.length}
                  </span>
                )}
              </div>
              <p className="text-xs text-amber-500 mb-3">Saved freelancer filter presets.</p>

              {loadingSaved ? (
                <div className="text-xs text-amber-600 animate-pulse">Loading saved searches…</div>
              ) : savedSearches.length === 0 ? (
                <p className="text-xs text-amber-700 italic">No saved searches yet.</p>
              ) : (
                <ul className="space-y-2" data-testid="saved-searches-list">
                  {savedSearches.map((s) => {
                    const qp = s.query_params || {};
                    const labelParts = [];
                    if (qp.search) labelParts.push(`"${qp.search}"`);
                    if (qp.availability) labelParts.push(availabilityStatusLabel(qp.availability));
                    const label = labelParts.length > 0 ? labelParts.join(" • ") : "All filters";

                    const isCurrent =
                      (qp.search || "") === (search || "") &&
                      (qp.availability || "") === (availability || "");

                    return (
                      <li
                        key={s.id}
                        className={`group flex items-center justify-between p-2.5 rounded-lg border text-xs transition-colors ${
                          isCurrent
                            ? "bg-market-500/15 border-market-500/30 text-market-300 font-medium"
                            : "bg-ink-900/40 border-amber-900/20 text-amber-200 hover:bg-market-500/10 hover:border-market-500/20"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleApplySavedSearch(s)}
                          className="truncate flex-1 text-left pr-2 cursor-pointer focus:outline-none focus:underline"
                          title="Click to restore these filters"
                        >
                          {label}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSavedSearch(e, s.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-amber-700 hover:text-red-400 transition-opacity"
                          title="Delete saved search"
                          aria-label={`Delete search ${label}`}
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <section className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-amber-400">{profiles.length} freelancers</p>
                  {isValidating && !isLoading && (
                    <span className="text-xs text-amber-600 animate-pulse">Refreshing…</span>
                  )}
                </div>
                <p className="text-amber-300 text-sm">
                  {availability ? availabilityStatusLabel(availability) : "Showing all freelancers"}
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="card py-10 text-center text-amber-300">Loading freelancers…</div>
            ) : error ? (
              <div className="card py-10 text-center text-red-400">{error.message}</div>
            ) : profiles.length === 0 ? (
              <div className="card py-10 text-center text-amber-300">
                No freelancers match the selected availability and search criteria.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {profiles.map((profile) => (
                  <FreelancerCard key={profile.publicKey} profile={profile} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
