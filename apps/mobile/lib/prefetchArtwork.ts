import { Image } from "expo-image";
import { getImageUrl } from "@filmsnaps/shared";

const prefetchCache = new Set<string>();

/**
 * Prefetch poster and backdrop images for offline use.
 *
 * TMDB image URLs are content-addressed (the path is an opaque hash), so
 * once downloaded they never need re-downloading. `expo-image` serves them
 * from its disk cache on subsequent cold launches.
 *
 * Uses a local Set to deduplicate — won't re-prefetch a URL already sent.
 * Fire-and-forget; failures are silently swallowed.
 */
export function prefetchArtwork(media: {
  poster_path?: string | null;
  backdrop_path?: string | null;
}): void {
  const urls: string[] = [];

  if (media.poster_path) {
    urls.push(getImageUrl(media.poster_path, "w342"));
  }
  if (media.backdrop_path) {
    urls.push(getImageUrl(media.backdrop_path, "w780"));
  }

  const unique = urls.filter((u) => !prefetchCache.has(u));
  if (unique.length === 0) return;

  unique.forEach((u) => prefetchCache.add(u));
  Image.prefetch(unique).catch(() => {
    // Silent — prefetch is best-effort
  });
}
