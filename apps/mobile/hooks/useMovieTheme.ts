import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import { useReduceMotion } from "./useReduceMotion";
import {
  FALLBACK_PALETTE,
  buildPalette,
  getSwatchSync,
  hueDistance,
  peekSwatch,
  resolveSwatch,
  subscribeSwatch,
  type MovieThemePalette,
} from "../lib/movieAccent";

const FADE_MS = 450;

export interface MovieThemeState {
  /** Accent palette once an accent is known, otherwise the dim-brand fallback. */
  palette: MovieThemePalette;
  /** True once a usable accent swatch has been extracted for this surface. */
  hasAccent: boolean;
  /**
   * 0 → 1, driven ONCE per mount: the first accent arrival fades the big
   * wash in, and every later arrival crossfades through it. The CTA does
   * not animate off it — it paints the accent immediately.
   */
  progress: Animated.Value;
}

/**
 * Resolve a movie/show's theme accent from its TMDB backdrop.
 *
 * - First render peeks the sync cache: a hit lands on the accent with no
 *   animation, a miss/no-backdrop starts on the fallback.
 * - The first accent this mount crossfades the wash in (FADE_MS). With
 *   reduce-motion enabled, every accent arrival SNAPS (no animation).
 * - A later accent (key change, late extraction) crossfades OUT of the old
 *   color and fades the new one IN — never a hard hue jump, which read as a
 *   flicker when the hero rotated between titles.
 * - A key change never shows the PREVIOUS title's accent: the moment the
 *   surface changes, the old wash starts fading out (0.25s) instead of
 *   staying painted until the new swatch resolves. The old "keep the last
 *   accent until the next one lands" behaviour painted movie A's vibe on
 *   movie B whenever extraction was slow — the single worst offender for
 *   "color completely off the app theme".
 * - A slow extraction that beats the 3s timeout is picked up later through
 *   the swatch subscription, so the surface is never stranded on gold.
 * - Poster-first fast path (second arg): a w342 poster swatch lands in
 *   ~200–400ms vs 1–3s for the w1280 backdrop, painting the vibe before the
 *   detail page is really visible. The backdrop refines afterwards, but a
 *   same-family refinement (painted-accent hue gap < 60°) never repaints —
 *   the user should never see the color change.
 */
export function useMovieTheme(
  backdropPathProp?: string | null,
  posterPathProp?: string | null,
): MovieThemeState {
  const backdropPath = backdropPathProp ?? null;
  const posterPath = posterPathProp ?? undefined;
  const key = backdropPath ?? "";

  // ── Reduce motion (shared module-scope listener) ──
  const reduceMotion = useReduceMotion();

  // Sync cache probe, evaluated once per mount (not per key). Falls through
  // to the native LRU (getSwatchSync) so a surface mounted right after a
  // Metro reload — or any boot where AsyncStorage hydration hasn't landed —
  // still paints its KNOWN accent on frame 1. Without this, the hero started
  // neutral and faded in a beat after the CTA/rows, which read as a
  // staggered "cascade" of tinting instead of one continuous scene.
  const initialRef = useRef<string | null | undefined>(undefined);
  if (initialRef.current === undefined) {
    if (!key) {
      initialRef.current = null;
    } else {
      const mem = peekSwatch(key);
      initialRef.current =
        mem !== undefined ? mem : (getSwatchSync(key) ?? null);
    }
  }
  const initial = initialRef.current;
  const initialPalette =
    typeof initial === "string" ? buildPalette(initial) : null;

  const [swatch, setSwatch] = useState<string | null>(
    typeof initial === "string" ? initial : null,
  );

  // The swatch whose color story is currently painted (seeded by the sync
  // probe) and whether `progress` has been taken away from it. Both gate the
  // startup-breath guard at the top of `apply`.
  const paintedRef = useRef<string | null>(
    typeof initial === "string" ? initial : null,
  );
  // Mirrors the `fadingOut` state for use inside `apply` (which must not
  // depend on that state — it would churn `apply`'s identity and re-run the
  // key effect). True whenever progress is below the painted story.
  const fadingOutRef = useRef(false);

  // One Animated.Value per mount (not per key).
  const [progress] = useState(() => new Animated.Value(initialPalette ? 1 : 0));

  // Whether this mount has already spent its initial fade-in. A null-key
  // fallback does not count.
  const fadedInRef = useRef(!!initialPalette);

  // In-flight fade-out; cancelled when a new accent arrives mid-fade.
  const fadeOutRef = useRef<Animated.CompositeAnimation | null>(null);
  // While fading out we keep the LAST palette painted (consumers keep their
  // wash layers mounted on hasAccent) so the exit is a real opacity fade to
  // transparent, not an unmount pop.
  const [fadingOut, setFadingOut] = useState(false);
  const lastPaletteRef = useRef<MovieThemePalette | null>(initialPalette);

  const apply = useCallback(
    (hex: string) => {
      // Startup-breath guard: never repaint a color story that is already
      // painted. Two startup paths hit this — warm mount (the sync probe
      // seeds the hook with the hex, the key effect then applies the same
      // hex again) and cold mount (the poster paints first, the backdrop
      // refines within the same family) — and both used to take the
      // "later arrival" dip below, pulsing the whole hero once (up/down at
      // startup). Same rule the poster path already honours: a hue gap
      // under 60° never repaints. Never skip while a fade-out is in
      // flight — that state must run the full path to restore.
      if (
        paintedRef.current !== null &&
        !fadingOutRef.current &&
        !fadeOutRef.current &&
        hueDistance(hex, paintedRef.current) < 60
      ) {
        return;
      }

      fadeOutRef.current?.stop();
      fadeOutRef.current = null;
      setFadingOut(false);
      fadingOutRef.current = false;
      paintedRef.current = hex;
      setSwatch(hex);
      const nextPalette = buildPalette(hex);
      if (!nextPalette) return; // unusable swatch — stay on the fallback

      lastPaletteRef.current = nextPalette;

      if (reduceMotion) {
        // Accessibility: no animation — the accent simply IS.
        fadedInRef.current = true;
        progress.setValue(1);
        return;
      }

      if (!fadedInRef.current) {
        // First accent this mount: fade the wash in from 0.
        fadedInRef.current = true;
        progress.setValue(0);
        Animated.timing(progress, {
          toValue: 1,
          duration: FADE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }).start();
      } else {
        // Later arrival (key change / late commit): dip through the fade so
        // the hue change blends instead of snapping.
        progress.setValue(0.25);
        Animated.timing(progress, {
          toValue: 1,
          duration: FADE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }).start();
      }
    },
    [progress, reduceMotion],
  );

  const beginFadeOut = useCallback(() => {
    if (!fadedInRef.current || fadeOutRef.current) return;
    // The old accent must NOT linger painted over the new title (it read as
    // "the wrong color for this movie"); cross it out while the new swatch
    // resolves. Interrupted by `apply` when the new accent lands.
    setFadingOut(true);
    fadingOutRef.current = true; // progress is leaving the painted story
    if (reduceMotion) {
      // Snap the old accent off instead of animating it out. The memo keeps
      // the old palette painted (hence setFadingOut(false)), but
      // fadingOutRef STAYS true: the story is hidden until `apply` restores.
      progress.setValue(0);
      setFadingOut(false);
      return;
    }
    progress.stopAnimation((value) => {
      // No reported value → assume something is visible and fade anyway.
      if (value != null && Number(value) <= 0) return;
      const out = Animated.timing(progress, {
        toValue: 0,
        duration: 250,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      });
      fadeOutRef.current = out;
      out.start(({ finished }) => {
        if (finished && fadeOutRef.current === out) fadeOutRef.current = null;
      });
    });
  }, [progress, reduceMotion]);

  useEffect(() => {
    if (!key) {
      beginFadeOut();
      setSwatch(null);
      return;
    }

    const cached = peekSwatch(key);
    if (cached !== undefined) {
      if (cached) apply(cached);
      else {
        beginFadeOut();
        setSwatch(null);
      }
      return;
    }

    beginFadeOut();

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    resolveSwatch(key).then(
      (hex) => {
        if (cancelled) return;
        if (hex) {
          apply(hex);
        } else {
          // Timeout (never memoized): wait for the background extraction to
          // commit. Real rejections memoize `null` and never notify, so this
          // subscriber simply stays dormant for the mount.
          unsubscribe = subscribeSwatch(key, (late) => {
            if (!cancelled) apply(late);
          });
        }
      },
      () => {
        // resolveSwatch never rejects; defensive.
      },
    );

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [key, apply, beginFadeOut]);

  // ── Poster-first fast path ──
  // Runs alongside the backdrop extraction above. The poster's swatch (the
  // image prepareDetail already prefetches at touch-down) paints the vibe in
  // a few hundred ms; the backdrop then refines it — but only when it tells
  // a genuinely different color story (painted-accent hue gap ≥ 60°).
  // Same-family refinements never repaint, so the user never sees a color
  // change. hueDistance now compares NORMALIZED accents (the CTA tone each
  // swatch would paint), not raw swatches — raw swatches of one artwork can
  // sit far apart in lightness/chroma while painting the same hue.
  const fastForwardedRef = useRef(false);

  useEffect(() => {
    if (fastForwardedRef.current || !posterPath || !backdropPath) return;
    if (peekSwatch(backdropPath) !== undefined) {
      fastForwardedRef.current = true; // backdrop already known — no need
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    resolveSwatch(posterPath, "w342")
      .then((hex) => {
        if (cancelled || !hex) return;
        fastForwardedRef.current = true;
        if (peekSwatch(backdropPath) !== undefined) return; // backdrop won
        apply(hex);
        // Refine from the backdrop once it lands — but keep the painted
        // story when the two agree perceptually (no visible shift).
        unsubscribe = subscribeSwatch(backdropPath, (late) => {
          if (cancelled) return;
          if (hueDistance(late, hex) < 60) return;
          apply(late);
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [posterPath, backdropPath, apply]);

  const palette = useMemo(() => {
    if (typeof swatch === "string") return buildPalette(swatch);
    // Mid-fade-out: keep the previous accent painted so the wash can fade to
    // transparent instead of popping off the screen.
    if (fadingOut) return lastPaletteRef.current;
    return null;
  }, [swatch, fadingOut]);

  return {
    palette: palette ?? FALLBACK_PALETTE,
    hasAccent: palette !== null,
    progress,
  };
}
