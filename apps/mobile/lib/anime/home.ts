/**
 * Mobile anime HOME feed — Hard Mode Split (anime mode).
 *
 * Expert verdict Q4 said "proxy through the web worker /api/anime/home". That
 * route does NOT exist yet (web is out-of-scope this round), so we hit AniList's
 * GraphQL endpoint directly (it is CORS-enabled; verdict Q4 confirms). Single
 * hook aggregates Trending + Popular + Seasonal into one shaped payload.
 *
 * TODO: when the web /api/anime/home route lands, swap `fetchAniListHome` to
 * fetch that single pre-shaped endpoint instead (keeps this hook's shape).
 */

import { useQuery } from "@tanstack/react-query";

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

export interface AniListMedia {
  id: number; // AniList id
  malId: number | null;
  title: string;
  titleEnglish: string | null;
  coverImage: string | null;
  bannerImage: string | null;
  /** TV | MOVIE | OVA | ONA | SPECIAL */
  format: string | null;
  episodeCount: number | null;
  season: string | null;
  seasonYear: number | null;
  averageScore: number | null;
  genres: string[];
}

interface AniListPage {
  trending: AniListMedia[];
  popular: AniListMedia[];
  seasonal: AniListMedia[];
}

const MEDIA_FIELDS = `
  id
  format
  idMal
  episodes
  season
  seasonYear
  averageScore
  genres
  title { romaji english }
  coverImage { extraLarge large }
  bannerImage
`;

function mapMedia(n: any): AniListMedia {
  return {
    id: n.id,
    malId: n.idMal ?? null,
    title: n.title?.romaji ?? n.title?.english ?? "Unknown",
    titleEnglish: n.title?.english ?? null,
    coverImage: n.coverImage?.extraLarge ?? n.coverImage?.large ?? null,
    bannerImage: n.bannerImage ?? null,
    format: n.format ?? null,
    episodeCount: n.episodes ?? null,
    season: n.season ?? null,
    seasonYear: n.seasonYear ?? null,
    averageScore: n.averageScore ?? null,
    genres: n.genres ?? [],
  };
}

const HOME_QUERY = `
  query Home($season: MediaSeason, $seasonYear: Int) {
    trending: Page(page: 1, perPage: 20) {
      media(sort: TRENDING_DESC, type: ANIME) { ${MEDIA_FIELDS} }
    }
    popular: Page(page: 1, perPage: 20) {
      media(sort: POPULARITY_DESC, type: ANIME) { ${MEDIA_FIELDS} }
    }
    seasonal: Page(page: 1, perPage: 20) {
      media(sort: POPULARITY_DESC, type: ANIME, season: $season, seasonYear: $seasonYear) { ${MEDIA_FIELDS} }
    }
  }
`;

function currentSeason(): { season: string; year: number } {
  // Date math inline (no Date.now() dependency in shared layer; RN provides Date)
  const now = new Date();
  const m = now.getMonth();
  const season =
    m <= 1 || m === 11
      ? "WINTER"
      : m <= 4
        ? "SPRING"
        : m <= 7
          ? "SUMMER"
          : "FALL";
  return { season, year: now.getFullYear() };
}

export async function fetchAniListHome(): Promise<AniListPage> {
  const { season, year } = currentSeason();
  const res = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: HOME_QUERY,
      variables: { season, seasonYear: year },
    }),
  });
  if (!res.ok) throw new Error(`anilist home failed (${res.status})`);
  const json = await res.json();
  const data = json?.data ?? {};
  const toList = (key: string): AniListMedia[] =>
    (data[key]?.media ?? []).map(mapMedia);
  return {
    trending: toList("trending"),
    popular: toList("popular"),
    seasonal: toList("seasonal"),
  };
}

export function useAniListHome() {
  return useQuery({
    queryKey: ["anilist", "home"],
    queryFn: fetchAniListHome,
    staleTime: 10 * 60_000,
  });
}
