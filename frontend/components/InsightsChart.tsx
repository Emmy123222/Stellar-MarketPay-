import React from "react";
import type { CategoryAnalytics } from "@/lib/api";

export interface InsightsChartProps {
  loading?: boolean;
  categories?: CategoryAnalytics[];
  maxJobCount?: number;
  className?: string;
}

export function InsightsChartSkeleton({ className }: { className?: string }) {
  // Approximate heights of the 10 category bars to match the loaded chart shape
  const barHeights = [70, 45, 90, 60, 30, 80, 50, 65, 40, 55];

  return (
    <div
      data-testid="insights-chart-skeleton"
      className={`bg-white dark:bg-ink-800 rounded-lg shadow p-5 col-span-2 md:col-span-2 animate-pulse ${className || ""}`}
      aria-busy="true"
      aria-label="Loading chart data"
    >
      <div className="h-3 w-28 bg-gray-200 dark:bg-ink-700 rounded mb-3" />
      <div className="flex items-end gap-1 h-20">
        {barHeights.map((h, i) => (
          <div
            key={i}
            className="flex-1 bg-gray-200 dark:bg-ink-700 rounded-t min-w-0"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {barHeights.map((_, i) => (
          <div
            key={i}
            className="flex-1 h-2 bg-gray-200 dark:bg-ink-700 rounded min-w-0"
          />
        ))}
      </div>
    </div>
  );
}

export default function InsightsChart({
  loading = false,
  categories = [],
  maxJobCount,
  className,
}: InsightsChartProps) {
  if (loading) {
    return <InsightsChartSkeleton className={className} />;
  }

  const computedMax = maxJobCount ?? Math.max(1, ...categories.map((c) => c.jobCount));
  const displayCategories = categories.slice(0, 10);

  return (
    <div
      data-testid="insights-chart"
      className={`bg-white dark:bg-ink-800 rounded-lg shadow p-5 col-span-2 md:col-span-2 ${className || ""}`}
    >
      <p className="text-xs text-gray-500 dark:text-amber-700 mb-1">
        Jobs by Category
      </p>
      <div className="flex items-end gap-1 h-20">
        {displayCategories.map((c) => {
          const h = (c.jobCount / computedMax) * 100;
          return (
            <div
              key={c.category}
              title={`${c.category}: ${c.jobCount}`}
              className="flex-1 bg-gradient-to-t from-market-500/80 to-market-400 rounded-t min-w-0"
              style={{ height: `${Math.max(h, 2)}%` }}
            />
          );
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {displayCategories.map((c) => (
          <div
            key={c.category}
            className="flex-1 text-[9px] truncate text-center text-gray-500 dark:text-amber-700 min-w-0"
            title={c.category}
          >
            {c.category.split(" ")[0]}
          </div>
        ))}
      </div>
    </div>
  );
}
