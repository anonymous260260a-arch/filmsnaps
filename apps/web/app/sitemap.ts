import { MetadataRoute } from "next";

const SITE = "https://filmsnap-pro.netlify.app";
const IS_DESKTOP = process.env.BUILD_FOR_DESKTOP === "true";

export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Desktop builds skip the sitemap — no server-side TMDB access in static export.
  if (IS_DESKTOP) return [];

  const { tmdb } = await import("@/lib/tmdb.server");

  const LAST_MOD = new Date("2026-08-09");
  const DAILY = "daily" as const;
  const MONTHLY = "monthly" as const;
  const YEARLY = "yearly" as const;

  const MOVIE_PAGES = 10;
  const TV_PAGES = 5;

  const STATIC_ROUTES: {
    path: string;
    changeFrequency: "daily" | "monthly" | "yearly";
    priority: number;
  }[] = [
    { path: "", changeFrequency: DAILY, priority: 1 },
    { path: "/movie", changeFrequency: DAILY, priority: 0.8 },
    { path: "/tv", changeFrequency: DAILY, priority: 0.8 },
    { path: "/search", changeFrequency: DAILY, priority: 0.6 },
    { path: "/transparency", changeFrequency: DAILY, priority: 0.6 },
    { path: "/download", changeFrequency: DAILY, priority: 0.7 },
    { path: "/versions", changeFrequency: DAILY, priority: 0.4 },
    { path: "/legal", changeFrequency: YEARLY, priority: 0.3 },
    { path: "/privacy", changeFrequency: YEARLY, priority: 0.3 },
  ];

  async function fetchPopularIds(
    kind: "movie" | "tv",
    pages: number,
  ): Promise<number[]> {
    const ids = new Set<number>();
    const endpoint = kind === "movie" ? "/discover/movie" : "/discover/tv";

    for (let page = 1; page <= pages; page++) {
      const data = await tmdb(
        `${endpoint}?sort_by=popularity.desc&page=${page}`,
      );
      const results = (data as { results?: { id: number }[] })?.results ?? [];
      if (!results.length) break;
      for (const item of results) {
        if (typeof item?.id === "number") ids.add(item.id);
      }
    }
    return Array.from(ids);
  }

  const staticUrls: MetadataRoute.Sitemap = STATIC_ROUTES.map(
    ({ path, changeFrequency, priority }) => ({
      url: `${SITE}${path}`,
      lastModified: LAST_MOD,
      changeFrequency,
      priority,
    }),
  );

  const [movieIds, tvIds] = await Promise.all([
    fetchPopularIds("movie", MOVIE_PAGES),
    fetchPopularIds("tv", TV_PAGES),
  ]);

  const detailUrls: MetadataRoute.Sitemap = [
    ...movieIds.map((id) => ({
      url: `${SITE}/movie/${id}`,
      lastModified: LAST_MOD,
      changeFrequency: MONTHLY,
      priority: 0.6,
    })),
    ...tvIds.map((id) => ({
      url: `${SITE}/tv/${id}`,
      lastModified: LAST_MOD,
      changeFrequency: MONTHLY,
      priority: 0.6,
    })),
  ];

  return [...staticUrls, ...detailUrls];
}
