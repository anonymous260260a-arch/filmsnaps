import { useSuspenseQuery } from "@tanstack/react-query";
import { tmdbApi } from "@/lib/tmdb";

export function usePersonDetails(id: string) {
  return useSuspenseQuery({
    queryKey: ["person", id],
    queryFn: () => tmdbApi.getPersonDetails(id),
    staleTime: 1000 * 60 * 60 * 24 * 7, // 7 days
  });
}

export function usePersonCredits(id: string) {
  return useSuspenseQuery({
    queryKey: ["person", id, "credits"],
    queryFn: () => tmdbApi.getPersonCredits(id),
    staleTime: 1000 * 60 * 60 * 24 * 7, // 7 days
  });
}
