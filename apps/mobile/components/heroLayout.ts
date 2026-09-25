/**
 * Hero layout constants — ONE aspect used by skeleton, empty state, and the
 * real hero so the first paint never jumps when data arrives.
 *
 * height = width * HERO_ASPECT_RATIO (taller crop; tuned on-device to 0.92).
 */
export const HERO_ASPECT_RATIO = 0.92;

/**
 * Shared hero-backdrop TMDB size. At ratio 0.92 the box is nearly full-width,
 * so w780 upscales ~1.4× — use w1280 for both render and prefetch so they
 * can never drift apart (Phase 1D FIX 2).
 */
export const HERO_BACKDROP_SIZE = "w1280" as const;

/**
 * Detail-page backdrop TMDB size — same as hero so render + openDetail
 * prefetch share one constant (Phase 2 FIX 3).
 */
export const DETAIL_BACKDROP_SIZE = "w1280" as const;

export function heroHeightForWidth(width: number): number {
  return Math.round(width * HERO_ASPECT_RATIO);
}
