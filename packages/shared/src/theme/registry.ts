/**
 * Theme Registry — all available theme color presets and font pairings.
 * The `switch-theme.ps1` script reads this file to apply a theme.
 *
 * Each theme defines colors for all Cinematic Void tokens plus a font pairing.
 * Fonts use Google Font names as they appear in URLs (e.g. 'Playfair+Display').
 */

export interface ThemeColorSet {
  void: string;
  surface: string;
  elevated: string;
  subtle: string;
  'text-primary': string;
  'text-secondary': string;
  'text-tertiary': string;
  primary: string;
  'primary-dim': string;
  secondary: string;
  success: string;
  destructive: string;
  info: string;
}

export interface FontPair {
  /** npm package name for @expo-google-fonts/xxx */
  displayPackage: string;
  bodyPackage: string;
  /** Font weight export name for expo (e.g. 'PlayfairDisplay_700Bold') */
  displayWeight: string;
  bodyWeights: string[];
  /** Google Fonts name for next/font/google (e.g. 'Playfair Display') */
  displayGoogle: string;
  bodyGoogle: string;
  /** CSS variable name (e.g. '--font-display') */
  displayVariable: string;
  bodyVariable: string;
  /** Human-readable label used in CSS `font-family` fallback */
  displayLabel: string;
  bodyLabel: string;
}

export interface ThemePreset {
  name: string;
  description: string;
  colors: ThemeColorSet;
  fonts: FontPair;
}

export const THEMES: ThemePreset[] = [
  // ─── Current Cinematic Void (Gold) ─────────────────────────────────
  {
    name: 'cinematic-void',
    description: 'Amber Gold + Deep Black — current default',
    colors: {
      void: '#070708',
      surface: '#0E0E11',
      elevated: '#16161A',
      subtle: '#222226',
      'text-primary': '#F4F4F5',
      'text-secondary': '#A1A1AA',
      'text-tertiary': '#52525B',
      primary: '#D4A237',
      'primary-dim': '#B88B2A',
      secondary: '#8B5CF6',
      success: '#4CAF82',
      destructive: '#E05252',
      info: '#5B9CF6',
    },
    fonts: {
      displayPackage: 'playfair-display',
      bodyPackage: 'inter',
      displayWeight: 'PlayfairDisplay_700Bold',
      bodyWeights: ['Inter_400Regular', 'Inter_500Medium', 'Inter_600SemiBold'],
      displayGoogle: 'Playfair Display',
      bodyGoogle: 'Inter',
      displayVariable: '--font-display',
      bodyVariable: '--font-body',
      displayLabel: 'Playfair Display',
      bodyLabel: 'Inter',
    },
  },

  // ─── Cinematic Void with Brighter Gold ─────────────────────────────
  {
    name: 'imdb-gold',
    description: 'Same deep black but brighter IMDB-style gold (#F5C518)',
    colors: {
      void: '#070708',
      surface: '#0E0E11',
      elevated: '#16161A',
      subtle: '#222226',
      'text-primary': '#F4F4F5',
      'text-secondary': '#A1A1AA',
      'text-tertiary': '#52525B',
      primary: '#F5C518',
      'primary-dim': '#D4A237',
      secondary: '#8B5CF6',
      success: '#4CAF82',
      destructive: '#E05252',
      info: '#5B9CF6',
    },
    fonts: {
      displayPackage: 'playfair-display',
      bodyPackage: 'inter',
      displayWeight: 'PlayfairDisplay_700Bold',
      bodyWeights: ['Inter_400Regular', 'Inter_500Medium', 'Inter_600SemiBold'],
      displayGoogle: 'Playfair Display',
      bodyGoogle: 'Inter',
      displayVariable: '--font-display',
      bodyVariable: '--font-body',
      displayLabel: 'Playfair Display',
      bodyLabel: 'Inter',
    },
  },

  // ─── Crimson Noir (Letterboxd / Mubi style) ────────────────────────
  {
    name: 'crimson-noir',
    description: 'Vibrant Cinema Red on cool-tone black',
    colors: {
      void: '#0B0B0D',
      surface: '#131316',
      elevated: '#1C1C21',
      subtle: '#2C2C33',
      'text-primary': '#F5F5F7',
      'text-secondary': '#94949C',
      'text-tertiary': '#5C5C66',
      primary: '#FF3B30',
      'primary-dim': '#D32F2F',
      secondary: '#3478F6',
      success: '#30D158',
      destructive: '#FF453A',
      info: '#3478F6',
    },
    fonts: {
      displayPackage: 'playfair-display',
      bodyPackage: 'inter',
      displayWeight: 'PlayfairDisplay_700Bold',
      bodyWeights: ['Inter_400Regular', 'Inter_500Medium', 'Inter_600SemiBold'],
      displayGoogle: 'Playfair Display',
      bodyGoogle: 'Inter',
      displayVariable: '--font-display',
      bodyVariable: '--font-body',
      displayLabel: 'Playfair Display',
      bodyLabel: 'Inter',
    },
  },

  // ─── Electric Cyberpunk ────────────────────────────────────────────
  {
    name: 'cyberpunk',
    description: 'Neon Cyan/Electric Blue on true black — sci-fi vibe',
    colors: {
      void: '#050507',
      surface: '#0D0D12',
      elevated: '#18181F',
      subtle: '#282830',
      'text-primary': '#F0F0F5',
      'text-secondary': '#8A8A99',
      'text-tertiary': '#525261',
      primary: '#00E5FF',
      'primary-dim': '#00B0CC',
      secondary: '#D500F9',
      success: '#00E676',
      destructive: '#FF1744',
      info: '#00E5FF',
    },
    fonts: {
      displayPackage: 'space-grotesk',
      bodyPackage: 'dm-sans',
      displayWeight: 'SpaceGrotesk_700Bold',
      bodyWeights: ['DMSans_400Regular', 'DMSans_500Medium', 'DMSans_700Bold'],
      displayGoogle: 'Space Grotesk',
      bodyGoogle: 'DM Sans',
      displayVariable: '--font-display',
      bodyVariable: '--font-body',
      displayLabel: "'Space Grotesk', sans-serif",
      bodyLabel: "'DM Sans', sans-serif",
    },
  },

  // ─── Midnight Indigo (Apple TV+ style) ─────────────────────────────
  {
    name: 'midnight-indigo',
    description: 'Deep navy/indigo dark mode — easy on eyes, elegant',
    colors: {
      void: '#08081A',
      surface: '#11112B',
      elevated: '#1C1C3E',
      subtle: '#2A2A4E',
      'text-primary': '#F2F2F7',
      'text-secondary': '#9899A8',
      'text-tertiary': '#5C5C70',
      primary: '#5E5CE6',
      'primary-dim': '#4847BF',
      secondary: '#BF5AF2',
      success: '#30D158',
      destructive: '#FF453A',
      info: '#5E5CE6',
    },
    fonts: {
      displayPackage: 'bodoni-moda',
      bodyPackage: 'plus-jakarta-sans',
      displayWeight: 'BodoniModa_700Bold',
      bodyWeights: ['PlusJakartaSans_400Regular', 'PlusJakartaSans_500Medium', 'PlusJakartaSans_600SemiBold'],
      displayGoogle: 'Bodoni Moda',
      bodyGoogle: 'Plus Jakarta Sans',
      displayVariable: '--font-display',
      bodyVariable: '--font-body',
      displayLabel: "'Bodoni Moda', serif",
      bodyLabel: "'Plus Jakarta Sans', sans-serif",
    },
  },

  // ─── Festival Poster (Cinematic & Condensed) ───────────────────────
  {
    name: 'festival-poster',
    description: 'Impactful tall condensed headings — Oswald + Barlow',
    colors: {
      void: '#0A0A0A',
      surface: '#121212',
      elevated: '#1A1A1A',
      subtle: '#2A2A2A',
      'text-primary': '#F0F0F0',
      'text-secondary': '#888888',
      'text-tertiary': '#505050',
      primary: '#E50914',
      'primary-dim': '#B20710',
      secondary: '#8B5CF6',
      success: '#4CAF82',
      destructive: '#E05252',
      info: '#5B9CF6',
    },
    fonts: {
      displayPackage: 'oswald',
      bodyPackage: 'barlow',
      displayWeight: 'Oswald_700Bold',
      bodyWeights: ['Barlow_400Regular', 'Barlow_500Medium', 'Barlow_600SemiBold'],
      displayGoogle: 'Oswald',
      bodyGoogle: 'Barlow',
      displayVariable: '--font-display',
      bodyVariable: '--font-body',
      displayLabel: "'Oswald', sans-serif",
      bodyLabel: "'Barlow', sans-serif",
    },
  },
];
