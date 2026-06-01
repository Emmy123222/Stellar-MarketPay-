/**
 * components/JobFiltersPanel.tsx
 * Advanced job search filters with URL sync (#280).
 */
import { useTranslation } from "@/lib/i18n";
import { POPULAR_SKILLS } from "@/utils/format";
import clsx from "clsx";
import { useState } from "react";

export interface JobFilterQuery {
  minBudget?: string;
  maxBudget?: string;
  skills?: string;
  minClientRating?: string;
  duration?: string;
  postedSince?: string;
  maxApplications?: string;
}

interface JobFiltersPanelProps {
  query: JobFilterQuery;
  onQueryChange: (patch: Partial<JobFilterQuery>, removeKeys?: string[]) => void;
  className?: string;
  collapsible?: boolean;
}

export function buildActiveFilterChips(
  query: JobFilterQuery,
  labels: Record<string, string>,
): { key: string; label: string; removeKeys: string[] }[] {
  const chips: { key: string; label: string; removeKeys: string[] }[] = [];
  if (query.minBudget || query.maxBudget) {
    chips.push({
      key: "budget",
      label: `${labels.budget}: ${query.minBudget || "0"} – ${query.maxBudget || "∞"}`,
      removeKeys: ["minBudget", "maxBudget"],
    });
  }
  if (query.skills) {
    chips.push({
      key: "skills",
      label: `${labels.skills}: ${query.skills}`,
      removeKeys: ["skills"],
    });
  }
  if (query.minClientRating) {
    chips.push({
      key: "rating",
      label: `${labels.rating}: ${query.minClientRating}+`,
      removeKeys: ["minClientRating"],
    });
  }
  if (query.duration) {
    chips.push({
      key: "duration",
      label: labels[`duration_${query.duration}`] || query.duration,
      removeKeys: ["duration"],
    });
  }
  if (query.postedSince) {
    chips.push({
      key: "posted",
      label: labels[`posted_${query.postedSince}`] || query.postedSince,
      removeKeys: ["postedSince"],
    });
  }
  if (query.maxApplications) {
    chips.push({
      key: "apps",
      label: `${labels.applications}: ≤${query.maxApplications}`,
      removeKeys: ["maxApplications"],
    });
  }
  return chips;
}

export default function JobFiltersPanel({
  query,
  onQueryChange,
  className,
  collapsible = true,
}: JobFiltersPanelProps) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(!collapsible);
  const [skillInput, setSkillInput] = useState(query.skills || "");

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

  const panel = (
    <div className={clsx("space-y-5", className)}>
      <div>
        <p className="label mb-2">{t("jobs.budgetRange")}</p>
        <div className="flex gap-2 items-center mb-2">
          <input
            type="number"
            placeholder={t("jobs.minBudget")}
            value={query.minBudget || ""}
            onChange={(e) =>
              onQueryChange(
                { minBudget: e.target.value || undefined },
                e.target.value ? undefined : ["minBudget"],
              )
            }
            className="w-full bg-market-900/40 border border-amber-900/30 rounded px-2 py-1 text-xs text-amber-100"
          />
          <span className="text-amber-900 text-[10px] font-bold">–</span>
          <input
            type="number"
            placeholder={t("jobs.maxBudget")}
            value={query.maxBudget || ""}
            onChange={(e) =>
              onQueryChange(
                { maxBudget: e.target.value || undefined },
                e.target.value ? undefined : ["maxBudget"],
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
          value={query.maxBudget ? Number(query.maxBudget) : 500}
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
          {POPULAR_SKILLS.slice(0, 12).map((skill) => (
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
          value={query.minClientRating || ""}
          onChange={(e) =>
            onQueryChange(
              { minClientRating: e.target.value || undefined },
              e.target.value ? undefined : ["minClientRating"],
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
          value={query.postedSince || ""}
          onChange={(e) =>
            onQueryChange(
              { postedSince: e.target.value || undefined },
              e.target.value ? undefined : ["postedSince"],
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
          onClick={() =>
            onQueryChange(
              query.maxApplications === "5" ? {} : { maxApplications: "5" },
              query.maxApplications === "5" ? ["maxApplications"] : undefined,
            )
          }
          className={clsx(
            "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
            query.maxApplications === "5"
              ? "bg-market-500/15 text-market-300 font-medium"
              : "text-amber-700 hover:bg-market-500/8",
          )}
        >
          {t("jobs.lowCompetition")}
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          onQueryChange(
            {},
            [
              "minBudget",
              "maxBudget",
              "skills",
              "minClientRating",
              "duration",
              "postedSince",
              "maxApplications",
            ],
          );
          setSkillInput("");
        }}
        className="text-xs text-market-400 hover:text-market-300 font-semibold w-full"
      >
        {t("jobs.clearAll")}
      </button>
    </div>
  );

  if (!collapsible) {
    return panel;
  }

  return (
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
