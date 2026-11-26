import { MetadataRoute } from "next";

const SITE = "https://filmsnap-pro.netlify.app";

export const dynamic = "force-static";

/**
 * sitemap.xml
 *
 * Static routes only. Detail URLs were discovered from TMDB at request time
 * (15 upstream calls, 286 of the 295 entries); crawlers are disallowed, so the
 * catalogue never needs listing here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const LAST_MOD = new Date("2026-08-09");
  const DAILY = "daily" as const;
  const YEARLY = "yearly" as const;

  const routes: {
    path: string;
    changeFrequency: "daily" | "yearly";
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

  return routes.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE}${path}`,
    lastModified: LAST_MOD,
    changeFrequency,
    priority,
  }));
}
