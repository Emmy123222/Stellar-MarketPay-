import { useState, useEffect, useCallback } from "react";
import { fetchJob } from "@/lib/api";
import type { Job } from "@/utils/types";

const BOOKMARKS_KEY = "bookmarkedJobs";

function getStoredBookmarks(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function setStoredBookmarks(bookmarks: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch {
    // Ignore storage errors
  }
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<string[]>([]);

  useEffect(() => {
    setBookmarks(getStoredBookmarks());
  }, []);

  const isSaved = useCallback(
    (jobId: string) => {
      return bookmarks.includes(jobId);
    },
    [bookmarks],
  );

  const toggleBookmark = useCallback(
    (jobId: string) => {
      const newBookmarks = isSaved(jobId)
        ? bookmarks.filter((id) => id !== jobId)
        : [...bookmarks, jobId];

      setBookmarks(newBookmarks);
      setStoredBookmarks(newBookmarks);
    },
    [bookmarks, isSaved],
  );

  const savedCount = bookmarks.length;

  const getSavedJobs = useCallback(async (): Promise<Job[]> => {
    const jobs = await Promise.allSettled(bookmarks.map((id) => fetchJob(id)));
    return jobs
      .filter(
        (result): result is PromiseFulfilledResult<Job> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
  }, [bookmarks]);

  return {
    isSaved,
    toggleBookmark,
    savedCount,
    getSavedJobs,
    bookmarks,
  };
}
