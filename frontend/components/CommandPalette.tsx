import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { searchUnified, type UnifiedSearchResult } from "@/lib/api";

type EntityBadge = "Page" | "Job" | "Freelancer" | "Proposal";

type Result = {
  id: string;
  group: "Pages" | "Jobs" | "Freelancers" | "DAO Proposals";
  badge: EntityBadge;
  badgeColor: string;
  label: string;
  description: string;
  href: string;
  rank?: number;
};

const pages = [
  { id: "page-home", group: "Pages" as const, label: "Home", description: "Marketplace overview", href: "/" },
  { id: "page-jobs", group: "Pages" as const, label: "Browse Jobs", description: "Find open work", href: "/jobs" },
  { id: "page-freelancers", group: "Pages" as const, label: "Freelancers", description: "Browse talent", href: "/freelancers" },
  { id: "page-dao", group: "Pages" as const, label: "DAO Governance", description: "View proposals and voting", href: "/dao" },
  { id: "page-dashboard", group: "Pages" as const, label: "Dashboard", description: "Manage your work", href: "/dashboard" },
  { id: "page-post-job", group: "Pages" as const, label: "Post a Job", description: "Create a new listing", href: "/post-job" },
  { id: "page-insights", group: "Pages" as const, label: "Insights", description: "Marketplace analytics", href: "/insights" },
];

function score(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  let last = -1;
  let total = 0;
  for (const char of needle) {
    const index = haystack.indexOf(char, last + 1);
    if (index === -1) return 0;
    total += index === last + 1 ? 3 : 1;
    last = index;
  }
  return total + (haystack.includes(needle) ? 10 : 0);
}

export default function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UnifiedSearchResult>({
    jobs: [],
    freelancers: [],
    proposals: [],
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    if (!query.trim()) {
      setSearchResults({ jobs: [], freelancers: [], proposals: [] });
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const data = await searchUnified(query, 5);
        if (!controller.signal.aborted) {
          setSearchResults(data);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSearchResults({ jobs: [], freelancers: [], proposals: [] });
        }
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [isOpen, query]);

  const results = useMemo<Result[]>(() => {
    const pageResults: Result[] = pages
      .map((page) => ({ page, value: score(`${page.label} ${page.description}`, query) }))
      .filter(({ value }) => value > 0)
      .sort((a, b) => b.value - a.value)
      .map(({ page }) => ({
        ...page,
        badge: "Page",
        badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      }));

    const jobResults: Result[] = (searchResults.jobs || []).map((job) => ({
      id: `job-${job.id}`,
      group: "Jobs" as const,
      badge: "Job",
      badgeColor: "bg-blue-500/20 text-blue-300 border-blue-500/30",
      label: job.title,
      description: `${job.budget} ${job.currency} · ${job.category || "General"}`,
      href: `/jobs/${job.id}`,
      rank: job.rank,
    }));

    const freelancerResults: Result[] = (searchResults.freelancers || []).map((profile) => ({
      id: `freelancer-${profile.publicKey}`,
      group: "Freelancers" as const,
      badge: "Freelancer",
      badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      label: profile.displayName || profile.publicKey,
      description: profile.skills?.slice(0, 3).join(", ") || profile.bio || "Freelancer profile",
      href: `/freelancers/${encodeURIComponent(profile.publicKey)}`,
      rank: profile.rank,
    }));

    const proposalResults: Result[] = (searchResults.proposals || []).map((proposal) => ({
      id: `proposal-${proposal.id}`,
      group: "DAO Proposals" as const,
      badge: "Proposal",
      badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/30",
      label: proposal.title,
      description: `DAO Proposal (${proposal.type}) · ${proposal.status}`,
      href: `/dao#proposal-${proposal.id}`,
      rank: proposal.rank,
    }));

    return [...pageResults, ...jobResults, ...freelancerResults, ...proposalResults];
  }, [searchResults, query]);

  const go = useCallback((result: Result | undefined) => {
    if (!result) return;
    onClose();
    router.push(result.href);
  }, [onClose, router]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
      if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
      if (event.key === "Enter") { event.preventDefault(); go(results[activeIndex]); }
      if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button,[href],input,[tabindex]:not([tabindex="-1"])');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, go, isOpen, onClose, results]);

  if (!isOpen) return null;
  const groups = ["Pages", "Jobs", "Freelancers", "DAO Proposals"] as const;
  const activeId = results[activeIndex]?.id;
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[90] bg-ink-950/80 backdrop-blur-sm p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="mx-auto mt-24 max-w-2xl overflow-hidden rounded-2xl border border-market-500/30 bg-ink-900 shadow-2xl"
      >
        <div className="border-b border-market-500/20 p-4">
          <h2 id="command-palette-title" className="sr-only">Command palette</h2>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={activeId}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            placeholder="Search pages, jobs, freelancers, or DAO proposals…"
            className="input-field w-full"
          />
        </div>
        <div id="command-palette-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="p-6 text-center text-amber-300">No results found.</p>
          ) : (
            groups.map((group) => {
              const grouped = results.filter((result) => result.group === group);
              if (!grouped.length) return null;
              return (
                <div key={group} className="py-2">
                  <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-amber-500">
                    {group}
                  </p>
                  {grouped.map((result) => {
                    const index = results.findIndex((item) => item.id === result.id);
                    return (
                      <button
                        key={result.id}
                        id={result.id}
                        role="option"
                        aria-selected={index === activeIndex}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => go(result)}
                        className={`w-full rounded-xl px-3 py-3 text-left transition-colors ${
                          index === activeIndex ? "bg-market-500/20 text-amber-50" : "text-amber-100 hover:bg-ink-800"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="block font-medium truncate">{result.label}</span>
                          <span
                            className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${result.badgeColor}`}
                          >
                            {result.badge}
                          </span>
                        </div>
                        <span className="block text-sm text-amber-400 truncate mt-0.5">{result.description}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
