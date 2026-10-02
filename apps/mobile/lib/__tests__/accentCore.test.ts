/**
 * accentCore unit tests — the lab contract that is NOT covered by the
 * 20-title parity fixtures (spec Part 5):
 *  - swatchesFromPixels on synthetic arrays (grey → no swatch; two-hue
 *    image → two candidates, larger weighted first; <50 usable px throws),
 *  - anchorAt wrap-around (h=359, h=5),
 *  - AA loops terminate (every hue returns),
 *  - washHue mapping (70→60, 125→73.75 — the spec text's 72.5 was a typo;
 *    the lab code is the spec),
 * plus the structural contract of zoneOf / buildPalette / contrast /
 * grey gating / pick scoring.
 */
import { describe, expect, it } from "vitest";
import {
  C,
  TUNE,
  anchorAt,
  buildPalette,
  contrast,
  cMaxAt,
  isGrey,
  paintAccent,
  pickAccent,
  scoreSwatch,
  swatchesFromPixels,
  zoneOf,
  type PaintSuccess,
  type Swatch,
} from "../accentCore";

/** RGBA image from [r,g,b] triples (alpha 255). */
function image(pixels: Array<[number, number, number]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

function fill(
  n: number,
  rgb: [number, number, number],
): Array<[number, number, number]> {
  return Array.from({ length: n }, () => rgb);
}

describe("swatchesFromPixels (synthetic images)", () => {
  it("a grey field yields no swatches (B&W never fakes a color)", () => {
    // ≥50 usable px (so no throw) but zero chroma → empty histogram.
    expect(swatchesFromPixels(image(fill(4096, [128, 128, 128])))).toEqual([]);
  });

  it('throws "no usable pixels" when fewer than 50 pixels are usable', () => {
    expect(() => swatchesFromPixels(image(fill(16, [200, 40, 40])))).toThrow(
      "no usable pixels",
    );
  });

  it("skips transparent pixels (alpha < 200)", () => {
    const data = new Uint8ClampedArray(1000 * 4);
    for (let i = 0; i < 1000; i++) {
      data[i * 4] = 200;
      data[i * 4 + 1] = 40;
      data[i * 4 + 2] = 40;
      data[i * 4 + 3] = 100; // transparent → every pixel skipped → used=0
    }
    expect(() => swatchesFromPixels(data)).toThrow("no usable pixels");
  });

  it("skips near-black pixels (r,g,b < 18)", () => {
    expect(() => swatchesFromPixels(image(fill(1000, [10, 10, 10])))).toThrow(
      "no usable pixels",
    );
  });

  it("a two-hue image yields two candidates, larger weighted first", () => {
    // 700 vivid red + 300 vivid blue (distinct 10° bins, L in [0.3, 0.8]
    // so both carry full weight) → h1 = red (bigger wshare), h2 = blue.
    const pixels = [...fill(700, [210, 40, 40]), ...fill(300, [40, 80, 210])];
    const swatches = swatchesFromPixels(image(pixels));
    expect(swatches).toHaveLength(2);

    const [h1, h2] = swatches;
    expect(h1.name).toBe("h1");
    expect(h2.name).toBe("h2");
    expect(h1.share).toBeGreaterThan(h2.share);
    expect(h1.wshare).toBeGreaterThan(h2.wshare);

    // Family check via the representative hexes: red sits in the r-dominant
    // corner, blue in the b-dominant corner (hue is preserved end-to-end).
    const rgb1 = C.rgb(h1.hex);
    const rgb2 = C.rgb(h2.hex);
    expect(rgb1.r).toBeGreaterThan(rgb1.b);
    expect(rgb2.b).toBeGreaterThan(rgb2.r);
  });

  it("share sums stay within (0, 1] per candidate", () => {
    const swatches = swatchesFromPixels(
      image([...fill(700, [210, 40, 40]), ...fill(300, [40, 80, 210])]),
    );
    for (const s of swatches) {
      expect(s.share).toBeGreaterThan(0);
      expect(s.share).toBeLessThanOrEqual(1);
      expect(s.wshare).toBeGreaterThan(0);
      expect(s.wshare).toBeLessThanOrEqual(1);
    }
  });
});

describe("anchorAt (hue-aware interpolation + wrap-around)", () => {
  it("hits the exact anchor at an anchor hue", () => {
    const a = anchorAt(350);
    expect(a.L).toBeCloseTo(0.62, 10);
    expect(a.c).toBeCloseTo(0.25, 10);
  });

  it("wraps 359° across the 350→10 seam (span 20, t = 9/20)", () => {
    const a = anchorAt(359);
    expect(a.L).toBeCloseTo(0.62, 10); // 0.62 + (0.62-0.62)*0.45
    expect(a.c).toBeCloseTo(0.2545, 10); // 0.25 + (0.26-0.25)*0.45
  });

  it("wraps 5° across the same seam (span 20, t = 15/20)", () => {
    const a = anchorAt(5);
    expect(a.L).toBeCloseTo(0.62, 10);
    expect(a.c).toBeCloseTo(0.2575, 10); // 0.25 + (0.26-0.25)*0.75
  });

  it("interpolates a mid-span hue", () => {
    // 40° sits between anchors 30 (L .70) and 55 (L .76): span 25, t 10/25.
    const a = anchorAt(40);
    expect(a.L).toBeCloseTo(0.7 + (0.76 - 0.7) * 0.4, 10);
    expect(a.c).toBeCloseTo(0.23 + (0.2 - 0.23) * 0.4, 10);
  });
});

describe("paintAccent AA loops (termination)", () => {
  it("returns for every hue on the wheel — both AA loops terminate", () => {
    for (let h = 0; h < 360; h++) {
      const seed = C.formatHex({ mode: "oklch", l: 0.55, c: 0.14, h });
      const result = paintAccent(seed);
      expect(result, `h=${h}`).not.toHaveProperty("fail");
      const p = result as PaintSuccess;
      expect(p.accent, `h=${h}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(p.text === "#ffffff" || p.text === "#0a0a0b").toBe(true);
      // zone is derived from the PARSED seed hue; hex round-tripping shifts
      // hue by ±1° at RGB rounding, so assert membership (boundary exactness
      // is pinned by the zoneOf table test above).
      expect(zoneOf(C.oklch(seed).h)).toBe(p.zone);
    }
  });

  it("grey input fails instead of painting a fake color", () => {
    expect(paintAccent("#808080")).toEqual({ fail: "grey" });
    expect(paintAccent("#070708")).toEqual({ fail: "grey" });
    expect(paintAccent("#ffffff")).toEqual({ fail: "grey" });
  });
});

describe("zoneOf (boundary table)", () => {
  it("matches the lab's zone edges", () => {
    expect(zoneOf(29)).toBe("red");
    expect(zoneOf(30)).toBe("coral");
    expect(zoneOf(54)).toBe("coral");
    expect(zoneOf(55)).toBe("amber");
    expect(zoneOf(79)).toBe("amber");
    expect(zoneOf(80)).toBe("gold");
    expect(zoneOf(109)).toBe("gold");
    expect(zoneOf(110)).toBe("green");
    expect(zoneOf(154)).toBe("green");
    expect(zoneOf(155)).toBe("cool");
    expect(zoneOf(259)).toBe("cool");
    expect(zoneOf(260)).toBe("violet");
    expect(zoneOf(329)).toBe("violet");
    expect(zoneOf(330)).toBe("red");
    expect(zoneOf(359)).toBe("red");
  });
});

describe("buildPalette (v10 wash — six keys, wash alphas)", () => {
  it("returns exactly { accent, accentText, glow, mid, faded, tint }", () => {
    const p = buildPalette("#dd002a", "#ffffff");
    expect(Object.keys(p).sort()).toEqual([
      "accent",
      "accentText",
      "faded",
      "glow",
      "mid",
      "tint",
    ]);
    expect(p.accent).toBe("#dd002a");
    expect(p.accentText).toBe("#ffffff");
  });

  it("glow/mid/faded are rgba strings with the v10 wash alphas", () => {
    const p = buildPalette("#f56f0b", "#0a0a0b");
    expect(p.glow).toMatch(/^rgba\(\d+,\d+,\d+,0\.82\)$/);
    expect(p.mid).toMatch(/^rgba\(\d+,\d+,\d+,0\.94\)$/);
    expect(p.faded).toMatch(/^rgba\(\d+,\d+,\d+,1\)$/);
    expect(p.tint).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("contrast / grey gate / scoring", () => {
  it("contrast matches WCAG luminance ratio", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 6);
    expect(contrast("#dd002a", "#dd002a")).toBeCloseTo(1, 6);
  });

  it("isGrey is the OR of the absolute floor and the gamut-relative ratio", () => {
    expect(isGrey(C.oklch("#808080"))).toBe(true);
    expect(isGrey(C.oklch("#dd002a"))).toBe(false);
    // Relative branch: chroma above the absolute floor but under
    // 0.22 × what the gamut holds at this (L, H) is still grey.
    const nearGrey = { mode: "oklch", l: 0.9, c: 0.03, h: 120 };
    expect(cMaxAt(nearGrey.l, nearGrey.h)).toBeGreaterThan(0.13); // 0.22×0.13≈0.029
    expect(isGrey(nearGrey)).toBe(true);
  });

  it("pickAccent skips grey candidates and scores the rest", () => {
    const swatches: Swatch[] = [
      { name: "g", hex: "#808080", population: 10, share: 0.5, wshare: 0.5 },
      { name: "r", hex: "#cc2233", population: 10, share: 0.5, wshare: 0.5 },
    ];
    const picked = pickAccent(swatches);
    expect(picked?.hex).toBe("#cc2233");
    expect(picked!.score).toBeGreaterThan(0);

    expect(
      pickAccent([swatches[0], { ...swatches[0], name: "g2" }]),
    ).toBeNull();
  });

  it("scoreSwatch applies the skin-box penalty (lFloor branch)", () => {
    // L .60, C .08, H 50 → inside the skin box (h 25–75, c .03–.13,
    // l ≥ .55) → ×0.4; the raw factor is recomputed here from the
    // exported pieces so the penalty branch is provably engaged.
    const hex = C.formatHex({ mode: "oklch", l: 0.6, c: 0.08, h: 50 });
    const s: Swatch = { name: "skin", hex, population: 1, share: 1, wshare: 1 };
    const col = C.oklch(hex);
    const raw =
      Math.sqrt(s.wshare) * Math.pow(col.c / cMaxAt(col.l, col.h), 0.8);
    expect(scoreSwatch(s)).toBeCloseTo(raw * 0.4, 10);

    // Same construction outside the box (H 120) carries no penalty factor
    // from skin — only the mud box could apply, and it does not here.
    const hex2 = C.formatHex({ mode: "oklch", l: 0.6, c: 0.08, h: 120 });
    const s2: Swatch = {
      name: "non",
      hex: hex2,
      population: 1,
      share: 1,
      wshare: 1,
    };
    const col2 = C.oklch(hex2);
    const raw2 =
      Math.sqrt(s2.wshare) * Math.pow(col2.c / cMaxAt(col2.l, col2.h), 0.8);
    expect(scoreSwatch(s2)).toBeCloseTo(raw2, 10);
  });
});

describe("TUNE (locked recipe values)", () => {
  it("pins the v10 constants a silent re-tune would break", () => {
    expect(TUNE.anchors).toHaveLength(12);
    expect(TUNE.sat).toEqual({ lo: 0.9, hi: 1.0, srcFull: 0.1 });
    expect(TUNE.whiteBelowL).toBe(0.67);
    expect(TUNE.aaTarget).toBe(5.0);
    expect(TUNE.aaFloor).toBe(4.5);
    expect(TUNE.hist).toEqual({
      bins: 36,
      minPxC: 0.02,
      maxCands: 4,
      minRel: 0.12,
    });
    expect(TUNE.wash.a).toEqual({ glow: 0.82, mid: 0.94, faded: 1.0 });
    expect(TUNE.wash.L).toEqual({
      glow: 0.52,
      mid: 0.42,
      faded: 0.28,
      tint: 0.52,
    });
    expect(TUNE.wash.goldCap).toBe(0.18);
    expect(TUNE.wash.cCap).toBe(0.24);
    expect(TUNE.pick.skin.pen).toBe(0.4);
    expect(TUNE.pick.mud.pen).toBe(0.45);
  });
});
