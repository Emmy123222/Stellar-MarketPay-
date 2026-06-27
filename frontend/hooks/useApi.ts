/**
 * hooks/useApi.ts
 * Thin SWR wrapper that provides stale-while-revalidate caching for API calls.
 *
 * Usage:
 *   const { data, error, isLoading, isValidating } = useApi("/api/jobs", fetchJobs);
 *
 * - Cached data is shown immediately on back-navigation (no loading flash).
 * - Revalidates on window focus automatically.
 * - `isValidating` is true while a background refresh is in flight, letting
 *   the UI show a subtle "Refreshing…" indicator without hiding stale data.
 */
import useSWR, { type SWRConfiguration } from "swr";

export interface UseApiResult<T> {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isValidating: boolean;
}

/**
 * @param key       Unique cache key (typically the API endpoint path or a
 *                  serialised params object). Pass `null` to skip fetching.
 * @param fetcher   Async function that resolves to the data. Receives `key`
 *                  as its only argument.
 * @param config    Optional SWR configuration overrides.
 */
export function useApi<T>(
  key: string | null,
  fetcher: (key: string) => Promise<T>,
  config?: SWRConfiguration<T>,
): UseApiResult<T> {
  const { data, error, isLoading, isValidating } = useSWR<T>(key, fetcher, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 5_000,
    ...config,
  });

  return {
    data,
    error: error as Error | undefined,
    isLoading,
    isValidating,
  };
}
