import { MetadataRoute } from "next";
import { tmdb } from "@/lib/tmdb.server";

// ── Sitemap ──
// Static routes plus popular movie/TV detail pages fetched from TMDB (discover
// by popularity). tmdb() returns { results: [] } on failure and never throws,
// so a TMDB outage degrades this to a static-only sitemap rather than failing
// the build.
const SITE = "https://filmsnap-pro.netlify.app";

// Stable last-modified so the sitemap doesn't churn on every build. Updated
// when content across the site materially changes.
const LAST_MOD = new Date("2026-08-09");
const DAILY = "daily" as const;
const MONTHLY = "monthly" as const;
const YEARLY = "yearly" as const;

// TMDB discover returns 20 items per page (there is no per_page override), so
// 10 movie pages + 5 TV pages ≈ 300 detail URLs at 15 TMDB calls per sitemap
// regeneration. The sitemap is ISR with a 10-minute revalidate, so this keeps
// TMDB load sustainable on the free tier. Raise these if you want a bigger
// sitemap — 50/25 pages ≈ 1500 URLs (~75 calls per regeneration).
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
  { path: "/how-it-works", changeFrequency: DAILY, priority: 0.6 },
  { path: "/download", changeFrequency: DAILY, priority: 0.7 },
  { path: "/versions", changeFrequency: DAILY, priority: 0.4 },
  { path: "/legal", changeFrequency: YEARLY, priority: 0.3 },
  { path: "/privacy", changeFrequency: YEARLY, priority: 0.3 },
];

async function fetchPopularIds(
  kind: "movie" | "tv",
  pages: number,
): Promise<number[]> {
  const ids = new Set<number>(); // dedupe: discover can repeat/reshuffle IDs across pages
  const endpoint = kind === "movie" ? "/discover/movie" : "/discover/tv";

  for (let page = 1; page <= pages; page++) {
    const data = await tmdb(`${endpoint}?sort_by=popularity.desc&page=${page}`);
    const results = (data as { results?: { id: number }[] })?.results ?? [];
    if (!results.length) break; // no more pages / TMDB failed — stop early
    for (const item of results) {
      if (typeof item?.id === "number") ids.add(item.id);
    }
  }
  return Array.from(ids);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static routes
  const staticUrls: MetadataRoute.Sitemap = STATIC_ROUTES.map(
    ({ path, changeFrequency, priority }) => ({
      url: `${SITE}${path}`,
      lastModified: LAST_MOD,
      changeFrequency,
      priority,
    }),
  );

  // Popular detail pages. Person pages are skipped (no clean ID list without
  // heavier TMDB calls).
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
