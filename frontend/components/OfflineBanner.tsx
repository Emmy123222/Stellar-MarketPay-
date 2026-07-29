/**
 * components/OfflineBanner.tsx
 * Offline status banner (Issue #292).
 *
 * Shows a persistent banner when the user loses connectivity.
 * Links to the offline page where last-viewed jobs are displayed.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { LAST_VIEWED_KEY } from "@/lib/offlineJobs";

function getCachedJobCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_VIEWED_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.length : 0;
  } catch {
    return 0;
  }
}

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true);
  const [cachedCount, setCachedCount] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);
    setCachedCount(getCachedJobCount());

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      // Refresh count when going offline so the banner is accurate
      setCachedCount(getCachedJobCount());
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 left-0 right-0 z-50 border-b border-yellow-500/30 bg-yellow-500/10 backdrop-blur-sm"
    >
      <div className="max-w-7xl mx-auto flex items-center gap-3 px-4 py-3">
        {/* Icon */}
        <div className="flex-shrink-0">
          <svg
            className="h-5 w-5 text-yellow-400"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        {/* Message */}
        <p className="flex-1 text-sm font-medium text-yellow-300">
          You are offline — cached data is shown. Changes will sync when you
          reconnect.
        </p>

        {/* Link to offline page with cached jobs */}
        {cachedCount > 0 && (
          <Link
            href="/offline"
            className="flex-shrink-0 text-xs font-semibold text-yellow-300 underline underline-offset-2 hover:text-yellow-200 transition-colors"
          >
            View {cachedCount} saved job{cachedCount !== 1 ? "s" : ""}
          </Link>
        )}
      </div>
    </div>
  );
}
