import { MetadataRoute } from "next";

export const dynamic = "force-static";

/**
 * robots.txt
 *
 * Crawlers are fully disallowed. Catalogue pages render on every request, so a
 * crawler walking them costs Worker CPU per hit; one aggressive crawler was
 * ~78% of invocations. The sitemap is intentionally not advertised while
 * everything is disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
  };
}
