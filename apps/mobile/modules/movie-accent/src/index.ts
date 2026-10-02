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
  /** Fetch + subsampled decode (~decodeWidth px) + Palette, all off the JS thread. */
  getSwatches(url: string, decodeWidth: number): Promise<NativeSwatches | null>;
  /** Synchronous in-module LRU lookup (survives Metro reloads). null = not cached. */
  peekSwatches(url: string, decodeWidth: number): NativeSwatches | null;
  /** Fire-and-forget prefetch. */
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
