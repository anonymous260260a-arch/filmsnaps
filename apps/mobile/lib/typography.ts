import type { TextStyle } from 'react-native';

/**
 * FilmSnaps typography system.
 *
 * display  → Playfair Display 700 · 28px  — Hero titles
 * heading  → Playfair Display 700 · 20px  — Section headings
 * title    → Inter 600 · 15px             — Card titles, screen headers
 * body     → Inter 400 · 13px             — Descriptions, overviews
 * caption  → Inter 400 · 11px             — Metadata, year, runtime
 * label    → Inter 500 · 11px             — Badges, chips, small buttons
 */
export const typography: Record<string, TextStyle> = {
  display: {
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 28,
    lineHeight: 32,
    color: '#F4F4F5',
  },
  heading: {
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 20,
    lineHeight: 24,
    color: '#F4F4F5',
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
    color: '#F4F4F5',
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: '#A1A1AA',
  },
  caption: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 14,
    color: '#A1A1AA',
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 14,
    color: '#A1A1AA',
  },
};
