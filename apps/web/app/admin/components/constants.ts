/* ── Dashboard constants ──────────────────────────────────────────── */

/** Brand gold accent. */
export const GOLD = "#D4A237";

/** Human-friendly labels for raw dimension keys. */
export const LABELS: Record<string, string> = {
  "dead-head": "Dead head",
  "manual-pick": "Manual pick",
  exhausted: "Chain exhausted",
  "auto-fallback": "Auto fallback",
  first_frame: "First frame",
  gave_up: "Gave up",
  error: "Error",
  double_tap: "Double-tap seek",
  buttons: "±10s buttons",
  scrub: "Scrub release",
  resume: "Resume seek",
  home: "Home",
  detail_movie: "Movie detail",
  detail_tv: "TV detail",
  watch: "Watch page",
  search: "Search",
  library: "Library",
  history: "History",
  saved: "Saved",
  settings: "Settings",
  download: "Downloader",
  true: "Yes",
  false: "No",
  "0-5": "0–5%",
  "5-25": "5–25%",
  "25-50": "25–50%",
  "50-75": "50–75%",
  "75-90": "75–90%",
  "90-100": "90–100%",
  "480p": "480p",
  "720p": "720p",
  "1080p": "1080p",
  "4k": "4K",
  unknown: "Unknown",
  direct: "Direct",
  embed: "Embed",
  wifi: "Wi-Fi",
  cellular: "Cellular",
};

export function label(k: string): string {
  return LABELS[k] ?? k;
}

/** Completion-curve buckets: left (low) → right (high), red → green. */
export const COMPLETION_ORDER = [
  "0-5",
  "5-25",
  "25-50",
  "50-75",
  "75-90",
  "90-100",
];
export const COMPLETION_COLORS: Record<string, string> = {
  "0-5": "#F87171",
  "5-25": "#FB923C",
  "25-50": "#FBBF24",
  "50-75": "#D4A237",
  "75-90": "#A3E635",
  "90-100": "#34D399",
};

/** Session-duration buckets in order. */
export const DURATION_ORDER = [
  "<1m",
  "1-5m",
  "5-15m",
  "15-30m",
  "30-60m",
  "60m+",
];
export const DURATION_COLORS: Record<string, string> = {
  "<1m": "#64748B",
  "1-5m": "#94A3B8",
  "5-15m": "#5B9CF6",
  "15-30m": "#D4A237",
  "30-60m": "#A3E635",
  "60m+": "#34D399",
};

/** Event trend series we know about, in preferred order. */
export const TREND_SERIES = [
  "watch_opened",
  "player_start",
  "watch_end",
  "player_error",
  "buffer_stall",
  "provider_switch",
  "feature_used",
  "screen_view",
  "session_end",
  "search_performed",
  "app_launch",
];

export const SERIES_COLORS: Record<string, string> = {
  watch_opened: GOLD,
  player_start: "#5B9CF6",
  watch_end: "#34D399",
  player_error: "#F87171",
  buffer_stall: "#FB923C",
  provider_switch: "#A78BFA",
  feature_used: "#38BDF8",
  screen_view: "#64748B",
  session_end: "#F472B6",
  search_performed: "#4ADE80",
  app_launch: "#94A3B8",
};

/** Quality tiers ordered low→high. */
export const QUALITY_ORDER = ["480p", "720p", "1080p", "4k", "unknown"];
export const QUALITY_COLORS: Record<string, string> = {
  "480p": "#F87171",
  "720p": "#FB923C",
  "1080p": GOLD,
  "4k": "#34D399",
  unknown: "#475569",
};

/** Range presets. */
export const PRESETS = [
  { label: "24 h", days: 1 },
  { label: "7 d", days: 7 },
  { label: "30 d", days: 30 },
  { label: "90 d", days: 90 },
];
