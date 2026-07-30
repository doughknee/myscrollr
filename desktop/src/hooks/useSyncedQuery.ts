/**
 * useSyncedQuery — combines TanStack Query polling with Tauri store sync.
 *
 * Replaces the repeated pattern:
 *   const [data, setData] = useStoreData(key, loadFn);
 *   const { data: queryData, error } = useQuery({ ... });
 *   useEffect(() => { if (queryData) { setData(queryData); saveFn(queryData); } }, [queryData]);
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStoreData } from "./useStoreData";

interface UseSyncedQueryOptions<T> {
  storeKey: string;
  loadFn: () => T[];
  saveFn: (data: T[]) => void;
  queryKey: unknown[];
  queryFn: () => Promise<T[]>;
  enabled: boolean;
  pollInterval: number;
  retry?: number;
}

export function useSyncedQuery<T>(opts: UseSyncedQueryOptions<T>): {
  data: T[];
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
} {
  const [data, setData] = useStoreData(opts.storeKey, opts.loadFn);

  const { data: queryData, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: opts.queryKey,
    queryFn: opts.queryFn,
    enabled: opts.enabled,
    refetchInterval: opts.pollInterval * 1000,
    staleTime: (opts.pollInterval * 1000) / 2,
    retry: opts.retry ?? 2,
  });

  useEffect(() => {
    if (queryData) {
      setData(queryData);
      opts.saveFn(queryData);
    }
  }, [queryData]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data,
    error: error as Error | null,
    isLoading,
    isFetching,
    refetch,
  };
}
