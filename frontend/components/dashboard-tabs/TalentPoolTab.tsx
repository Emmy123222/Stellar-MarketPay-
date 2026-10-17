/**
 * components/dashboard-tabs/TalentPoolTab.tsx
 * Client's saved freelancers — view, remove, and invite to a job (Issue #1550).
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { shortenAddress, availabilityStatusLabel } from "@/utils/format";
import StateMessage from "@/components/StateMessage";
import type { TalentPoolEntry } from "@/lib/api/talentPool";
import { removeFromTalentPool, inviteFromTalentPool } from "@/lib/api/talentPool";
import type { Job } from "@/utils/types";

interface Props {
  entries: TalentPoolEntry[];
  openJobs: Job[];
  onRemoved: (id: string) => void;
  onInvited: () => void;
}

export default function TalentPoolTab({ entries, openJobs, onRemoved, onInvited }: Props) {
  const router = useRouter();
  const [inviting, setInviting] = useState<string | null>(null); // entry id being invited
  const [selectedJob, setSelectedJob] = useState<Record<string, string>>({}); // entryId → jobId

  if (entries.length === 0) {
    return (
      <StateMessage
        type="empty"
        title="Your talent pool is empty"
        description="Browse freelancers and save the ones you'd like to work with again"
        ctaLabel="Browse Freelancers"
        onCta={() => router.push("/freelancers")}
      />
    );
  }

  const handleRemove = async (id: string) => {
    await removeFromTalentPool(id);
    onRemoved(id);
  };

  const handleInvite = async (entryId: string) => {
    const jobId = selectedJob[entryId];
    if (!jobId) return;
    setInviting(entryId);
    try {
      await inviteFromTalentPool(entryId, jobId);
      onInvited();
    } finally {
      setInviting(null);
    }
  };

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div key={entry.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <Link
            href={`/freelancers/${encodeURIComponent(entry.freelancer_address)}`}
            className="flex-1 min-w-0"
          >
            <p className="font-semibold text-amber-100 truncate">
              {entry.display_name || shortenAddress(entry.freelancer_address)}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {availabilityStatusLabel(entry.availability?.status)}
              {entry.rating != null ? ` · ★ ${entry.rating.toFixed(1)}` : ""}
              {` · ${entry.completed_jobs} job${entry.completed_jobs !== 1 ? "s" : ""} completed`}
            </p>
            {entry.skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {entry.skills.slice(0, 5).map((s) => (
                  <span key={s} className="text-xs bg-market-500/8 text-market-500/80 border border-market-500/15 px-2 py-0.5 rounded-md">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </Link>

          <div className="flex items-center gap-2 flex-shrink-0">
            {openJobs.length > 0 && (
              <>
                <select
                  value={selectedJob[entry.id] ?? ""}
                  onChange={(e) => setSelectedJob((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                  className="text-xs rounded-lg bg-ink-900/60 border border-market-500/20 text-amber-100 px-2 py-2 max-w-[160px]"
                  aria-label="Select job to invite"
                >
                  <option value="" disabled>Invite to job…</option>
                  {openJobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.title}</option>
                  ))}
                </select>
                <button
                  onClick={() => handleInvite(entry.id)}
                  disabled={!selectedJob[entry.id] || inviting === entry.id}
                  className="btn-primary text-xs px-3 py-2 disabled:opacity-50"
                >
                  {inviting === entry.id ? "Sending…" : "Invite"}
                </button>
              </>
            )}
            <button
              onClick={() => handleRemove(entry.id)}
              className="btn-secondary text-xs px-3 py-2"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
