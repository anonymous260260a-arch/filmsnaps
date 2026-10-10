import {
  requireNativeViewManager,
  requireOptionalNativeModule,
} from "expo-modules-core";

/**
 * Start.io (StartApp) bridge.
 *
 * The native SDK is baked into the binary, but every ad path is gated in JS
 * by the remote ads-config.json (global kill + per-slot enable + rollout %).
 * Until that config flips, `initialize` is never called and the view never
 * renders — zero network calls, zero UI change.
 */
export type MovieAdsNative = {
  /** Idempotent. false = init skipped/failed (blank appId, no activity). */
  initialize(appId: string, testAds: boolean, consent: boolean): boolean;
  /** Re-submit the GDPR "pas" consent flag after a settings change. */
  setConsent(consent: boolean): void;
  /** Preload an interstitial (AdMode.AUTOMATIC). true = ready to show. */
  loadInterstitial(adTag: string): Promise<boolean>;
  /** Show the last loaded interstitial. false = nothing loaded/failed. */
  showInterstitial(): boolean;
};

/**
 * Null on iOS, Expo Go, or a binary built before this module existed —
 * old binaries keep working after an OTA that references this module.
 */
export const MovieAds: MovieAdsNative | null = (() => {
  try {
    const m = requireOptionalNativeModule<MovieAdsNative>("MovieAds");
    console.log(
      `[movie-ads] engine ${m ? "ACTIVE (native)" : "null — ads stay off"}`,
    );
    return m;
  } catch (e) {
    console.log(`[movie-ads] engine lookup failed: ${String(e)}`);
    return null;
  }
})();

let CachedView: any = null;

/**
 * The native banner/mrec/cover view manager, or null when the module is
 * absent. Lazy + memoized so merely importing this file never throws.
 * Adapter name = ViewManagerAdapter_{module}_{viewClass}.
 */
export function getMovieAdsView(): any | null {
  if (!MovieAds) return null;
  if (!CachedView) {
    try {
      CachedView = requireNativeViewManager("MovieAds", "MovieAdsBannerView");
    } catch (e) {
      console.log(`[movie-ads] view lookup failed: ${String(e)}`);
      return null;
    }
  }
  return CachedView;
}
