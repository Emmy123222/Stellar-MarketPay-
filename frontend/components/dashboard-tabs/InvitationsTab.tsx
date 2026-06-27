/**
 * components/dashboard-tabs/InvitationsTab.tsx
 * Tab for displaying job invitations in dashboard
 */
import Link from "next/link";
import { formatXLM, timeAgo } from "@/utils/format";
import type { JobInvitation } from "@/utils/types";

interface Props {
  myInvitations: JobInvitation[];
  onDecline: (id: string) => void;
}

export default function InvitationsTab({
  myInvitations,
  onDecline
}: Props) {
  if (myInvitations.length === 0) {
    return (
      <div className="card text-center py-16">
        <p className="font-display text-xl text-amber-100 mb-2">No invitations yet</p>
        <p className="text-amber-800 text-sm">When a client invites you to apply to their job, it will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {myInvitations.map((inv) => (
        <div key={inv.id} className="card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <Link href={`/jobs/${inv.jobId}`} className="font-display font-semibold text-amber-100 hover:text-market-300 transition-colors truncate block">
                {inv.jobTitle}
              </Link>
              <p className="text-xs text-amber-700 mt-0.5">
                From: {inv.clientName || inv.clientAddress.slice(0, 12) + "…"} · {timeAgo(inv.createdAt)}
              </p>
            </div>
            <span className="font-mono text-market-400 font-semibold text-sm flex-shrink-0">
              {formatXLM(inv.jobBudget)} {inv.jobCurrency}
            </span>
          </div>
          <p className="text-xs text-amber-700 bg-ink-800 rounded-lg px-3 py-2 border border-market-500/10">
            Hi! {inv.clientName || "A client"} has invited you to apply to their job: &ldquo;{inv.jobTitle}&rdquo; — {inv.jobBudget} {inv.jobCurrency}.{" "}
            <Link href={`/jobs/${inv.jobId}`} className="text-market-400 hover:underline">View Job</Link>
          </p>
          <div className="flex gap-2">
            <Link
              href={`/jobs/${inv.jobId}`}
              className="flex-1 btn-primary text-xs py-2 text-center"
            >
              View &amp; Apply
            </Link>
            <button
              onClick={() => onDecline(inv.id)}
              className="flex-1 btn-secondary text-xs py-2"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
