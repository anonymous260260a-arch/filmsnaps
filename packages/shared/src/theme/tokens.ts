/**
 * "Cinematic Void" Design Tokens
 *
 * Single source of truth for the entire design system.
 * Colors, typography, spacing, glassmorphism, and shadows.
 *
 * IMPORTANT: Font families use SEMANTIC names ('display', 'body').
 * Platform-specific font loaders map these:
 *   - Web:   CSS variables `--font-display`, `--font-body` (next/font)
 *   - Mobile: NativeWind tailwind.config.ts fontFamily mapping
 */

// â”€â”€ Colors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const colors = {
  /** Deepest background â€” near black with a whisper of warmth */
  void: '#070708' as const,
  /** Default surface for cards, screens */
  surface: '#0E0E11' as const,
  /** Elevated surfaces (modals, sheets, dropdowns) */
  elevated: '#16161A' as const,
  /** Subtle borders, dividers, disabled states */
  subtle: '#222226' as const,

  /** Primary text â€” near-white */
  'text-primary': '#F4F4F5' as const,
  /** Secondary text â€” muted grey */
  'text-secondary': '#A1A1AA' as const,
  /** Tertiary text â€” very muted */
  'text-tertiary': '#52525B' as const,

  /** Amber Gold â€” the hero color: CTAs, active states, accents */
  primary: '#D4A237' as const,
  /** Dimmed amber for pressed states */
  'primary-dim': '#B88B2A' as const,

  /** Soft Lavender â€” bookmark indicators only */
  secondary: '#8B5CF6' as const,

  /** Success states (watched badge, finished) */
  success: '#4CAF82' as const,
  /** Destructive actions (remove, delete) */
  destructive: '#E05252' as const,
  /** Informational (continue-watching bars, download buttons) */
  info: '#5B9CF6' as const,
} as const;

export type ColorKey = keyof typeof colors;

// â”€â”€ Typography â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface TypographyToken {
  /** Font size in px */
  size: number;
  /** Line height in px */
  lineHeight: number;
  /** Semantic font family name â€” mapped per-platform */
  fontFamily: 'display' | 'body';
  /** Font weight (1-1000, or CSS named weight) */
  fontWeight: number;
}

export const typography = {
  h1: { size: 28, lineHeight: 32, fontFamily: 'display' as const, fontWeight: 700 },
  h2: { size: 22, lineHeight: 28, fontFamily: 'display' as const, fontWeight: 700 },
  h3: { size: 18, lineHeight: 24, fontFamily: 'body' as const, fontWeight: 600 },
  body: { size: 14, lineHeight: 20, fontFamily: 'body' as const, fontWeight: 400 },
  caption: { size: 12, lineHeight: 16, fontFamily: 'body' as const, fontWeight: 500 },
} as const satisfies Record<string, TypographyToken>;

export type TypographyKey = keyof typeof typography;

// â”€â”€ Glassmorphism â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const glass = {
  /** Standard glassmorphism background (void surface at 75%) */
  background: 'rgba(14, 14, 17, 0.75)' as const,
  /** Blur amount for backdrop-filter */
  backdropFilter: 'blur(20px)' as const,
} as const;

// â”€â”€ Shadows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const shadows = {
  card: '0 4px 24px rgba(0,0,0,0.6)' as const,
} as const;

// â”€â”€ Spacing (unified scale) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

// â”€â”€ Border radius â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  full: 9999,
} as const;

// â”€â”€ Animation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const animation = {
  /** How long the player control overlay stays visible after last interaction (ms) */
  overlayAutoHide: 4000,
  /** Short spring-like duration for micro-interactions */
  fast: 200,
  /** Standard transition */
  normal: 300,
} as const;
