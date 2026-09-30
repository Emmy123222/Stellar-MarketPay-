/**
 * pages/search.tsx
 * Unified Platform-Wide Search across Jobs, Freelancers, and DAO Proposals (#1558).
 */

import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useMemo } from "react";
import { searchUnified, type UnifiedSearchResult } from "@/lib/api";
import { shortenAddress } from "@/utils/format";

type SearchFilterTab = "all" | "jobs" | "freelancers" | "proposals";

export default function SearchPage() {
  const router = useRouter();
  const rawQ = (router.query.q as string) || "";
  const [searchTerm, setSearchTerm] = useState(rawQ);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<SearchFilterTab>("all");
  const [results, setResults] = useState<UnifiedSearchResult>({
    jobs: [],
    freelancers: [],
    proposals: [],
  });

  useEffect(() => {
    if (typeof router.query.q === "string") {
      setSearchTerm(router.query.q);
    }
  }, [router.query.q]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults({ jobs: [], freelancers: [], proposals: [] });
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const data = await searchUnified(searchTerm.trim(), 10);
        if (!cancelled) {
          setResults(data);
        }
      } catch {
        if (!cancelled) {
          setResults({ jobs: [], freelancers: [], proposals: [] });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchTerm.trim())}`, undefined, { shallow: true });
    }
  };

  const totalResults =
    (results.jobs?.length || 0) +
    (results.freelancers?.length || 0) +
    (results.proposals?.length || 0);

  const unifiedList = useMemo(() => {
    const list: Array<{
      id: string;
      type: "job" | "freelancer" | "proposal";
      badge: string;
      badgeColor: string;
      title: string;
      subtitle: string;
      description: string;
      href: string;
      rank: number;
    }> = [];

    (results.jobs || []).forEach((job) => {
      list.push({
        id: `job-${job.id}`,
        type: "job",
        badge: "Job",
        badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        title: job.title,
        subtitle: `${job.budget} ${job.currency} · ${job.category || "General"} · ${job.status}`,
        description: job.description,
        href: `/jobs/${job.id}`,
        rank: job.rank || 0,
      });
    });

    (results.freelancers || []).forEach((profile) => {
      list.push({
        id: `freelancer-${profile.publicKey}`,
        type: "freelancer",
        badge: "Freelancer",
        badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        title: profile.displayName || shortenAddress(profile.publicKey),
        subtitle: profile.skills?.length
          ? profile.skills.slice(0, 4).join(" · ")
          : `${profile.completedJobs || 0} completed jobs`,
        description: profile.bio || "Freelancer profile on Stellar MarketPay",
        href: `/freelancers/${encodeURIComponent(profile.publicKey)}`,
        rank: profile.rank || 0,
      });
    });

    (results.proposals || []).forEach((proposal) => {
      list.push({
        id: `proposal-${proposal.id}`,
        type: "proposal",
        badge: "DAO Proposal",
        badgeColor: "bg-purple-500/10 text-purple-400 border-purple-500/20",
        title: proposal.title,
        subtitle: `Type: ${proposal.type} · Status: ${proposal.status} · Proposer: ${shortenAddress(proposal.proposer)}`,
        description: proposal.description,
        href: `/dao#proposal-${proposal.id}`,
        rank: proposal.rank || 0,
      });
    });

    // Rank unified items by relevance rank descending
    return list.sort((a, b) => b.rank - a.rank);
  }, [results]);

  const filteredItems = useMemo(() => {
    if (activeTab === "all") return unifiedList;
    return unifiedList.filter((item) => {
      if (activeTab === "jobs") return item.type === "job";
      if (activeTab === "freelancers") return item.type === "freelancer";
      if (activeTab === "proposals") return item.type === "proposal";
      return true;
    });
  }, [unifiedList, activeTab]);

  return (
    <>
      <Head>
        <title>
          {searchTerm ? `Search: "${searchTerm}"` : "Platform Search"} | Stellar MarketPay
        </title>
      </Head>

      <div className="min-h-screen bg-ink-950 text-amber-50">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Header & Search Bar */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Platform-Wide Search
            </h1>
            <p className="mt-1 text-sm text-amber-200/70">
              Search across jobs, talent, and DAO governance proposals in a single unified index.
            </p>

            <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search jobs, skills, freelancers, or proposals…"
                  className="w-full rounded-xl border border-market-500/30 bg-ink-900 px-4 py-3 text-base text-white placeholder-amber-400/40 shadow-inner outline-none transition focus:border-market-500 focus:ring-1 focus:ring-market-500"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-amber-400/60 hover:text-amber-300"
                  >
                    Clear
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="rounded-xl bg-market-500 px-6 py-3 font-semibold text-ink-950 transition hover:bg-market-400"
              >
                Search
              </button>
            </form>
          </div>

          {/* Filter Tabs */}
          {searchTerm.trim() && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-market-500/20 pb-4">
              <div className="flex gap-2">
                {(
                  [
                    { id: "all", label: `All (${totalResults})` },
                    { id: "jobs", label: `Jobs (${results.jobs?.length || 0})` },
                    { id: "freelancers", label: `Freelancers (${results.freelancers?.length || 0})` },
                    { id: "proposals", label: `DAO Proposals (${results.proposals?.length || 0})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      activeTab === tab.id
                        ? "bg-market-500/20 text-market-400 border border-market-500/30"
                        : "text-amber-200/60 hover:bg-ink-900 hover:text-amber-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {loading && (
                <div className="flex items-center gap-2 text-xs text-amber-400 animate-pulse">
                  <span className="h-2 w-2 rounded-full bg-market-500" />
                  Searching...
                </div>
              )}
            </div>
          )}

          {/* Results List */}
          {!searchTerm.trim() ? (
            <div className="rounded-2xl border border-market-500/20 bg-ink-900/60 p-12 text-center">
              <p className="text-base text-amber-200/80">
                Enter keywords above to search all platform jobs, freelancer profiles, and DAO proposals.
              </p>
            </div>
          ) : filteredItems.length === 0 && !loading ? (
            <div className="rounded-2xl border border-market-500/20 bg-ink-900/60 p-12 text-center">
              <h3 className="text-lg font-semibold text-white">No matching results</h3>
              <p className="mt-1 text-sm text-amber-200/70">
                No items matched &ldquo;{searchTerm}&rdquo;. Try broader terms or check spelling.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block rounded-xl border border-market-500/20 bg-ink-900/80 p-4 transition hover:border-market-500/50 hover:bg-ink-800/80"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${item.badgeColor}`}
                        >
                          {item.badge}
                        </span>
                        <h2 className="truncate text-base font-semibold text-white hover:text-market-400">
                          {item.title}
                        </h2>
                      </div>
                      <p className="mt-1 text-xs text-amber-400/90">{item.subtitle}</p>
                      {item.description && (
                        <p className="mt-2 line-clamp-2 text-xs text-amber-200/70">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
