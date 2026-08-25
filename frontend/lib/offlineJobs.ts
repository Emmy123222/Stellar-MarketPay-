/**
 * lib/offlineJobs.ts  (Issue #292)
 *
 * Helpers for persisting last-viewed jobs to localStorage so the offline
 * fallback page can display them without a network connection.
 */
import type { Job } from "@/utils/types";

export const LAST_VIEWED_KEY = "marketpay_last_viewed_jobs";
const MAX_STORED = 10;

/** Persist a job to the last-viewed list. Call this when a job detail page loads. */
export function recordViewedJob(job: Job): void {
  if (typeof window === "undefined") return;
  try {
    const existing: Job[] = JSON.parse(
      localStorage.getItem(LAST_VIEWED_KEY) ?? "[]"
    );
    // Deduplicate by id, keep most-recent first, cap at MAX_STORED
    const updated = [
      job,
      ...existing.filter((j) => j.id !== job.id),
    ].slice(0, MAX_STORED);
    localStorage.setItem(LAST_VIEWED_KEY, JSON.stringify(updated));
  } catch {
    // Non-fatal
  }
}

/** Read last-viewed jobs from localStorage. */
export function getLastViewedJobs(): Job[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LAST_VIEWED_KEY) ?? "[]");
  } catch {
    return [];
  }
}
