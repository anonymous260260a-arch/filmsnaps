const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

/**
 * Build a full TMDB image URL from a path.
 * Returns a placeholder if path is empty.
 */
export function getImageUrl(path?: string, size = 'w780'): string {
  if (!path) return '/placeholder.jpg';
  return `${IMAGE_BASE_URL}/${size}${path}`;
}
