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
import type { paths } from "@/lib/api/schema";
import { typedClient, type QueryParams, type ResponseData } from "@/lib/api/typedClient";

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

/**
 * Strongly typed hook for OpenAPI GET endpoints (Issue #1888).
 */
export function useTypedApi<P extends keyof paths>(
  path: P | null,
  options?: {
    params?: QueryParams<P, "get">;
    config?: SWRConfiguration<ResponseData<P, "get", 200>>;
  },
): UseApiResult<ResponseData<P, "get", 200>> {
  const key = path
    ? options?.params
      ? `${path}?${new URLSearchParams(
          Object.entries(options.params as Record<string, unknown>).flatMap(([k, v]) =>
            v !== undefined && v !== null ? [[k, String(v)]] : [],
          ),
        ).toString()}`
      : path
    : null;

  return useApi<ResponseData<P, "get", 200>>(
    key,
    () => typedClient.get(path as P, options?.params),
    options?.config,
  );
}
