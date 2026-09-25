/**
 * components/ClientReputationCard.tsx
 * Issue #1432 — show a client's reputation on the job detail page so
 * freelancers can make informed apply decisions.
 *
 * Data comes from GET /api/profiles/:id/client-reputation (aggregate
 * completed / disputed / payment-release metrics) plus GET /api/profiles/:id
 * for the client's average rating (which is not in the reputation payload).
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

/** Any client with fewer than 3 completed jobs is labelled a "New client". */
export const NEW_CLIENT_THRESHOLD = 3;

function StarRow({ rating }: { rating: number }) {
  const rounded = Math.round(rating * 2) / 2;
  return (
    <span aria-label={`${rating.toFixed(1)} out of 5 stars`} className="text-market-400">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden>
          {rounded >= n ? "★" : rounded >= n - 0.5 ? "⯨" : "☆"}
        </span>
      ))}
    </span>
  );
}

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

  // Nothing useful to show — silently degrade rather than break the page.
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
        <div className="text-center sm:text-left">
          <p className="text-xs text-amber-800">Average Rating</p>
          <div className="mt-1 flex flex-col sm:flex-row sm:items-center sm:gap-2">
            {avgRating != null ? (
              <>
                <span className="font-mono font-bold text-lg text-market-400">
                  {avgRating.toFixed(1)}
                </span>
                <StarRow rating={avgRating} />
              </>
            ) : (
              <span className="text-sm text-amber-700">—</span>
            )}
          </div>
          {profile?.ratingCount != null && profile.ratingCount > 0 && (
            <p className="text-xs text-amber-800 mt-0.5">
              {profile.ratingCount} rating{profile.ratingCount === 1 ? "" : "s"}
            </p>
          )}
        </div>

        <div className="text-center sm:text-left">
          <p className="text-xs text-amber-800">Jobs Completed</p>
          <p className="mt-1 font-mono font-bold text-lg text-amber-100">
            {completed}
          </p>
        </div>

        <div className="text-center sm:text-left">
          <p className="text-xs text-amber-800">Dispute Rate</p>
          <p className="mt-1 font-mono font-bold text-lg text-amber-100">
            {disputePct.toFixed(disputePct < 1 && disputePct > 0 ? 1 : 0)}%
          </p>
        </div>
      </div>
    </div>
  );
}
