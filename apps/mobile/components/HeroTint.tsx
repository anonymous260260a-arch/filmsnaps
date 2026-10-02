/**
 * HeroTint — the v10 Glow+ hero tint layer (plain-alpha variant).
 *
 * The spec's FIRST choice was a CSS `mix-blend-mode: multiply` scrim
 * (port-spec line 340), but on device that path is unsafe: React Native's
 * Android ViewGroup wraps its whole draw in `canvas.saveLayer()` whenever a
 * child carries `mixBlendMode` (group isolation for blending — see
 * ReactViewGroup.draw). Putting that saveLayer on the backdrop image's own
 * Animated.View makes the image fail to composite during the `slide_from_right`
 * close transition (the same Android/expo-image transition-blank already
 * documented in ProgressiveImage.tsx) — the image blanks out and the accent
 * wash shows through in its place.
 *
 * Per the spec's own escape hatch (line 27: "If it misrenders on device, use a
 * plain alpha layer at 0.35 of tint. Do not block on this."), we render a
 * PLAIN (non-blended) tint instead. No blend → no saveLayer → no isolation →
 * the backdrop image renders exactly as it does with no tint present.
 *
 * Shape: a FLAT uniform plate of tint across the whole hero at TINT_ALPHA
 * — no gradient ramp. A ramp makes alpha and coverage the same knob (lower
 * alpha always shrinks the perceptible extent instead of reading as
 * "weaker"); a flat plate keeps the area fixed, so TINT_ALPHA is a true
 * strength dial. The neutral scrim + accent wash still draw ON TOP (web
 * order), so the bottom stays dominated by them; the CTA and content sit
 * above everything (zIndex) and paint palette.accent directly — untouched.
 * If the clean top comes back as a requirement, fade the plate with
 * colors=[rgba(tint,0), rgba(tint,TINT_ALPHA)] locations=[0, 0.15].
 */

import React from "react";
import { Animated, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Home-hero tint strength (detail pages override via the `alpha` prop). */
const TINT_ALPHA = 0.2;

/** "#975706" → "rgba(151, 87, 6, alpha)" */
function rgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface HeroTintProps {
  /** Palette tint (solid hex, e.g. "#975706"); invalid/absent drops the layer. */
  tint?: string | null;
  /** Accent arrival animation — same value the wash layers use. */
  progress: Animated.Value;
  /** Plate strength override; defaults to TINT_ALPHA (home hero). Detail
   *  pages pass a lower value — the flat plate reads brighter there. */
  alpha?: number;
}

export function HeroTint({
  tint,
  progress,
  alpha = TINT_ALPHA,
}: HeroTintProps) {
  if (!tint || !HEX_COLOR.test(tint) || alpha <= 0) return null;

  // Plain source-over alpha (NO mixBlendMode): see header comment.
  // Uniform plate — alpha is pure strength, coverage never moves.
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity: progress }]}
    >
      <LinearGradient
        colors={[rgba(tint, alpha), rgba(tint, alpha)]}
        locations={[0, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}
