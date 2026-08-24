"use client";

/**
 * AnimeCard — search-result card for MAL-origin titles (verdict §9 Q3).
 * Same visual language as MovieCard, but:
 *   - links carry the anime identity params (?mid=<mal>&aid=<anilist>) so the
 *     detail → watch chain knows the session is anime-profiled;
 *   - the rating badge is replaced by a type badge (TV/Movie/OVA/ONA/Special)
 *     — anime fans navigate by format;
 *   - posters come from s4.anilist.co (AniList CDN).
 */

import Image from "next/image";
import Link from "next/link";
import { Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import type { ScoredAnimeResult } from "@/lib/anime/search";

interface AnimeCardProps {
  item: ScoredAnimeResult;
  className?: string;
}

const TYPE_LABELS: Record<string, string> = {
  TV: "TV",
  Movie: "Movie",
  OVA: "OVA",
  ONA: "ONA",
  Special: "Special",
  Music: "Music",
};

export function AnimeCard({ item, className = "" }: AnimeCardProps) {
  const router = useRouter();

  // TMDB spine: every result was mapped server-side; prefer the show twin,
  // fall back to the movie twin.
  const mediaType = item.tmdbShowId != null ? "tv" : "movie";
  const tmdbId = item.tmdbShowId ?? item.tmdbMovieId;
  if (!tmdbId) return null;

  const detailHref = `/${mediaType}/${tmdbId}?mid=${item.malId}${
    item.anilistId != null ? `&aid=${item.anilistId}` : ""
  }`;

  const title = item.titleEnglish || item.title;

  return (
    <div className={`group relative ${className}`}>
      <Link prefetch href={detailHref} className="block">
        <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-secondary shadow-lg transition-all duration-500 group-hover:shadow-2xl group-hover:shadow-primary/5">
          {item.image ? (
            <Image
              src={item.image}
              alt={title}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, (max-width: 1280px) 20vw, 16vw"
              loading="lazy"
              quality={85}
              unoptimized
              className="object-cover transition-all duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No Image
            </div>
          )}

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          {/* Hover actions */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
            <Button
              onClick={(e) => {
                e.preventDefault();
                router.push(detailHref);
              }}
              className="gap-2 px-5 py-2 h-auto rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium hover:bg-white/20 transition-all"
            >
              <Play className="w-4 h-4 fill-current" />
              View
            </Button>
          </div>

          {/* Type badge — replaces MovieCard's rating pill */}
          {item.type && (
            <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-lg border border-white/[0.06]">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white">
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Info below card */}
      <Link href={detailHref} className="block mt-2.5 space-y-0.5 px-0.5">
        <h3 className="text-sm font-semibold text-foreground/90 line-clamp-1 group-hover:text-primary transition-colors duration-200">
          {title}
        </h3>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
          <Sparkles className="h-3 w-3 text-[#D4A237]" />
          Anime
          {item.year ? <span>· {item.year}</span> : null}
          {item.episodes != null ? <span>· {item.episodes} ep</span> : null}
          {item.score != null ? <span>· ★ {item.score.toFixed(1)}</span> : null}
        </p>
      </Link>
    </div>
  );
}
