import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { fetchJobs, searchFreelancers } from "@/lib/api";
import type { Job, UserProfile } from "@/utils/types";

type Result = { id: string; group: "Pages" | "Jobs" | "Freelancers"; label: string; description: string; href: string };

const pages: Result[] = [
  { id: "page-home", group: "Pages", label: "Home", description: "Marketplace overview", href: "/" },
  { id: "page-jobs", group: "Pages", label: "Browse Jobs", description: "Find open work", href: "/jobs" },
  { id: "page-freelancers", group: "Pages", label: "Freelancers", description: "Browse talent", href: "/freelancers" },
  { id: "page-dashboard", group: "Pages", label: "Dashboard", description: "Manage your work", href: "/dashboard" },
  { id: "page-post-job", group: "Pages", label: "Post a Job", description: "Create a new listing", href: "/post-job" },
  { id: "page-insights", group: "Pages", label: "Insights", description: "Marketplace analytics", href: "/insights" },
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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [freelancers, setFreelancers] = useState<UserProfile[]>([]);
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
    const timer = window.setTimeout(async () => {
      try {
        const [jobData, freelancerData] = await Promise.all([
          fetchJobs({ search: query, limit: 5 }).then((r) => r.jobs).catch(() => []),
          searchFreelancers({ search: query, limit: 5 }).catch(() => []),
        ]);
        if (!controller.signal.aborted) {
          setJobs(jobData);
          setFreelancers(freelancerData);
        }
      } catch {
        if (!controller.signal.aborted) {
          setJobs([]);
          setFreelancers([]);
        }
      }
    }, 150);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [isOpen, query]);

  const results = useMemo<Result[]>(() => {
    const pageResults = pages
      .map((page) => ({ page, value: score(`${page.label} ${page.description}`, query) }))
      .filter(({ value }) => value > 0)
      .sort((a, b) => b.value - a.value)
      .map(({ page }) => page);
    return [
      ...pageResults,
      ...jobs.map((job) => ({ id: `job-${job.id}`, group: "Jobs" as const, label: job.title, description: `${job.budget} ${job.currency} · ${job.category}`, href: `/jobs/${job.id}` })),
      ...freelancers.map((profile) => ({ id: `freelancer-${profile.publicKey}`, group: "Freelancers" as const, label: profile.displayName || profile.publicKey, description: profile.skills?.slice(0, 3).join(", ") || "Freelancer profile", href: `/freelancers/${encodeURIComponent(profile.publicKey)}` })),
    ];
  }, [freelancers, jobs, query]);

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
  const groups = ["Pages", "Jobs", "Freelancers"] as const;
  const activeId = results[activeIndex]?.id;
  return (
    <div className="fixed inset-0 z-[90] bg-ink-950/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="command-palette-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} className="mx-auto mt-24 max-w-2xl overflow-hidden rounded-2xl border border-market-500/30 bg-ink-900 shadow-2xl">
        <div className="border-b border-market-500/20 p-4">
          <h2 id="command-palette-title" className="sr-only">Command palette</h2>
          <input ref={inputRef} role="combobox" aria-expanded="true" aria-controls="command-palette-results" aria-activedescendant={activeId} value={query} onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }} placeholder="Search pages, jobs, or freelancers…" className="input-field w-full" />
        </div>
        <div id="command-palette-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
          {results.length === 0 ? <p className="p-6 text-center text-amber-300">No results found.</p> : groups.map((group) => {
            const grouped = results.filter((result) => result.group === group);
            if (!grouped.length) return null;
            return <div key={group} className="py-2"><p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-amber-500">{group}</p>{grouped.map((result) => {
              const index = results.findIndex((item) => item.id === result.id);
              return <button key={result.id} id={result.id} role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => go(result)} className={`w-full rounded-xl px-3 py-3 text-left ${index === activeIndex ? "bg-market-500/20 text-amber-50" : "text-amber-100 hover:bg-ink-800"}`}><span className="block font-medium">{result.label}</span><span className="block text-sm text-amber-400">{result.description}</span></button>;
            })}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
