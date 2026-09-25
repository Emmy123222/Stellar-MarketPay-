/**
 * components/ClientReputationCard.tsx
 * Issue #1432 — show a client's reputation on the job detail page so
 * freelancers can make informed apply decisions.
 */
import { useEffect, useState } from "react";
import {
  fetchClientReputation,
  fetchPublicProfile,
} from "@/lib/api/profiles";
import type { ClientReputation, UserProfile } from "@/utils/types";

interface Props {
  clientPublicKey: string;
}

export const NEW_CLIENT_THRESHOLD = 3;

export default function ClientReputationCard({ clientPublicKey }: Props) {
  const [rep, setRep] = useState<ClientReputation | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      fetchClientReputation(clientPublicKey).catch(() => null),
      fetchPublicProfile(clientPublicKey).catch(() => null),
    ])
      .then(([r, p]) => {
        if (!mounted) return;
        setRep(r);
        setProfile(p);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [clientPublicKey]);

  if (loading) {
    return (
      <div className="mt-5 pt-5 border-t border-market-500/10" aria-busy="true">
        <div className="h-4 w-32 bg-market-500/10 rounded mb-3" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-14 bg-market-500/8 rounded" />
          <div className="h-14 bg-market-500/8 rounded" />
          <div className="h-14 bg-market-500/8 rounded" />
        </div>
      </div>
    );
  }

  if (!rep) return null;

  const completed = rep.totals.completedJobs;
  const isNewClient = completed < NEW_CLIENT_THRESHOLD;
  const avgRating = profile?.rating ?? null;
  const disputePct = rep.disputeRate * 100;

  return (
    <div className="mt-5 pt-5 border-t border-market-500/10">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs sm:text-sm text-amber-700 font-medium">
          Client Reputation
        </p>
        {isNewClient && (
          <span
            className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30"
            title={`Fewer than ${NEW_CLIENT_THRESHOLD} completed jobs`}
          >
            New client
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-amber-800">Average Rating</p>
          <p className="mt-1 font-mono font-bold text-lg text-market-400">
            {avgRating != null ? avgRating.toFixed(1) : "—"}
          </p>
          {profile?.ratingCount != null && profile.ratingCount > 0 && (
            <p className="text-xs text-amber-800 mt-0.5">
              {profile.ratingCount} rating{profile.ratingCount === 1 ? "" : "s"}
            </p>
          )}
        </div>

        <div>
          <p className="text-xs text-amber-800">Jobs Completed</p>
          <p className="mt-1 font-mono font-bold text-lg text-amber-100">
            {completed}
          </p>
        </div>

        <div>
          <p className="text-xs text-amber-800">Dispute Rate</p>
          <p className="mt-1 font-mono font-bold text-lg text-amber-100">
            {disputePct.toFixed(disputePct > 0 && disputePct < 1 ? 1 : 0)}%
          </p>
        </div>
      </div>
    </div>
  );
}