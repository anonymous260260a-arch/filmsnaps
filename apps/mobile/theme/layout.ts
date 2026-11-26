/**
 * Shared layout metrics.
 *
 * Tab screens used to hard-code the space they leave for the tab bar
 * (40/80/100 + inset), so the last row of Settings sat behind it.
 */

/** Tab bar height, excluding the safe-area inset. */
export const TAB_BAR_HEIGHT = 72;

const TAB_BAR_GAP = 16;

/** Bottom padding a tab screen's scroll content needs to clear the bar. */
export function tabBarClearance(bottomInset: number): number {
  return TAB_BAR_HEIGHT + Math.max(bottomInset, 8) + TAB_BAR_GAP;
}

/**
 * Labels in fixed-height chrome — the tab bar and the player's Sub/Dub
 * toggle — must not grow past their container on a large system font scale.
 */
export const MAX_CHROME_FONT_SCALE = 1.3;
