/**
 * components/JobFiltersPanel.tsx
 * Advanced job search filters with URL sync (#280).
 */
import { useTranslation } from "@/lib/i18n";
import { POPULAR_SKILLS } from "@/utils/format";
import clsx from "clsx";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { createSavedSearch, fetchSavedSearches, type SavedSearch } from "@/lib/api";

export interface JobFilterQuery {
  search?: string;
  minBudget?: string;
  maxBudget?: string;
  min_budget?: string;
  max_budget?: string;
  skills?: string;
  minClientRating?: string;
  min_client_rating?: string;
  duration?: string;
  postedSince?: string;
  posted_since?: string;
  maxApplications?: string;
  max_applications?: string;
  status?: string;
  category?: string;
}

interface JobFiltersPanelProps {
  query?: JobFilterQuery;
  onQueryChange?: (patch: Partial<JobFilterQuery>, removeKeys?: string[]) => void;
  className?: string;
  collapsible?: boolean;
}

export function buildActiveFilterChips(
  query: JobFilterQuery,
  labels: Record<string, string>,
): { key: string; label: string; removeKeys: string[] }[] {
  const chips: { key: string; label: string; removeKeys: string[] }[] = [];
  if (query.search && query.search.trim()) {
    chips.push({
      key: "search",
      label: `${labels.search}: "${query.search.trim()}"`,
      removeKeys: ["search"],
    });
  }
  const minB = query.minBudget || query.min_budget;
  const maxB = query.maxBudget || query.max_budget;
  if (minB || maxB) {
    chips.push({
      key: "budget",
      label: `${labels.budget}: ${minB || "0"} – ${maxB || "∞"}`,
      removeKeys: ["minBudget", "maxBudget", "min_budget", "max_budget"],
    });
  }
  if (query.skills) {
    chips.push({
      key: "skills",
      label: `${labels.skills}: ${query.skills}`,
      removeKeys: ["skills"],
    });
  }
  const minRating = query.minClientRating || query.min_client_rating;
  if (minRating) {
    chips.push({
      key: "rating",
      label: `${labels.rating}: ${minRating}+`,
      removeKeys: ["minClientRating", "min_client_rating"],
    });
  }
  if (query.status && query.status !== "all" && query.status !== "open" && query.status !== "") {
    chips.push({
      key: "status",
      label: labels[`status_${query.status}`] || `${labels.status || "Status"}: ${query.status}`,
      removeKeys: ["status"],
    });
  }
  if (query.duration) {
    chips.push({
      key: "duration",
      label: labels[`duration_${query.duration}`] || query.duration,
      removeKeys: ["duration"],
    });
  }
  const posted = query.postedSince || query.posted_since;
  if (posted) {
    chips.push({
      key: "posted",
      label: labels[`posted_${posted}`] || posted,
      removeKeys: ["postedSince", "posted_since"],
    });
  }
  const maxApps = query.maxApplications || query.max_applications;
  if (maxApps) {
    chips.push({
      key: "apps",
      label: `${labels.applications}: ≤${maxApps}`,
      removeKeys: ["maxApplications", "max_applications"],
    });
  }
  return chips;
}

export default function JobFiltersPanel({
  query: propQuery,
  onQueryChange: propOnQueryChange,
  className,
  collapsible = true,
}: JobFiltersPanelProps) {
  const router = useRouter();
  const query = propQuery ?? (router?.isReady ? (router.query as JobFilterQuery) : {});
  const onQueryChange = propOnQueryChange ?? ((patch, removeKeys) => {
    if (!router?.isReady) return;
    const next: Record<string, any> = { ...router.query, ...patch, page: undefined };
    for (const key of removeKeys || []) {
      delete next[key];
      if (key === "minBudget") delete next["min_budget"];
      if (key === "maxBudget") delete next["max_budget"];
      if (key === "minClientRating") delete next["min_client_rating"];
      if (key === "postedSince") delete next["posted_since"];
      if (key === "maxApplications") delete next["max_applications"];
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") {
        delete next[k];
        if (k === "minBudget") delete next["min_budget"];
        if (k === "maxBudget") delete next["max_budget"];
        if (k === "minClientRating") delete next["min_client_rating"];
        if (k === "postedSince") delete next["posted_since"];
        if (k === "maxApplications") delete next["max_applications"];
      }
    }
    router.push({ pathname: router.pathname, query: next }, undefined, { shallow: true });
  });

  const { t } = useTranslation("common");
  const [open, setOpen] = useState(!collapsible);
  const [skillInput, setSkillInput] = useState(query.skills || "");
  const [searchInput, setSearchInput] = useState(query.search || "");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync skill and search inputs when external query changes (e.g. URL navigation / back / forward)
  useEffect(() => {
    setSkillInput(query.skills || "");
  }, [query.skills]);

  useEffect(() => {
    setSearchInput(query.search || "");
  }, [query.search]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [notifyInApp, setNotifyInApp] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedSkills = (query.skills || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const toggleSkill = (skill: string) => {
    const set = new Set(selectedSkills);
    if (set.has(skill)) set.delete(skill);
    else set.add(skill);
    const next = [...set].join(",");
    onQueryChange({ skills: next || undefined }, next ? undefined : ["skills"]);
  };

  const handleSaveSearch = async () => {
    setIsSaving(true);
    setSaveError(null);
    
    try {
      // Check if user has reached the limit
      const existingSearches = await fetchSavedSearches();
      if (existingSearches.length >= 10) {
        setSaveError("You can save up to 10 searches. Please delete one first.");
        setIsSaving(false);
        return;
      }

      await createSavedSearch({
        query_params: query,
        notify_in_app: notifyInApp,
        notify_email: notifyEmail,
      });
      
      setShowSaveModal(false);
      setNotifyInApp(true);
      setNotifyEmail(false);
    } catch (error) {
      setSaveError("Failed to save search. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      onQueryChange(
        { search: value.trim() || undefined },
        value.trim() ? undefined : ["search"],
      );
    }, 300);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    onQueryChange({}, ["search"]);
  };

  const hasActiveFilters = Object.values(query).some(
    (value) => value !== undefined && value !== ""
  );

  const panel = (
    <div className={clsx("space-y-5", className)}>
      {/* Keyword Search */}
      <div>
        <p className="label mb-2">{t("jobs.search") || "Search"}</p>
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-amber-800"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder={t("jobs.searchPlaceholder")}
            className="input-field pl-8 pr-8 text-xs"
            aria-label={t("jobs.search") || "Search jobs"}
          />
          {searchInput && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-amber-800 hover:text-amber-300 transition-colors"
              aria-label="Clear search"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div>
        <p className="label mb-2">{t("jobs.budgetRange")}</p>
        <div className="flex gap-2 items-center mb-2">
          <input
            type="number"
            placeholder={t("jobs.minBudget")}
            value={query.minBudget || query.min_budget || ""}
            onChange={(e) =>
              onQueryChange(
                { minBudget: e.target.value || undefined },
                e.target.value ? undefined : ["minBudget", "min_budget"],
              )
            }
            className="w-full bg-market-900/40 border border-amber-900/30 rounded px-2 py-1 text-xs text-amber-100"
          />
          <span className="text-amber-900 text-[10px] font-bold">–</span>
          <input
            type="number"
            placeholder={t("jobs.maxBudget")}
            value={query.maxBudget || query.max_budget || ""}
            onChange={(e) =>
              onQueryChange(
                { maxBudget: e.target.value || undefined },
                e.target.value ? undefined : ["maxBudget", "max_budget"],
              )
            }
            className="w-full bg-market-900/40 border border-amber-900/30 rounded px-2 py-1 text-xs text-amber-100"
          />
        </div>
        <input
          type="range"
          min={0}
          max={5000}
          step={10}
          value={query.maxBudget ? Number(query.maxBudget) : (query.max_budget ? Number(query.max_budget) : 500)}
          onChange={(e) =>
            onQueryChange({ maxBudget: e.target.value }, undefined)
          }
          className="w-full accent-market-400"
          aria-label={t("jobs.budgetRange")}
        />
      </div>

      <div>
        <p className="label mb-2">{t("jobs.skills")}</p>
        <input
          type="text"
          value={skillInput}
          onChange={(e) => setSkillInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (skillInput.trim() !== (query.skills || "")) {
                onQueryChange(
                  { skills: skillInput.trim() || undefined },
                  skillInput.trim() ? undefined : ["skills"],
                );
              }
            }
          }}
          onBlur={() => {
            if (skillInput.trim() !== (query.skills || "")) {
              onQueryChange(
                { skills: skillInput.trim() || undefined },
                skillInput.trim() ? undefined : ["skills"],
              );
            }
          }}
          placeholder={t("jobs.skillsPlaceholder")}
          className="input-field text-xs mb-2"
        />
        <div className="flex flex-wrap gap-1">
          {POPULAR_SKILLS.slice(0, 12).map((skill: string) => (
            <button
              key={skill}
              type="button"
              onClick={() => toggleSkill(skill)}
              className={clsx(
                "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                selectedSkills.includes(skill)
                  ? "bg-market-500/20 text-market-300 border-market-500/40"
                  : "text-amber-800 border-amber-900/30 hover:border-market-500/30",
              )}
            >
              {skill}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="label mb-2">{t("jobs.clientRating")}</p>
        <select
          value={query.minClientRating || query.min_client_rating || ""}
          onChange={(e) =>
            onQueryChange(
              { minClientRating: e.target.value || undefined },
              e.target.value ? undefined : ["minClientRating", "min_client_rating"],
            )
          }
          className="w-full bg-market-900/40 border border-amber-900/30 rounded px-2 py-1.5 text-xs text-amber-100"
        >
          <option value="">Any</option>
          <option value="3">3.0+</option>
          <option value="3.5">3.5+</option>
          <option value="4">4.0+</option>
          <option value="4.5">4.5+</option>
        </select>
      </div>

      <div>
        <p className="label mb-2">{t("jobs.duration")}</p>
        <select
          value={query.duration || ""}
          onChange={(e) =>
            onQueryChange(
              { duration: e.target.value || undefined },
              e.target.value ? undefined : ["duration"],
            )
          }
          className="w-full bg-market-900/40 border border-amber-900/30 rounded px-2 py-1.5 text-xs text-amber-100"
        >
          <option value="">Any</option>
          <option value="short">{t("jobs.durationShort")}</option>
          <option value="medium">{t("jobs.durationMedium")}</option>
          <option value="long">{t("jobs.durationLong")}</option>
        </select>
      </div>

      <div>
        <p className="label mb-2">{t("jobs.posted")}</p>
        <select
          value={query.postedSince || query.posted_since || ""}
          onChange={(e) =>
            onQueryChange(
              { postedSince: e.target.value || undefined },
              e.target.value ? undefined : ["postedSince", "posted_since"],
            )
          }
          className="w-full bg-market-900/40 border border-amber-900/30 rounded px-2 py-1.5 text-xs text-amber-100"
        >
          <option value="">Any time</option>
          <option value="today">{t("jobs.postedToday")}</option>
          <option value="week">{t("jobs.postedWeek")}</option>
          <option value="month">{t("jobs.postedMonth")}</option>
        </select>
      </div>

      <div>
        <p className="label mb-2">{t("jobs.applications")}</p>
        <button
          type="button"
          onClick={() => {
            const currentMax = query.maxApplications || query.max_applications;
            onQueryChange(
              currentMax === "5" ? {} : { maxApplications: "5" },
              currentMax === "5" ? ["maxApplications", "max_applications"] : undefined,
            );
          }}
          className={clsx(
            "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
            (query.maxApplications === "5" || query.max_applications === "5")
              ? "bg-market-500/15 text-market-300 font-medium"
              : "text-amber-700 hover:bg-market-500/8",
          )}
        >
          {t("jobs.lowCompetition")}
        </button>
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => setShowSaveModal(true)}
          className="btn-primary text-sm w-full"
        >
          Save Search
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          onQueryChange(
            {},
            [
              "search",
              "minBudget",
              "maxBudget",
              "min_budget",
              "max_budget",
              "skills",
              "minClientRating",
              "min_client_rating",
              "duration",
              "postedSince",
              "posted_since",
              "maxApplications",
              "max_applications",
              "status",
              "category",
            ],
          );
          setSkillInput("");
          setSearchInput("");
          if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        }}
        className="text-xs text-market-400 hover:text-market-300 font-semibold w-full"
      >
        {t("jobs.clearAll")}
      </button>
    </div>
  );

  if (!collapsible) {
    return (
      <>
        {panel}
        {showSaveModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-market-900 border border-amber-900/30 rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-amber-100 mb-4">Save Search</h3>
              
              <div className="space-y-3 mb-4">
                <label className="flex items-center gap-2 text-sm text-amber-100">
                  <input
                    type="checkbox"
                    checked={notifyInApp}
                    onChange={(e) => setNotifyInApp(e.target.checked)}
                    className="rounded border-amber-900/30 bg-market-800"
                  />
                  Notify me in-app when new jobs match
                </label>
                
                <label className="flex items-center gap-2 text-sm text-amber-100">
                  <input
                    type="checkbox"
                    checked={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.checked)}
                    className="rounded border-amber-900/30 bg-market-800"
                  />
                  Send me email notifications
                </label>
              </div>

              {saveError && (
                <p className="text-red-400 text-sm mb-4">{saveError}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSaveModal(false);
                    setSaveError(null);
                  }}
                  className="flex-1 btn-secondary text-sm"
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveSearch}
                  className="flex-1 btn-primary text-sm"
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save Search"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="lg:hidden mb-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-secondary text-sm w-full flex justify-between items-center"
          aria-expanded={open}
        >
          <span>{t("jobs.filters")}</span>
          <span>{open ? t("jobs.hideFilters") : t("jobs.showFilters")}</span>
        </button>
        {open && <div className="mt-4 card p-4">{panel}</div>}
      </div>

      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-market-900 border border-amber-900/30 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-amber-100 mb-4">Save Search</h3>
            
            <div className="space-y-3 mb-4">
              <label className="flex items-center gap-2 text-sm text-amber-100">
                <input
                  type="checkbox"
                  checked={notifyInApp}
                  onChange={(e) => setNotifyInApp(e.target.checked)}
                  className="rounded border-amber-900/30 bg-market-800"
                />
                Notify me in-app when new jobs match
              </label>
              
              <label className="flex items-center gap-2 text-sm text-amber-100">
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.checked)}
                  className="rounded border-amber-900/30 bg-market-800"
                />
                Send me email notifications
              </label>
            </div>

            {saveError && (
              <p className="text-red-400 text-sm mb-4">{saveError}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowSaveModal(false);
                  setSaveError(null);
                }}
                className="flex-1 btn-secondary text-sm"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSearch}
                className="flex-1 btn-primary text-sm"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save Search"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ActiveFilterChips({
  query,
  onRemove,
}: {
  query: JobFilterQuery;
  onRemove: (removeKeys: string[]) => void;
}) {
  const { t } = useTranslation("common");
  const labels = {
    search: t("jobs.search") || "Search",
    budget: t("jobs.budgetRange"),
    skills: t("jobs.skills"),
    rating: t("jobs.clientRating"),
    applications: t("jobs.applications"),
    duration_short: t("jobs.durationShort"),
    duration_medium: t("jobs.durationMedium"),
    duration_long: t("jobs.durationLong"),
    posted_today: t("jobs.postedToday"),
    posted_week: t("jobs.postedWeek"),
    posted_month: t("jobs.postedMonth"),
  };
  const chips = buildActiveFilterChips(query, labels);
  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <span className="text-xs text-amber-800 self-center">{t("jobs.activeFilters")}:</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onRemove(chip.removeKeys)}
          className="text-xs px-2.5 py-1 rounded-full bg-market-500/15 text-market-300 border border-market-500/25 hover:bg-market-500/25"
        >
          {chip.label} ×
        </button>
      ))}
    </div>
  );
}
