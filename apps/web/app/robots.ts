import { MetadataRoute } from "next";

/**
 * robots.txt
 *
 * Allow everything public; disallow the routes that exist and are private or
 * not worth indexing. `/auth` and `/reset-password` are intentionally NOT
 * listed — those routes were removed in the cleanup, and listing them would be
 * dead config.
 *
 * AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) are NOT
 * explicitly blocked: policy is "allow on content, block private paths", and
 * the `*` rules below already keep them off /saved, /history, /exp, and /api.
 * Revisit if a specific crawler misbehaves.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/saved", "/history", "/exp", "/api"],
      },
    ],
    sitemap: "https://filmsnap-pro.netlify.app/sitemap.xml",
  };
}
