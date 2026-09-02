import { useSuspenseQuery } from "@tanstack/react-query";
import { tmdbApi } from "@/lib/tmdb";

export function useTVDetails(id: string) {
  return useSuspenseQuery({
    queryKey: ["tv", id],
    queryFn: () => tmdbApi.getTVDetails(id),
    staleTime: 1000 * 60 * 60 * 24 * 7, // 7 days
  });
}

export function useTVSeason(tvId: string, seasonNumber: number) {
  return useSuspenseQuery({
    queryKey: ["tv", tvId, "season", seasonNumber],
    queryFn: () => tmdbApi.getSeason(tvId, seasonNumber),
    staleTime: 1000 * 60 * 60 * 24 * 7, // 7 days
  });
}
