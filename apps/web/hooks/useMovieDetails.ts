import { useSuspenseQuery } from "@tanstack/react-query";
import { tmdbApi } from "@/lib/tmdb";

export function useMovieDetails(id: string) {
  return useSuspenseQuery({
    queryKey: ["movie", id],
    queryFn: () => tmdbApi.getMovieDetails(id),
    staleTime: 1000 * 60 * 60 * 24 * 7, // 7 days — detail data is essentially static
  });
}
