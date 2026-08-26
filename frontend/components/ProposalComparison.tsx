"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { acceptApplication, fetchPublicProfile } from "@/lib/api";
import { formatXLM, shortenAddress } from "@/utils/format";
import type { Application, Job, UserProfile } from "@/utils/types";
import StateMessage from "@/components/StateMessage";

interface Props {
  myJobs: Job[];
  jobApplications: Map<string, Application[]>;
  publicKey: string;
}

const TIER_COLORS: Record<string, string> = {
  Newcomer: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  "Rising Talent": "bg-blue-500/10 text-blue-400 border-blue-500/30",
  "Top Rated": "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  Expert: "bg-purple-500/10 text-purple-400 border-purple-500/30",
};

export default function ProposalComparison({ myJobs, jobApplications, publicKey }: Props) {
  const router = useRouter();
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const applications = selectedJobId ? jobApplications.get(selectedJobId) ?? [] : [];
  const selectedApplications = applications.filter((a) => selectedProposalIds.has(a.id));

  const totalProposals = useMemo(() => {
    let count = 0;
    jobApplications.forEach((apps) => { count += apps.length; });
    return count;
  }, [jobApplications]);

  useEffect(() => {
    const job = router.query.job as string;
    const compare = router.query.compare as string;
    if (job && myJobs.some((j) => j.id === job)) {
      setSelectedJobId(job);
    }
    if (compare) {
      const ids = compare.split(",").filter(Boolean);
      if (ids.length >= 2 && ids.length <= 4) {
        setSelectedProposalIds(new Set(ids));
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    const freshest = jobApplications.get(selectedJobId) ?? [];
    const validIds = new Set(freshest.map((a) => a.id));
    const pruned = new Set([...selectedProposalIds].filter((id) => validIds.has(id)));
    if (pruned.size !== selectedProposalIds.size) {
      setSelectedProposalIds(pruned);
    }
  }, [selectedJobId, jobApplications]);

  const syncUrl = (jobId: string, ids: Set<string>) => {
    const query: Record<string, string | undefined> = { ...router.query };
    const query: Record<string, string | undefined> = Object.fromEntries(
      Object.entries(router.query).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    );
    if (jobId) query.job = jobId;
    else delete query.job;
    if (ids.size >= 2) query.compare = [...ids].join(",");
    else delete query.compare;
    router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  const selectJob = (jobId: string) => {
    setSelectedProposalIds(new Set());
    setSelectedJobId(jobId);
    syncUrl(jobId, new Set());
  };

  const toggleProposal = (id: string) => {
    setSelectedProposalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 4) return prev;
        next.add(id);
      }
      syncUrl(selectedJobId, next);
      return next;
    });
  };

  const handleAccept = async (application: Application) => {
    setAcceptingId(application.id);
    try {
      await acceptApplication(application.id, publicKey);
      window.location.reload();
    } catch {
      setAcceptingId(null);
    }
  };

  useEffect(() => {
    if (selectedApplications.length < 2) return;
    const addresses = selectedApplications.map((a) => a.freelancerAddress).filter(Boolean);
    addresses.forEach((addr) => {
      if (profiles.has(addr)) return;
      fetchPublicProfile(addr).then((profile) => {
        if (profile) {
          setProfiles((prev) => new Map(prev).set(addr, profile));
        }
      });
    });
  }, [selectedProposalIds]);

  if (myJobs.length === 0) {
    return (
      <StateMessage
        type="empty"
        title="No jobs posted yet"
        description="Post a job to start receiving proposals"
        ctaLabel="Post a Job"
        onCta={() => router.push("/post-job")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-amber-100 mb-3">Your Jobs</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {myJobs.map((job) => {
            const apps = jobApplications.get(job.id) ?? [];
            const pending = apps.filter((a) => a.status === "pending").length;
            return (
              <button
                key={job.id}
                onClick={() => selectJob(job.id)}
                className={`text-left rounded-xl border p-4 transition-all ${
                  selectedJobId === job.id
                    ? "border-market-400 bg-market-500/10"
                    : "border-market-500/20 bg-ink-800/50 hover:border-market-500/40"
                }`}
              >
                <p className="text-sm font-medium text-amber-100 truncate">{job.title}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-amber-700">
                  <span>{apps.length} proposal{apps.length !== 1 ? "s" : ""}</span>
                  {pending > 0 && (
                    <span className="text-market-400">{pending} pending</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedJobId && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-amber-200">
              Proposals ({applications.length})
            </h3>
            {selectedProposalIds.size > 0 && selectedProposalIds.size < 2 && (
              <p className="text-xs text-amber-600">
                Select at least 2 proposals to compare
              </p>
            )}
          </div>

          {applications.length === 0 ? (
            <StateMessage
              type="empty"
              title="No proposals yet"
              description="Proposals will appear here when freelancers apply"
            />
          ) : selectedProposalIds.size < 2 ? (
            <div className="space-y-2">
              {applications.map((app) => (
                <button
                  key={app.id}
                  onClick={() => toggleProposal(app.id)}
                  disabled={!selectedProposalIds.has(app.id) && selectedProposalIds.size >= 4}
                  className={`w-full text-left rounded-xl border p-4 transition-all ${
                    selectedProposalIds.has(app.id)
                      ? "border-market-400 bg-market-500/10"
                      : "border-market-500/20 bg-ink-800/50 hover:border-market-500/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                        selectedProposalIds.has(app.id)
                          ? "border-market-400 bg-market-400"
                          : "border-amber-600"
                      }`}>
                        {selectedProposalIds.has(app.id) && (
                          <svg className="w-2.5 h-2.5 text-ink-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className="text-sm text-amber-100 font-medium truncate">
                        {shortenAddress(app.freelancerAddress)}
                      </span>
                      {app.freelancerTier && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${TIER_COLORS[app.freelancerTier] || TIER_COLORS.Newcomer}`}>
                          {app.freelancerTier}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-sm text-market-400 flex-shrink-0">
                      {formatXLM(app.bidAmount)}
                    </span>
                  </div>
                  <p className="text-xs text-amber-700 mt-2 line-clamp-2">{app.proposal}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className={`grid gap-4 ${
              selectedApplications.length === 2 ? "grid-cols-1 sm:grid-cols-2" :
              selectedApplications.length === 3 ? "grid-cols-1 sm:grid-cols-3" :
              "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
            }`}>
              {selectedApplications.map((app) => {
                const profile = app.freelancerAddress ? profiles.get(app.freelancerAddress) : undefined;
                return (
                  <div key={app.id} className="rounded-xl border border-market-500/20 bg-ink-800/50 p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-amber-100 truncate">
                          {shortenAddress(app.freelancerAddress)}
                        </p>
                        {app.freelancerTier && (
                          <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${TIER_COLORS[app.freelancerTier] || TIER_COLORS.Newcomer}`}>
                            {app.freelancerTier}
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-lg font-bold text-market-400 flex-shrink-0">
                        {formatXLM(app.bidAmount)}
                      </span>
                    </div>

                    {profile && profile.rating != null && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-600">
                        <span className="text-yellow-400">{Array(Math.round(profile.rating)).fill("★").join("")}</span>
                        <span>{profile.rating.toFixed(1)}</span>
                        {profile.ratingCount != null && (
                          <span>({profile.ratingCount})</span>
                        )}
                      </div>
                    )}

                    <div className="flex-1 min-h-0">
                      <p className="text-xs text-amber-700 leading-relaxed line-clamp-6 whitespace-pre-wrap">
                        {app.proposal}
                      </p>
                    </div>

                    <button
                      onClick={() => handleAccept(app)}
                      disabled={acceptingId === app.id || app.status !== "pending"}
                      className={`w-full py-2 rounded-lg text-xs font-semibold transition-all ${
                        app.status === "accepted"
                          ? "bg-emerald-500/20 text-emerald-400 cursor-default"
                          : app.status === "rejected"
                          ? "bg-red-500/20 text-red-400 cursor-default"
                          : acceptingId === app.id
                          ? "bg-indigo-500/50 text-white cursor-wait"
                          : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95"
                      }`}
                    >
                      {app.status === "accepted"
                        ? "Accepted"
                        : app.status === "rejected"
                        ? "Rejected"
                        : acceptingId === app.id
                        ? "Accepting..."
                        : "Accept Proposal"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
