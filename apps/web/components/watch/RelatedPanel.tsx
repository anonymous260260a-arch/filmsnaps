/**
 * RelatedPanel — "More Like This" poster grid for the right column (movies).
 *
 * 2×3 grid of poster thumbnails from TMDB similar/recommendations.
 * Clicking navigates to the watch page for that title.
 */

"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Film } from "lucide-react";
import { getImageUrl } from "@/lib/tmdb";

interface RelatedPanelProps {
  /** TMDB content id */
  contentid: string;
  /** TMDB metadata (includes similar.results) */
  initialMeta: any;
}

export function RelatedPanel({ contentid, initialMeta }: RelatedPanelProps) {
  // Extract similar items from TMDB metadata
  const similar = useMemo(() => {
    const results = initialMeta?.similar?.results ?? [];
    // Filter out items without poster, limit to 6
    return results.filter((m: any) => m.poster_path).slice(0, 6);
  }, [initialMeta]);

  // No similar content to show
  if (similar.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-[#F4F4F5]">More Like This</h3>
      <div className="grid grid-cols-3 gap-3">
        {similar.map((movie: any) => {
          const posterUrl = movie.poster_path
            ? getImageUrl(movie.poster_path, "w200")
            : null;

          return (
            <Link
              key={movie.id}
              href={`/watch/movie/${movie.id}`}
              className="group block"
            >
              <div
                className="aspect-[2/3] rounded-lg overflow-hidden bg-[#0E0E11] border border-[#222226]
                group-hover:border-[#D4A237]/30 transition-all duration-300"
              >
                {posterUrl ? (
                  <img
                    src={posterUrl}
                    alt={movie.title || "Movie poster"}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film size={20} className="text-zinc-700" />
                  </div>
                )}
              </div>
              <p className="text-[11px] text-zinc-400 mt-1.5 truncate group-hover:text-[#F4F4F5] transition-colors">
                {movie.title}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
