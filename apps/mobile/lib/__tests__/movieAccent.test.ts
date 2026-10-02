/**
 * movieAccent — color-quality gate tests (OKLCH recipe, phase 2).
 *
 * These pin the "never cheap colors" contract:
 *  - the produced CTA accent always lands in the OKLCH tone band
 *    (L 0.52–0.66, C 0.08–0.15) with the seed's HUE PRESERVED,
 *  - a swatch that fails the strict gate must not strand richer candidates
 *    behind it (the old first-valid-hex pick),
 *  - population-weighted scoring: vivid slivers beat big dull fields, and
 *    the skin/beige penalty keeps faces from winning,
 *  - near-neutral posters still tint via the relaxed tier,
 *  - true grey stays brand-neutral (no fake color),
 *  - olive/khaki mud is rejected in every tier,
 *  - the produced CTA accent always carries AA-contrast text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import tinycolor from "tinycolor2";
import { oklch } from "culori";
import type { ImageColorsResult } from "react-native-image-colors";
import {
  buildPalette,
  clearSwatchCache,
  hueDistance,
  peekSwatch,
  pickAccentSwatch,
  pickAccentWithMeta,
  pickFromSwatchBag,
  resolveSwatch,
  skinPenalty,
  subscribeSwatch,
} from "../movieAccent";

// The native engine is stubbed per-test (vi.mock is hoisted above imports;
// the mock is configured through this handle).
const nativeState: {
  getSwatches: ReturnType<typeof vi.fn> | null;
  peekSwatches: ReturnType<typeof vi.fn> | null;
} = { getSwatches: null, peekSwatches: null };

vi.mock("../../modules/movie-accent", () => ({
  DECODE_WIDTH: 64,
  MovieAccent: new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "getSwatches") return nativeState.getSwatches;
        if (prop === "peekSwatches") return nativeState.peekSwatches;
        return undefined;
      },
    },
  ),
}));

const hsl = (h: number, s: number, l: number) =>
  tinycolor({ h, s, l }).toHexString();

beforeEach(() => {
  clearSwatchCache();
  nativeState.getSwatches = null;
  nativeState.peekSwatches = null;
});

function androidResult(
  swatches: Partial<Record<string, string | null>>,
): ImageColorsResult {
  return { platform: "android", ...swatches } as unknown as ImageColorsResult;
}

/** OKLCH readout helper (h defaults 0 for pure greys, mirroring culori). */
function okc(hex: string): { l: number; c: number; h: number } {
  const o = oklch(hex);
  if (!o) throw new Error(`unparsable fixture: ${hex}`);
  return { l: o.l, c: o.c ?? 0, h: o.h ?? 0 };
}

/** Relaxed-tier steel fixture (OKLCH C ≈ 0.051 — above the 0.04 floor). */
const STEEL = hsl(215, 0.3, 0.38);

describe("pickAccentSwatch (order walk, no populations)", () => {
  it("does not strand richer candidates behind a rejected first pick", () => {
    // `average` is a near-grey that the strict gate rejects; the old
    // first-valid-hex pick returned it and gave up — the vibrant red behind
    // it never got a chance.
    const result = androidResult({
      average: "#8a8a8a",
      vibrant: "#c0392b",
    });
    expect(pickAccentSwatch(result)).toBe("#c0392b");
  });

  it("prefers the dark, saturated variants in order (equal weight)", () => {
    // String bags carry no population → weight 1 each. With saturation in
    // the score, ORDER breaks EXACT ties — expressed here with identical
    // hexes (hsl() roundtrips drift s in the 4th decimal, which would flip
    // a "tie" on parse noise).
    const same = "#c0392b";
    const result = androidResult({ darkVibrant: same, vibrant: same });
    expect(pickAccentSwatch(result)).toBe(same);
  });

  it("a more saturated candidate wins the bag even behind an earlier one", () => {
    // Scoring consequence: with equal populations, saturation × weight
    // decides — the vivid red outranks the calmer blue regardless of order.
    const result = androidResult({
      darkVibrant: hsl(220, 0.6, 0.4),
      vibrant: hsl(10, 0.8, 0.45),
    });
    expect(pickAccentSwatch(result)).toBe(hsl(10, 0.8, 0.45));
  });

  it("falls back to the relaxed tier for near-neutral posters", () => {
    // No swatch passes the strict gate; a steel tint just above the
    // relaxed chroma floor should still be accepted over returning null —
    // which would strand the surface on brand gold.
    const result = androidResult({
      average: STEEL,
      dominant: STEEL,
    });
    const picked = pickAccentSwatch(result);
    expect(picked).toBe(STEEL);
    // And it must produce a usable palette.
    expect(buildPalette(picked!)).not.toBeNull();
  });

  it("never picks true grey (no fake color for B&W posters)", () => {
    const result = androidResult({
      average: "#7d7d7d",
      dominant: "#808080",
      muted: "#828282",
    });
    expect(pickAccentSwatch(result)).toBeNull();
  });

  it("lifts olive/khaki mud into the vivid band (relaxed tier) on its own hue", () => {
    // #6b6b47 — olive: OKLCH H ≈ 108, C ≈ 0.053. Strict rejects it so a
    // better-hued swatch can win; the relaxed tier LIFTS it to C 0.10 so
    // olive-graded posters still get an accent instead of brand gold — and
    // the painted accent is never the muted value itself.
    const result = androidResult({
      dominant: "#6b6b47",
      average: "#6b6b47",
      muted: "#6b6b47",
    });
    expect(pickAccentSwatch(result)).toBe("#6b6b47");
    const palette = buildPalette("#6b6b47");
    expect(palette).not.toBeNull();
    const o = okc(palette!.accent);
    expect(o.c).toBeGreaterThanOrEqual(0.09); // vivid, not mud
    expect(Math.round(o.h)).toBe(108); // own hue preserved
  });

  it("lifts warm skin/brown into vivid caramel — never paints the mud value", () => {
    // #ac7853 — a classic poster skin/brown tone: OKLCH H 56, C 0.083.
    // Painting it as-is was the "light reddish brown" app; the strict gate
    // rejects it (warm needs C ≥ 0.11) and the relaxed tier LIFTS it, so
    // warm-graded posters get a vivid amber/caramel accent on the same hue.
    const result = androidResult({
      dominant: "#ac7853",
      average: "#ac7853",
      darkMuted: "#ac7853",
    });
    expect(pickAccentSwatch(result)).toBe("#ac7853");
    for (const mud of ["#ac7853", "#8a5a3c", "#d9c8a9"]) {
      const palette = buildPalette(mud);
      expect(palette).not.toBeNull();
      const o = okc(palette!.accent);
      // The painted accent must be OUTSIDE the mud zone: warm hues carry
      // ≥ 0.11 chroma, cool hues ≥ 0.09 — i.e. never the muted source value.
      expect(o.c).toBeGreaterThanOrEqual(0.09);
      if (o.h >= 15 && o.h <= 70) {
        expect(o.c).toBeGreaterThanOrEqual(0.11);
      }
    }
  });

  it("returns null when nothing usable exists", () => {
    expect(pickAccentSwatch(androidResult({ average: null }))).toBeNull();
  });

  it("strict candidates still beat lifted (relaxed) ones in the bag walk", () => {
    // The relaxed tier is a LAST resort: a strict candidate anywhere in the
    // bag beats a muted-but-liftable one, regardless of order.
    const strict = hsl(210, 0.6, 0.4);
    const bag = {
      darkVibrant: "#6b6b47", // olive — strict-rejected, relaxed-liftable
      vibrant: strict,
    };
    expect(pickFromSwatchBag(bag)).toBe(strict);
  });
});

describe("population-weighted scoring (native v4 bags)", () => {
  it("a vivid sliver beats a large dull field", () => {
    const bag = {
      // Huge population, low saturation (poster background field).
      darkMuted: { hex: hsl(210, 0.2, 0.35), population: 9000 },
      // Tiny population, high saturation (the actual color story).
      vibrant: { hex: hsl(350, 0.8, 0.45), population: 500 },
    };
    expect(pickFromSwatchBag(bag)).toBe(bag.vibrant.hex);
  });

  it("a large vivid field beats a small vivid sliver", () => {
    const dv = hsl(220, 0.6, 0.4);
    const v = hsl(220, 0.65, 0.5);
    const bag = {
      darkVibrant: { hex: dv, population: 8000 },
      vibrant: { hex: v, population: 300 },
    };
    expect(pickFromSwatchBag(bag)).toBe(dv);
  });

  it("applies the skin penalty: a big face never wins", () => {
    // Warm face tone that PASSES the brown gate (C 0.116 ≥ 0.11) — so this
    // isolates the scoring penalty, not the gate.
    const face = hsl(25, 0.5, 0.5); // hue 15–45, s 0.2–0.5
    expect(skinPenalty(face)).toBe(0.4);
    const teal = hsl(185, 0.55, 0.4);
    const bag = {
      dominant: { hex: face, population: 3000 },
      muted: { hex: teal, population: 2000 },
    };
    // face: 0.5 × 3000 × 0.4 = 600; teal: 0.55 × 2000 × 1 = 1100 → the
    // penalized face must lose. Without the penalty the face would win
    // (1500 > 1100), so this test only passes when the penalty is applied.
    expect(pickFromSwatchBag(bag)).toBe(teal);
  });

  it("skin penalty uses the OKLCH box (h 25–80°, C 0.03–0.14)", () => {
    // In-box: graded-orange face (the case the old HSL box missed).
    expect(skinPenalty(hsl(30, 0.5, 0.5))).toBe(0.4);
    // Out: magenta/red hues below OKLCH hue 25.
    expect(skinPenalty("#d63384")).toBe(1);
    // Out: green hues above OKLCH hue 80.
    expect(skinPenalty(hsl(140, 0.5, 0.4))).toBe(1);
    // Out: chroma below 0.03 (near-grey warm).
    expect(skinPenalty(hsl(40, 0.05, 0.8))).toBe(1);
    // Out: chroma above 0.14 (vivid orange — a real color story, not skin).
    expect(skinPenalty(hsl(30, 0.9, 0.55))).toBe(1);
  });

  it("reports the winner and tier through pickAccentWithMeta", () => {
    const bag = {
      darkMuted: { hex: hsl(210, 0.2, 0.35), population: 9000 },
      vibrant: { hex: hsl(350, 0.8, 0.45), population: 500 },
    };
    const meta = pickAccentWithMeta(bag);
    expect(meta?.name).toBe("vibrant");
    expect(meta?.tier).toBe("strict");
    expect(typeof meta?.score).toBe("number");
  });
});

describe("buildPalette (OKLCH tone band)", () => {
  it("lands the accent inside the CTA tone band and preserves hue", () => {
    for (const swatch of ["#c0392b", "#1b4f72", "#2e7d32", "#d63384"]) {
      const palette = buildPalette(swatch);
      expect(palette).not.toBeNull();
      const o = okc(palette!.accent);
      // Revised band (v2): L .45–.60, C .09–.19 — the first cut (L .52–.66,
      // C ≤ .15) read dull and brown on warm posters on-device. The AA pass
      // (mix-toward-black, one 8% step max) may dip L a hair below the
      // floor — readability wins, so the painted bound is 0.44.
      expect(o.l).toBeGreaterThanOrEqual(0.44);
      expect(o.l).toBeLessThanOrEqual(0.6);
      // With AA darkening allowed, chroma can only drop from the band cap —
      // it must never fall below the strict floor.
      expect(o.c).toBeGreaterThanOrEqual(0.09);
      // HUE PRESERVED (mood preservation): normalized hue tracks the seed's.
      const seed = okc(swatch);
      const delta = Math.abs(o.h - seed.h) % 360;
      const hueGap = delta > 180 ? 360 - delta : delta;
      // AA darkening can shift OKLCH hue a degree or two; 10° is generous.
      expect(hueGap).toBeLessThanOrEqual(10);
    }
  });

  it("always pairs the CTA accent with AA-contrast text", () => {
    for (const swatch of ["#c0392b", "#1b4f72", STEEL, "#2e7d32", "#d63384"]) {
      const palette = buildPalette(swatch);
      expect(palette).not.toBeNull();
      const contrast = tinycolor.readability(
        palette!.accent,
        palette!.accentText,
      );
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps dark wash ends anchored near the app background", () => {
    const palette = buildPalette("#1b4f72");
    expect(palette).not.toBeNull();
    // `faded` must stay a dark, mostly-background color — a bright `faded`
    // turns the cinematic fade into a glow.
    const fadedL = tinycolor(palette!.faded).getLuminance();
    expect(fadedL).toBeLessThan(0.1);
  });

  it("rejects unusable input", () => {
    expect(buildPalette("not-a-color")).toBeNull();
  });
});

describe("pickFromSwatchBag (native-engine bag)", () => {
  it("honors preference order and skips failing candidates", () => {
    // Exact tie (same hex) → ORDER decides.
    const dv = hsl(220, 0.6, 0.4);
    expect(pickFromSwatchBag({ darkVibrant: dv, vibrant: dv })).toBe(dv);
    expect(
      pickFromSwatchBag({
        darkVibrant: hsl(60, 0.2, 0.4), // olive → strict-rejected
        darkMuted: hsl(0, 0.02, 0.3), // grey → rejected
        vibrant: hsl(10, 0.6, 0.45),
      }),
    ).toBe(hsl(10, 0.6, 0.45));
  });

  it("falls to the relaxed tier only when no strict candidate exists", () => {
    expect(pickFromSwatchBag({ darkVibrant: STEEL })).toBe(STEEL);
    expect(
      pickFromSwatchBag({
        darkVibrant: STEEL,
        vibrant: hsl(10, 0.8, 0.45),
      }),
    ).toBe(hsl(10, 0.8, 0.45));
  });

  it("returns null when everything fails", () => {
    expect(pickFromSwatchBag({ dominant: hsl(0, 0, 0.5) })).toBeNull();
    expect(pickFromSwatchBag(null)).toBeNull();
  });

  it("strict candidates beat relaxed ones regardless of order", () => {
    const v = hsl(10, 0.8, 0.45);
    const bag = {
      // Relaxed-eligible steel listed FIRST, strict crimson later.
      darkMuted: STEEL,
      vibrant: v,
    };
    expect(pickFromSwatchBag(bag)).toBe(v);
  });
});

describe("hueDistance (normalized accents)", () => {
  it("compares the painted accents, not raw swatches", () => {
    // Same hue family but WILDLY different raw lightness/chroma: the raw
    // swatches would read as far apart; the painted CTA tones are the same
    // hue, so the distance must be small.
    const dark = hsl(220, 0.5, 0.12);
    const bright = hsl(222, 0.55, 0.65);
    expect(hueDistance(dark, bright)).toBeLessThan(10);
  });

  it("still reports real hue disagreements", () => {
    const a = hsl(220, 0.6, 0.4); // blue
    const b = hsl(10, 0.8, 0.45); // red
    expect(hueDistance(a, b)).toBeGreaterThan(120);
  });

  it("is symmetric", () => {
    const a = hsl(220, 0.6, 0.4);
    const b = hsl(40, 0.5, 0.55);
    expect(hueDistance(a, b)).toBe(hueDistance(b, a));
  });
});

describe("resolveSwatch (native engine path)", () => {
  it("transport failure retries once, then memoizes for the session", async () => {
    nativeState.getSwatches = vi.fn(async () => {
      throw new Error("net");
    });
    // First visit: fails, NOT memoized (transient network errors must not
    // strand a title on brand gold until relaunch).
    await expect(resolveSwatch("/a.jpg", "w342")).resolves.toBeNull();
    expect(peekSwatch("/a.jpg")).toBeUndefined();
    // Second visit: retries — and the second failure memoizes null.
    await expect(resolveSwatch("/a.jpg", "w342")).resolves.toBeNull();
    expect(nativeState.getSwatches).toHaveBeenCalledTimes(2);
    expect(peekSwatch("/a.jpg")).toBeNull();
    // Third visit: memo hit — no further network attempts.
    await expect(resolveSwatch("/a.jpg", "w342")).resolves.toBeNull();
    expect(nativeState.getSwatches).toHaveBeenCalledTimes(2);
  });

  it("a resolved-but-unusable bag memoizes null immediately", async () => {
    nativeState.getSwatches = vi.fn(async () => ({
      dominant: "#7d7d7d",
      average: "#808080",
      muted: "#828282",
    }));
    await expect(resolveSwatch("/grey.jpg", "w342")).resolves.toBeNull();
    expect(peekSwatch("/grey.jpg")).toBeNull();
    await expect(resolveSwatch("/grey.jpg", "w342")).resolves.toBeNull();
    expect(nativeState.getSwatches).toHaveBeenCalledTimes(1);
  });

  it("commits a successful extraction and notifies subscribers", async () => {
    const hex = hsl(220, 0.6, 0.4);
    nativeState.getSwatches = vi.fn(async () => ({ darkVibrant: hex }));
    const cb = vi.fn();
    subscribeSwatch("/ok.jpg", cb);
    await expect(resolveSwatch("/ok.jpg", "w342")).resolves.toBe(hex);
    expect(peekSwatch("/ok.jpg")).toBe(hex);
    expect(cb).toHaveBeenCalledWith(hex);
  });

  it("picks the population-weighted winner from a native v4 bag", async () => {
    const winner = hsl(350, 0.8, 0.45);
    nativeState.getSwatches = vi.fn(async () => ({
      darkMuted: { hex: hsl(210, 0.2, 0.35), population: 9000 },
      vibrant: { hex: winner, population: 500 },
    }));
    await expect(resolveSwatch("/v4.jpg", "w342")).resolves.toBe(winner);
  });

  it("a timeout does not strand the late result: subscriber still fires", async () => {
    vi.useFakeTimers();
    try {
      const hex = hsl(220, 0.6, 0.4);
      let release!: (v: unknown) => void;
      nativeState.getSwatches = vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const cb = vi.fn();
      subscribeSwatch("/slow.jpg", cb);
      const p = resolveSwatch("/slow.jpg", "w342");
      await vi.advanceTimersByTimeAsync(3100);
      await expect(p).resolves.toBeNull();
      // Timeout is NOT memoized.
      expect(peekSwatch("/slow.jpg")).toBeUndefined();
      release({ darkVibrant: hex });
      await vi.advanceTimersByTimeAsync(0);
      await expect(peekSwatch("/slow.jpg")).toBe(hex);
      expect(cb).toHaveBeenCalledWith(hex);
    } finally {
      vi.useRealTimers();
    }
  });
});
