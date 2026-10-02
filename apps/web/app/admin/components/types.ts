/* ── Dashboard types ──────────────────────────────────────────────── */

export type Dashboard = {
  meta: { fromDay: string; toDay: string; event: string | null; total: number };
  /** Distinct anonymous-install aggregates (random UUIDs, aggregate-only). */
  audience?: {
    uniquesTotal: number;
    eventsPerInstall: number;
    uniquesByDay: { day: string; n: number }[];
  };
  daily: Record<string, Record<string, number>>;
  funnel: {
    watchOpened: Record<string, number>;
    /** watch_end by player surface (direct native vs embed webview). */
    watchEndSurface?: { surface: string; n: number; durMs: number }[];
    playerStart: Record<string, number>;
    playerErrors: { errorClass: string; surface: string; n: number }[];
    providerSwitches: Record<string, number>;
    bufferStalls: number;
  };
  features: { feature: string; context: string; n: number }[];
  screens: Record<string, number>;
  sessions: {
    closeFromScreen: Record<string, number>;
    durationBuckets: Record<string, number>;
    perDay: { day: string; n: number }[];
  };
  p5: {
    completionCurve: Record<string, number>;
    resumeCorrection: Record<string, number>;
    seekLatency: { kind: string; n: number; avgMs: number; maxMs: number }[];
    exitDuringSwitch: Record<string, number>;
    watchHourHistogram: { hour: number; n: number }[];
    intentToFirstFrame?: { p50: number; p90: number; n: number };
    qualityDist?: Record<string, number>;
    rebuffer?: {
      total: number;
      stallMs: number;
      sessions: number;
      stallEvents: number;
    };
  };
  totals: Record<string, number>;
};

export type RawRow = {
  name: string;
  ts: number;
  appVersion: string;
  connectionClass: string;
  deviceTier: string;
  /** First 8 chars of the anonymous install UUID (privacy-truncated). */
  anonId?: string | null;
  dims: Record<string, string | number | boolean>;
};

export type DrillState = {
  event: string;
  from: string;
  to: string;
  title: string;
} | null;

export type Range =
  | { kind: "preset"; days: number }
  | { kind: "custom"; from: string; to: string };
