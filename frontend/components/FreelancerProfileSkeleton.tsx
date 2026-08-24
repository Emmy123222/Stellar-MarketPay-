import React from 'react';

/**
 * FreelancerProfileSkeleton
 *
 * A skeleton loading component for the freelancer public profile page.
 * Mirrors the layout of the real profile to avoid layout shift.
 */
export default function FreelancerProfileSkeleton() {
  return (
    <div className="card space-y-6 animate-pulse" aria-busy="true">
      {/* Avatar and name */}
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 rounded-full bg-market-500/10" />
        <div className="space-y-2">
          <div className="h-6 w-48 bg-market-500/10 rounded" />
          <div className="h-4 w-32 bg-market-500/10 rounded" />
        </div>
      </div>

      {/* Bio – three lines with varying widths */}
      <div className="space-y-2">
        <div className="h-4 w-full bg-market-500/10 rounded" />
        <div className="h-4 w-5/6 bg-market-500/10 rounded" />
        <div className="h-4 w-4/6 bg-market-500/10 rounded" />
      </div>

      {/* Stats row – three rectangular boxes */}
      <div className="flex gap-4">
        <div className="flex-1 h-12 bg-market-500/10 rounded border border-market-500/15" />
        <div className="flex-1 h-12 bg-market-500/10 rounded border border-market-500/15" />
        <div className="flex-1 h-12 bg-market-500/10 rounded border border-market-500/15" />
      </div>

      {/* Skills section */}
      <div>
        <div className="h-5 w-24 bg-market-500/10 rounded mb-3" />
        <div className="flex flex-wrap gap-2">
          <div className="h-6 w-16 bg-market-500/10 rounded-full" />
          <div className="h-6 w-20 bg-market-500/10 rounded-full" />
          <div className="h-6 w-14 bg-market-500/10 rounded-full" />
          <div className="h-6 w-18 bg-market-500/10 rounded-full" />
          <div className="h-6 w-12 bg-market-500/10 rounded-full" />
        </div>
      </div>

      {/* Verified skills section */}
      <div>
        <div className="h-5 w-28 bg-market-500/10 rounded mb-3" />
        <div className="flex flex-wrap gap-2">
          <div className="h-7 w-24 bg-market-500/10 rounded-full" />
          <div className="h-7 w-20 bg-market-500/10 rounded-full" />
          <div className="h-7 w-16 bg-market-500/10 rounded-full" />
        </div>
      </div>

      {/* Portfolio section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="h-5 w-20 bg-market-500/10 rounded" />
          <div className="h-4 w-8 bg-market-500/10 rounded" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 bg-market-500/10 rounded-lg" />
          <div className="h-24 bg-market-500/10 rounded-lg" />
        </div>
      </div>

      {/* Endorsements section */}
      <div>
        <div className="h-5 w-32 bg-market-500/10 rounded mb-3" />
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-market-500/10" />
            <div className="h-4 w-32 bg-market-500/10 rounded" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-market-500/10" />
            <div className="h-4 w-28 bg-market-500/10 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
