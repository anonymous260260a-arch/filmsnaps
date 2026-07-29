/**
 * FilmSnaps Color System — Single Source of Truth
 *
 * Every color value used across the mobile app originates here.
 * No inline hex values anywhere else — import from this module.
 *
 * ⚠️  This is the current palette, NOT a redesign.
 *     Colors map 1:1 to what was previously inlined across components.
 */

export const colors = {
  // ── Backgrounds ──
  bg: "#070708", // app background, hero fallback, layout bg
  bgCard: "#141414", // card backgrounds (history, downloads, hero skeleton)
  bgElevated: "#16161A", // elevated card bg (NativeWind `elevated`)
  bgSurface: "#0E0E11", // surface-level bg (NativeWind `surface`)
  bgSubtle: "#222226", // subtle backgrounds (NativeWind `subtle`)
  bgTop: "#1f1f1f", // poster fallbacks, borders, button bg
  bgOverlay: "#111", // action bar overlay in downloads
  bgActiveDrag: "#1a1a1e", // active drag state in home layout
  bgButtonWarm: "#2A2520", // warm-toned button skeleton

  // ── Gold / Primary ──
  gold: "#D4A237", // primary CTA, logo, links, progress bars, badges
  goldDim: "#B88B2A", // NativeWind `primary-dim`
  goldBadge: "rgba(212,162,55,0.2)", // badge backgrounds
  goldBadgeSolid: "rgba(212,162,55,0.85)",
  goldRatingBg: "rgba(232,160,32,0.15)",
  goldRatingBorder: "rgba(232,160,32,0.3)",
  goldButtonText: "#D4A23720", // guide button bg variant

  // ── Semantic ──
  success: "#4CAF82", // NativeWind `success`
  successGreen: "#22c55e", // green used for completed/checkmarks
  greenBadge: "rgba(34,197,94,0.85)",
  error: "#ef4444", // error text, delete actions
  destructive: "#E05252", // NativeWind `destructive`
  info: "#5B9CF6", // NativeWind `info`
  secondary: "#8B5CF6", // NativeWind `secondary`
  amber: "#f59e0b", // retrying, storage warning
  goldAccent: "#D4A237", // accent (alias for gold)

  // ── Text ──
  textPrimary: "#F4F4F5",
  textSecondary: "#A1A1AA",
  textTertiary: "#52525B",
  textDisabled: "#3f3f3f",
  textMuted: "#27272a", // disabled button text

  // ── Icon colors ──
  iconPrimary: "#D4A237",
  iconSecondary: "#52525B",
  iconMuted: "#3f3f3f",
  iconDisabled: "#27272a",

  // ── Borders / Dividers ──
  border: "#1f1f1f",
  borderMuted: "#333333", // inactive radio buttons, muted borders
  borderSubtle: "rgba(255,255,255,0.06)",
  borderZinc: "rgba(113,113,122,0.6)", // approx zinc-800/60
  progressTrack: "#222226",
  progressTrackAlt: "rgba(255,255,255,0.1)",

  // ── Transparent / Utility ──
  transparent: "transparent",
  black75: "rgba(0,0,0,0.75)",
  white03: "rgba(255,255,255,0.03)",
  white04: "rgba(255,255,255,0.04)",
  whiteButtonBg: "rgba(255,255,255,0.04)",
  black02: "rgba(0,0,0,0.02)",
  voidBlack: "#000",

  // ── Hero gradient (rgba values matching #070708) ──
  heroGradientTransparent: "rgba(7,7,8,0)",
  heroGradientMid: "rgba(7,7,8,0.55)",
  heroGradientSolid: "rgba(7,7,8,0.93)",

  // ── Zinc palette (icon fills, small elements) ──
  zinc800: "#27272a",
  zinc500: "#71717a",
  zinc400: "#a1a1aa",
  zinc300: "#d4d4d8",
  zinc600: "#52525b",
  zinc200: "#e4e4e7",
  zincBg: "rgba(39,39,42,0.6)",
  zincBgFull: "#1a1a1e",
  zincBorder: "rgba(113,113,122,0.6)",

  // ── Offline ──
  offline: "#FBBF24", // amber for offline banner (distinct from gold CTA)

  // ── Status / Feedback ──
  green500: "#22c55e",
  green900: "#14532d",
  red400: "#f87171",
  red500: "#ef4444",
  amber400: "#fbbf24",
  amber500: "#f59e0b",

  // ── Skeleton / Shimmer ──
  skeletonBg: "#1C1C20",
  skeletonBgAlt: "#141414",
  skeletonHighlight: "rgba(255,255,255,0.04)",
  skeletonButton: "#2A2520",

  // ── Empty state ──
  emptyIcon: "#3F3F46",

  // ── Player / Fullscreen ──
  playerBg: "#000",

  // NativeWind semantic aliases (keep in sync with tailwind.config.ts)
  nativewind: {
    void: "#070708",
    surface: "#0E0E11",
    elevated: "#16161A",
    subtle: "#222226",
    primary: "#D4A237",
    "primary-dim": "#B88B2A",
    secondary: "#8B5CF6",
    success: "#4CAF82",
    destructive: "#E05252",
    info: "#5B9CF6",
    "text-primary": "#F4F4F5",
    "text-secondary": "#A1A1AA",
    "text-tertiary": "#52525B",
  },
} as const;

export type ColorKey = keyof typeof colors;
export type ColorValue = (typeof colors)[ColorKey];
