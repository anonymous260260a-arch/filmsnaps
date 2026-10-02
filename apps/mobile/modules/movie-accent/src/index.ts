import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * v4 native shape: each swatch carries its pixel-share population (Palette's
 * population count) alongside the raw hex. `average` is a computed mean with
 * population 0. Plain-string values are still accepted everywhere (the
 * react-native-image-colors fallback emits hexes only).
 */
export interface NativeSwatch {
  hex: string;
  population: number;
}

export type NativeSwatches = {
  darkVibrant: NativeSwatch | string | null;
  darkMuted: NativeSwatch | string | null;
  vibrant: NativeSwatch | string | null;
  muted: NativeSwatch | string | null;
  dominant: NativeSwatch | string | null;
  average: NativeSwatch | string | null;
  lightVibrant: NativeSwatch | string | null;
  lightMuted: NativeSwatch | string | null;
};

export type MovieAccentNative = {
  /**
   * Fetch + subsampled decode + scale to EXACTLY decodeWidth px + RGBA dump,
   * all off the JS thread. Resolves to a Uint8Array (4 bytes/px) or null when
   * the fetch/decode failed. This is what the v10 CORE histogram consumes.
   */
  getPixels(url: string, decodeWidth: number): Promise<Uint8Array | null>;
  /** Synchronous in-module pixel LRU (survives Metro reloads). null = not cached. */
  peekPixels(url: string, decodeWidth: number): Uint8Array | null;
  /**
   * Legacy Palette swatch bag — KEPT FOR THE DEV ACCENT-LAB SCREEN ONLY.
   * The app pipeline consumes getPixels.
   */
  getSwatches(url: string, decodeWidth: number): Promise<NativeSwatches | null>;
  peekSwatches(url: string, decodeWidth: number): NativeSwatches | null;
  /** Fire-and-forget PIXEL prefetch (the pipeline's unit of work). */
  warm(urls: string[], decodeWidth: number): void;
  clear(): void;
};

export const DECODE_WIDTH = 64;

/**
 * The native module when the dev-client was built with it. Expo modules are
 * resolved through expo-modules-core's own registry (NOT the classic
 * NativeModules bridge) — `requireOptionalNativeModule` returns null on iOS,
 * Expo Go, or a dev-client built before this module existed, without
 * throwing. Every caller must fall back to react-native-image-colors.
 */
export const MovieAccent: MovieAccentNative | null = (() => {
  try {
    const m = requireOptionalNativeModule<MovieAccentNative>("MovieAccent");
    console.log(
      `[movie-accent] engine ${m ? "ACTIVE (native)" : "null — falling back to image-colors"}`,
    );
    return m;
  } catch (e) {
    console.log(`[movie-accent] engine lookup failed: ${String(e)}`);
    return null;
  }
})();
