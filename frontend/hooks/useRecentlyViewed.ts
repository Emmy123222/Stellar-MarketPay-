import { useState, useEffect, useCallback } from "react";

const RECENTS_KEY = "recentlyViewedJobs";
const MAX_RECENTS = 10;

function getStoredRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(RECENTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function setStoredRecents(recents: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    // Ignore storage errors
  }
}

export function useRecentlyViewed() {
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    setRecentIds(getStoredRecents());
  }, []);

  const addRecentJob = useCallback((jobId: string) => {
    setRecentIds((prev) => {
      const filtered = prev.filter((id) => id !== jobId);
      const updated = [jobId, ...filtered].slice(0, MAX_RECENTS);
      setStoredRecents(updated);
      return updated;
    });
  }, []);

  const removeRecentJob = useCallback((jobId: string) => {
    setRecentIds((prev) => {
      const updated = prev.filter((id) => id !== jobId);
      setStoredRecents(updated);
      return updated;
    });
  }, []);

  const clearRecents = useCallback(() => {
    setRecentIds([]);
    setStoredRecents([]);
  }, []);

  return { recentIds, addRecentJob, removeRecentJob, clearRecents };
}
