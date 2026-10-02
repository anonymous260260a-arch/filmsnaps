import { clearSwatchCache, resolveSwatch } from "../movieAccent";

const pct = (a: number[], p: number) =>
  [...a].sort((x, y) => x - y)[
    Math.min(a.length - 1, Math.floor((p / 100) * a.length))
  ];

/**
 * Device benchmark for the accent engine (from the expert's REPORT.md).
 * Run from a dev-only screen: await runAccentBench(posterPaths, backdropPaths).
 * Logs p50/p95 + worst JS stall. Budgets: poster p50 <= 50ms, backdrop
 * p50 <= 300ms, worst stall < 16ms.
 */
export async function runAccentBench(
  posters: string[],
  backdrops: string[],
  rounds = 3,
) {
  let worstStall = 0;
  let last = Date.now();
  const tick = setInterval(() => {
    const n = Date.now();
    worstStall = Math.max(worstStall, n - last - 16);
    last = n;
  }, 16);
  const out: Record<string, { p50: number; p95: number }> = {};
  for (const [label, paths, size] of [
    ["poster w342", posters, "w342"],
    ["backdrop w1280", backdrops, "w1280"],
  ] as const) {
    const t: number[] = [];
    for (let r = 0; r < rounds; r++) {
      for (const p of paths) {
        clearSwatchCache(); // cold each time (HTTP caches still warm after round 1 — drop round 0 for cold-net numbers)
        const s = performance.now();
        await resolveSwatch(p, size);
        t.push(performance.now() - s);
      }
    }
    out[label] = { p50: Math.round(pct(t, 50)), p95: Math.round(pct(t, 95)) };
  }
  clearInterval(tick);
  console.log(
    "[accent-bench]",
    JSON.stringify({
      ...out,
      worstJsStallMs: Math.max(0, Math.round(worstStall)),
    }),
  );
  return out;
}
