/**
 * pages/freelancers/index.tsx
 * Browse freelancers with availability status filtering.
 */
import Head from "next/head";
import { useState } from "react";
import { fetchProfiles } from "@/lib/api";
import FreelancerCard from "@/components/FreelancerCard";
import { availabilityStatusLabel } from "@/utils/format";
import type { AvailabilityStatus, UserProfile } from "@/utils/types";
import { useApi } from "@/hooks/useApi";

const availabilityOptions = [
  { value: "", label: "All statuses" },
  { value: "available", label: "Available" },
  { value: "busy", label: "Busy" },
  { value: "unavailable", label: "Unavailable" },
];

export default function FreelancersBrowsePage() {
  const [search, setSearch]           = useState("");
  const [availability, setAvailability] = useState<AvailabilityStatus | "">("");

  // Stable cache key — changes when filters change, invalidating stale cache.
  const cacheKey = `freelancers:${availability}:${search}`;

  const { data, error, isLoading, isValidating } = useApi<UserProfile[]>(
    cacheKey,
    () =>
      fetchProfiles({
        role: "freelancer",
        availability: availability || undefined,
        search: search || undefined,
        limit: 60,
      }),
  );

  const profiles = data ?? [];

  return (
    <>
      <Head>
        <title>Browse Freelancers | Stellar MarketPay</title>
      </Head>

      <main className="max-w-7xl mx-auto px-4 py-10 sm:px-6">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-amber-400/80">Freelancers</p>
            <h1 className="font-display text-4xl font-semibold text-amber-100 sm:text-5xl">
              Browse talent by availability.
            </h1>
          </div>
          <p className="max-w-2xl text-amber-300 text-sm leading-6">
            Filter freelancers by availability status and search skills, names, or account IDs.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="card space-y-5 p-6">
            <div>
              <h2 className="label">Filter</h2>
              <p className="text-amber-500 text-sm">Show freelancers by availability status.</p>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium text-amber-100">Availability</label>
              <select
                value={availability}
                onChange={(event) => setAvailability(event.target.value as AvailabilityStatus | "")}
                className="input-field w-full"
              >
                {availabilityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium text-amber-100">Search</label>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by skills, name, or address"
                className="input-field w-full"
              />
            </div>
          </aside>

          <section className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-amber-400">{profiles.length} freelancers</p>
                  {isValidating && !isLoading && (
                    <span className="text-xs text-amber-600 animate-pulse">Refreshing…</span>
                  )}
                </div>
                <p className="text-amber-300 text-sm">
                  {availability ? availabilityStatusLabel(availability) : "Showing all freelancers"}
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="card py-10 text-center text-amber-300">Loading freelancers…</div>
            ) : error ? (
              <div className="card py-10 text-center text-red-400">{error.message}</div>
            ) : profiles.length === 0 ? (
              <div className="card py-10 text-center text-amber-300">
                No freelancers match the selected availability and search criteria.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {profiles.map((profile) => (
                  <FreelancerCard key={profile.publicKey} profile={profile} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
