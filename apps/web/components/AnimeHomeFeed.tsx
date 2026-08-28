/**
 * AnimeHomeFeed — AniList-backed home rails for anime mode (Hard Mode Split).
 *
 * Mirrors mobile's AnimeHomeFeed (apps/mobile/app/(tabs)/index.tsx:745): three
 * rails (Trending / Popular / This Season) fed by useAniListHome. Tapping a card
 * resolves the TMDB twin via lookupMal and navigates to its detail route carrying
 * the anime identity params so the watch session is profiled as anime.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAniListHome, type AniListHomeItem } from "@/lib/anime/home";
import { lookupMal } from "@/lib/anime/resolve";

function twinHref(item: AniListHomeItem): string | null {
  const twin = lookupMal(item.malId);
  if (twin?.tmdbShowId != null) {
    return `/tv/${twin.tmdbShowId}?isAnime=1&mid=${item.malId}&aid=${item.anilistId ?? ""}`;
  }
  if (twin?.tmdbMovieId != null) {
    return `/movie/${twin.tmdbMovieId}?isAnime=1&mid=${item.malId}&aid=${item.anilistId ?? ""}`;
  }
  return null;
}

function Rail({ label, items }: { label: string; items: AniListHomeItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="font-sans mb-4 px-4 text-lg font-bold tracking-tight text-foreground sm:px-6 lg:px-8">
        {label}
      </h2>
      <div className="flex gap-3 overflow-x-auto px-4 pb-2 sm:px-6 lg:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const href = twinHref(item);
          if (!href) return null;
          return (
            <Link
              key={`${item.anilistId ?? item.malId}`}
              href={href}
              className="group w-[110px] shrink-0"
            >
              <div className="aspect-[2/3] w-full overflow-hidden rounded-xl bg-white/[0.04]">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image}
                    alt={item.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[11px] text-zinc-600">
                    {item.title}
                  </div>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-zinc-300 group-hover:text-white">
                {item.title}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function AnimeHomeFeed() {
  const router = useRouter();
  const { data, isLoading, error } = useAniListHome(20);

  if (isLoading && !data) {
    return (
      <div className="space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="mb-4 h-5 w-40 animate-pulse rounded bg-white/[0.06]" />
            <div className="flex gap-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <div
                  key={j}
                  className="h-[165px] w-[110px] shrink-0 animate-pulse rounded-xl bg-white/[0.04]"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-4 py-16 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
        Anime home feed is temporarily unavailable. Try again in a few minutes.
      </div>
    );
  }

  return (
    <div className="py-4">
      <Rail label="Trending Anime" items={data.trending} />
      <Rail label="Popular Anime" items={data.popular} />
      <Rail label="This Season" items={data.seasonal} />
    </div>
  );
}
