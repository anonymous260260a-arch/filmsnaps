/* ── Dashboard formatting utilities ──────────────────────────────── */

/** Format an integer with locale separators. */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Format a millisecond value to a human-readable duration. */
export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/** Format a part/total as a percentage. */
export function fmtPct(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${((part / total) * 100).toFixed(part / total > 0.1 ? 0 : 1)}%`;
}

/** Format a YYYY-MM-DD string to "Sep 27"-style display. */
export function fmtDay(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Sum all values in a record or array. */
export function sum(
  rec: Record<string, number> | number[] | undefined,
): number {
  if (!rec) return 0;
  const vals = Array.isArray(rec) ? rec : Object.values(rec);
  return vals.reduce((a, b) => a + b, 0);
}

/** Return entries sorted by value descending. */
export function sortedEntries(
  rec: Record<string, number> | undefined,
): [string, number][] {
  return Object.entries(rec ?? {}).sort((a, b) => b[1] - a[1]);
}

/** Convert a timestamp to YYYY-MM-DD. */
export function dayStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
