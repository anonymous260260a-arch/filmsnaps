"use client";

import React, { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import WatchClient from "./WatchClient";
import { tmdbApi } from "@/lib/tmdb";
import { getProvider, getResumeMode } from "@filmsnaps/shared";

/**
 * Compute embed URL synchronously from URL params + provider registry.
 * No TMDB fetch needed — the player can start loading immediately.
 */
function computeInitialEmbedUrl(contentid, plat, providerId, searchParams) {
  const provider = getProvider(providerId);
  if (!provider) return null;

  const resumeT = searchParams.get("t")
    ? parseInt(searchParams.get("t"), 10)
    : undefined;
  const startAt =
    resumeT && resumeT > 0 && getResumeMode(provider) === "url"
      ? Math.floor(resumeT)
      : undefined;

  const embedPath =
    plat === "tv"
      ? provider.embed.tv(
          contentid,
          parseInt(searchParams.get("season")) || 1,
          parseInt(searchParams.get("episode")) || 1,
          startAt,
        )
      : provider.embed.movie(contentid, startAt);

  return `${provider.baseUrl}${embedPath}`;
}

function WatchContent() {
  const searchParams = useSearchParams();
  const plat = searchParams.get("type") || "movie";
  const contentid = searchParams.get("id");

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop(Boolean(window.electronAPI?.isDesktop));
  }, []);

  const animeOrigin = Boolean(
    searchParams.get("mid") || searchParams.get("aid"),
  );

  if (!contentid) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">Missing parameters</div>
      </div>
    );
  }

  return plat === "tv" ? (
    <TVWatchContent
      contentid={contentid}
      searchParams={searchParams}
      isDesktop={isDesktop}
      animeOrigin={animeOrigin}
    />
  ) : (
    <MovieWatchContent
      contentid={contentid}
      searchParams={searchParams}
      isDesktop={isDesktop}
      animeOrigin={animeOrigin}
    />
  );
}

function MovieWatchContent({
  contentid,
  searchParams,
  isDesktop,
  animeOrigin,
}) {
  // Non-suspending query — page renders immediately, data fills in background
  const { data: meta } = useQuery({
    queryKey: ["movie", contentid],
    queryFn: () => tmdbApi.getMovieDetails(contentid),
    staleTime: 1000 * 60 * 60 * 24 * 7,
  });

  const defaultProvider =
    animeOrigin || meta?.genres?.some?.((g) => g.id === 16)
      ? "megaplay"
      : isDesktop
        ? "nxsha"
        : "screenscape";
  const routeProvider = searchParams.get("provider") || null;
  const effectiveProvider = routeProvider || defaultProvider;

  // Compute embed URL synchronously from URL params — no TMDB wait
  const initialEmbedUrl = useMemo(
    () =>
      computeInitialEmbedUrl(
        contentid,
        "movie",
        effectiveProvider,
        searchParams,
      ),
    [contentid, effectiveProvider, searchParams],
  );

  return (
    <WatchClient
      contentid={contentid}
      plat="movie"
      initialMeta={meta}
      initialSeasonData={null}
      defaultProvider={defaultProvider}
      routeProvider={routeProvider}
      initialEmbedUrl={initialEmbedUrl}
      minimal={searchParams.get("minimal") === "1"}
      initialSeason={1}
      initialEpisode={1}
      initialResumeT={
        searchParams.get("t") ? parseInt(searchParams.get("t"), 10) : undefined
      }
      initialMalId={
        searchParams.get("mid") ? parseInt(searchParams.get("mid")) : undefined
      }
      initialAnilistId={
        searchParams.get("aid") ? parseInt(searchParams.get("aid")) : undefined
      }
    />
  );
}

function TVWatchContent({ contentid, searchParams, isDesktop, animeOrigin }) {
  // Non-suspending query — page renders immediately
  const { data: meta } = useQuery({
    queryKey: ["tv", contentid],
    queryFn: () => tmdbApi.getTVDetails(contentid),
    staleTime: 1000 * 60 * 60 * 24 * 7,
  });

  const urlSeason = searchParams.get("season");
  const urlEpisode = searchParams.get("episode");

  // TV season short-circuit: trust URL params when present
  const effectiveSeason = urlSeason
    ? parseInt(urlSeason)
    : (meta?.seasons?.find((s) => s.season_number > 0)?.season_number ?? 1);

  // Fire season fetch immediately when we have a season (parallel with TV details)
  const { data: seasonData } = useQuery({
    queryKey: ["tv", contentid, "season", effectiveSeason],
    queryFn: () => tmdbApi.getSeason(contentid, effectiveSeason),
    staleTime: 1000 * 60 * 60 * 24 * 7,
    enabled: !!effectiveSeason,
  });

  const defaultProvider =
    animeOrigin || meta?.genres?.some?.((g) => g.id === 16)
      ? "megaplay"
      : isDesktop
        ? "nxsha"
        : "screenscape";
  const routeProvider = searchParams.get("provider") || null;
  const effectiveProvider = routeProvider || defaultProvider;

  // Compute embed URL synchronously from URL params — no TMDB wait
  const initialEmbedUrl = useMemo(
    () =>
      computeInitialEmbedUrl(contentid, "tv", effectiveProvider, searchParams),
    [contentid, effectiveProvider, searchParams],
  );

  return (
    <WatchClient
      contentid={contentid}
      plat="tv"
      initialMeta={meta}
      initialSeasonData={seasonData}
      defaultProvider={defaultProvider}
      routeProvider={routeProvider}
      initialEmbedUrl={initialEmbedUrl}
      minimal={searchParams.get("minimal") === "1"}
      initialSeason={effectiveSeason}
      initialEpisode={urlEpisode ? parseInt(urlEpisode) : 1}
      initialResumeT={
        searchParams.get("t") ? parseInt(searchParams.get("t"), 10) : undefined
      }
      initialMalId={
        searchParams.get("mid") ? parseInt(searchParams.get("mid")) : undefined
      }
      initialAnilistId={
        searchParams.get("aid") ? parseInt(searchParams.get("aid")) : undefined
      }
    />
  );
}

export default function WatchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#D4A237] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <WatchContent />
    </Suspense>
  );
}
