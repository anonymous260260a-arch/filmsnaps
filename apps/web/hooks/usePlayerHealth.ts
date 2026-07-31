/**
 * usePlayerHealth — shared provider health cache backed by React Query.
 *
 * Replaces the plain useState/useEffect sweep with a single `['provider-health']`
 * query so every consumer (DesktopWatchLayout pill/dropdown, ServerPickerSheet)
 * shares one cache and React Query dedupes simultaneous mounts into a single
 * network sweep. NOT persisted (whitelist drops `provider-health`).
 *
 * - staleTime 3m: within a session, revisiting the watch page doesn't re-sweep.
 * - refetchInterval: background poll while mounted.
 * - skipInitial: defer the first sweep off the playback critical path.
 */

"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { checkAllProviders } from "@filmsnaps/shared";
import type { ProviderDefinition, HealthCache } from "@filmsnaps/shared";

const HEALTH_KEY = ["provider-health"] as const;

interface UsePlayerHealthOptions {
  providers: ProviderDefinition[];
  /** Background poll interval in ms (false = no polling) */
  intervalMs?: number | false;
  /** Whether to defer the initial sweep (e.g. to requestIdleCallback) */
  skipInitial?: boolean;
}

interface UsePlayerHealthReturn {
  healthCache: HealthCache;
  lastCheckedAt: number;
  isRefreshing: boolean;
  refresh: () => void;
}

export function usePlayerHealth({
  providers,
  intervalMs = 60_000,
  skipInitial = false,
}: UsePlayerHealthOptions): UsePlayerHealthReturn {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: HEALTH_KEY,
    queryFn: () => checkAllProviders(providers, { timeoutMs: 5000 }),
    staleTime: 3 * 60 * 1000, // 3 min freshness window
    gcTime: 10 * 60 * 1000, // 10 min in-memory retention
    refetchOnMount: skipInitial ? false : true,
    refetchOnWindowFocus: false,
    refetchInterval: intervalMs === false ? false : intervalMs,
    enabled: providers.length > 0,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
  }, [queryClient]);

  return {
    healthCache: query.data ?? (new Map() as HealthCache),
    lastCheckedAt: query.dataUpdatedAt ?? 0,
    isRefreshing: query.isFetching,
    refresh,
  };
}
