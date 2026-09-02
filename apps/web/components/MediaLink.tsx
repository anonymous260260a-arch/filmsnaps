"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { tmdbApi } from "@/lib/tmdb";
import type { ReactNode } from "react";

interface MediaLinkProps {
  id: number | string;
  type: "movie" | "tv";
  href: string;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps any clickable media item and prefetches its detail data into the
 * React Query cache on hover/focus. Destination pages using useSuspenseQuery
 * will resolve instantly from cache.
 */
export function MediaLink({
  id,
  type,
  href,
  children,
  className,
}: MediaLinkProps) {
  const queryClient = useQueryClient();

  const handlePrefetch = () => {
    queryClient.prefetchQuery({
      queryKey: [type, id],
      queryFn: () =>
        type === "movie"
          ? tmdbApi.getMovieDetails(id)
          : tmdbApi.getTVDetails(id),
      staleTime: 1000 * 60 * 60, // 1 hour
    });
  };

  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
    >
      {children}
    </Link>
  );
}
