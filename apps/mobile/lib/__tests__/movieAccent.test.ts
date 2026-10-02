/**
 * movieAccent — v10 "Glow+" wiring tests.
 *
 * The RECIPE itself is pinned by accentParity.test.ts (20 titles bit-exact
 * vs the lab export) and accentCore.test.ts (engine units). This file pins
 * the module's INTEGRATION contract:
 *  - pickAccentSwatch (image-colors fallback): flat-fabricated candidates →
 *    lab pickAccent — grey skipped, shapes accepted, vivid beats dull,
 *  - buildPalette: wraps paintAccent exactly, six keys, AA text, rejects
 *    grey/invalid seeds,
 *  - FALLBACK_PALETTE: literal pins (classic gold look, OLD alphas),
 *  - hueDistance: normalized-accent OKLCH hue distance,
 *  - resolveSwatch/getSwatchSync: transport retry-memo, unusable→memo null,
 *    commit+notify, timeout late-commit, sync frame-1 probe via peekPixels.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageColorsResult } from "react-native-image-colors";
import {
  buildPalette,
  clearSwatchCache,
  FALLBACK_PALETTE,
  getSwatchSync,
  hueDistance,
  peekSwatch,
  pickAccentSwatch,
  resolveSwatch,
  subscribeSwatch,
} from "../movieAccent";
import { C, contrast, paintAccent } from "../accentCore";

// The native engine is stubbed per-test (vi.mock is hoisted above imports;
// the mock is configured through this handle).
const nativeState: {
  getPixels: ReturnType<typeof vi.fn> | null;
  peekPixels: ReturnType<typeof vi.fn> | null;
  clear: ReturnType<typeof vi.fn>;
} = { getPixels: null, peekPixels: null, clear: vi.fn() };

vi.mock("../../modules/movie-accent", () => ({
  DECODE_WIDTH: 64,
  MovieAccent: new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "getPixels") return nativeState.getPixels;
        if (prop === "peekPixels") return nativeState.peekPixels;
        if (prop === "clear") return nativeState.clear;
        return undefined;
      },
    },
  ),
}));

beforeEach(() => {
  clearSwatchCache();
  nativeState.getPixels = null;
  nativeState.peekPixels = null;
  nativeState.clear = vi.fn();
});

/** Flat RGBA image of a single color — the histogram yields exactly it. */
function flatImage(hex: string, w = 80, h = 80): Uint8Array {
  const { r, g, b } = C.rgb(hex);
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Colors built in OKLCH so expectations about hue/chroma are exact. */
const oklchHex = (l: number, c: number, h: number): string =>
  C.formatHex({ mode: "oklch", l, c, h });

const RED = oklchHex(0.55, 0.17, 25); // vivid red — comfortably in gamut
const BLUE_DARK = oklchHex(0.35, 0.1, 250);
const BLUE_BRIGHT = oklchHex(0.72, 0.12, 250);
const BLUE = oklchHex(0.5, 0.13, 250);
const DULL = "#334a5c"; // dark muted slate — low c/cMax, still non-grey

function androidResult(
  swatches: Partial<Record<string, string | { hex: string } | null>>,
): ImageColorsResult {
  return { platform: "android", ...swatches } as unknown as ImageColorsResult;
}

describe("pickAccentSwatch (image-colors fallback → flat lab pick)", () => {
  it("skips grey entries and picks the colorful one", () => {
    const result = androidResult({
      average: "#8a8a8a",
      vibrant: RED,
    });
    expect(pickAccentSwatch(result)).toBe(RED);
  });

  it("picks the more vivid candidate regardless of bag order", () => {
    const a = androidResult({ darkVibrant: DULL, vibrant: RED });
    const b = androidResult({ darkVibrant: RED, vibrant: DULL });
    expect(pickAccentSwatch(a)).toBe(RED);
    expect(pickAccentSwatch(b)).toBe(RED);
  });

  it("accepts both string and {hex} entry shapes", () => {
    expect(pickAccentSwatch(androidResult({ vibrant: RED }))).toBe(RED);
    expect(pickAccentSwatch(androidResult({ vibrant: { hex: RED } }))).toBe(
      RED,
    );
  });

  it("returns null when everything is grey, missing, or invalid", () => {
    expect(
      pickAccentSwatch(
        androidResult({ average: "#7d7d7d", dominant: "#808080" }),
      ),
    ).toBeNull();
    expect(pickAccentSwatch(androidResult({ average: null }))).toBeNull();
    expect(
      pickAccentSwatch(androidResult({ vibrant: "rgb(1,2,3)" })),
    ).toBeNull();
  });

  it("reads the iOS key set on that platform", () => {
    const result = {
      platform: "ios",
      background: "#808080",
      primary: BLUE,
    } as unknown as ImageColorsResult;
    expect(pickAccentSwatch(result)).toBe(BLUE);
  });
});

describe("buildPalette (v10 paint wrapper)", () => {
  it("returns exactly paintAccent's accent/text plus the six keys", () => {
    for (const seed of [RED, BLUE, "#c0392b", "#2e7d32", "#d63384"]) {
      const palette = buildPalette(seed);
      const painted = paintAccent(seed);
      expect(palette).not.toBeNull();
      expect("fail" in painted).toBe(false);
      if ("fail" in painted) continue;
      expect(palette!.accent).toBe(painted.accent);
      expect(palette!.accentText).toBe(painted.text);
      expect(Object.keys(palette!).sort()).toEqual([
        "accent",
        "accentText",
        "faded",
        "glow",
        "mid",
        "tint",
      ]);
    }
  });

  it("always pairs the CTA accent with AA-contrast text", () => {
    for (const seed of [RED, BLUE, "#1b4f72", "#2e7d32", "#d63384"]) {
      const palette = buildPalette(seed);
      expect(palette).not.toBeNull();
      expect(
        contrast(palette!.accent, palette!.accentText),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("preserves the seed hue (mood contract)", () => {
    for (const seed of [RED, BLUE, "#d63384"]) {
      const palette = buildPalette(seed);
      const delta =
        Math.abs(C.oklch(palette!.accent).h - C.oklch(seed).h) % 360;
      const gap = delta > 180 ? 360 - delta : delta;
      expect(gap).toBeLessThanOrEqual(5);
    }
  });

  it("rejects grey seeds (no fake color) and invalid input", () => {
    expect(buildPalette("#808080")).toBeNull();
    expect(buildPalette("#070708")).toBeNull();
    expect(buildPalette("#ffffff")).toBeNull();
    expect(buildPalette("not-a-color")).toBeNull();
    expect(buildPalette("rgb(1,2,3)")).toBeNull();
  });
});

describe("FALLBACK_PALETTE (classic gold look, literal pins)", () => {
  it("keeps the pre-v10 washes at the OLD alphas — never the v10 ones", () => {
    expect(FALLBACK_PALETTE.accent).toBe("#B88B2A");
    expect(FALLBACK_PALETTE.accentText).toBe("#070708");
    expect(FALLBACK_PALETTE.glow).toBe("rgba(117, 89, 29, 0.32)");
    expect(FALLBACK_PALETTE.mid).toBe("rgba(110, 84, 28, 0.5)");
    expect(FALLBACK_PALETTE.faded).toBe("rgba(74, 57, 21, 0.94)");
    expect(FALLBACK_PALETTE.tint).toBe("#975706");
  });
});

describe("hueDistance (normalized accents, OKLCH hue)", () => {
  it("compares the painted accents, not raw lightness", () => {
    expect(hueDistance(BLUE_DARK, BLUE_BRIGHT)).toBeLessThan(10);
  });

  it("still reports real hue disagreements", () => {
    expect(hueDistance(RED, BLUE)).toBeGreaterThan(120);
  });

  it("is symmetric and finite even for greys", () => {
    expect(hueDistance(RED, BLUE)).toBe(hueDistance(BLUE, RED));
    expect(hueDistance("#808080", "#7d7d7d")).toBe(0);
  });
});

describe("resolveSwatch (native pixel path)", () => {
  it("transport failure retries once, then memoizes for the session", async () => {
    nativeState.getPixels = vi.fn(async () => {
      throw new Error("net");
    });
    // First visit: fails, NOT memoized (transient network errors must not
    // strand a title on brand gold until relaunch).
    await expect(resolveSwatch("/a.jpg", "w342")).resolves.toBeNull();
    expect(peekSwatch("/a.jpg")).toBeUndefined();
    // Second visit: retries — and the second failure memoizes null.
    await expect(resolveSwatch("/a.jpg", "w342")).resolves.toBeNull();
    expect(nativeState.getPixels).toHaveBeenCalledTimes(2);
    expect(peekSwatch("/a.jpg")).toBeNull();
    // Third visit: memo hit — no further network attempts.
    await expect(resolveSwatch("/a.jpg", "w342")).resolves.toBeNull();
    expect(nativeState.getPixels).toHaveBeenCalledTimes(2);
  });

  it("a resolved-but-unusable buffer (all-grey art) memoizes null immediately", async () => {
    nativeState.getPixels = vi.fn(async () => flatImage("#808080"));
    await expect(resolveSwatch("/grey.jpg", "w342")).resolves.toBeNull();
    expect(peekSwatch("/grey.jpg")).toBeNull();
    await expect(resolveSwatch("/grey.jpg", "w342")).resolves.toBeNull();
    expect(nativeState.getPixels).toHaveBeenCalledTimes(1);
  });

  it("commits a successful extraction and notifies subscribers", async () => {
    nativeState.getPixels = vi.fn(async () => flatImage(BLUE));
    const cb = vi.fn();
    subscribeSwatch("/ok.jpg", cb);
    await expect(resolveSwatch("/ok.jpg", "w342")).resolves.toBe(BLUE);
    expect(peekSwatch("/ok.jpg")).toBe(BLUE);
    expect(cb).toHaveBeenCalledWith(BLUE);
    // Frame URL: size class ≤ w500 maps to the cheap w92 rendition.
    expect(nativeState.getPixels).toHaveBeenCalledWith(
      "https://image.tmdb.org/t/p/w92/ok.jpg",
      64,
    );
  });

  it("a timeout does not strand the late result: subscriber still fires", async () => {
    vi.useFakeTimers();
    try {
      let release!: (v: Uint8Array) => void;
      nativeState.getPixels = vi.fn(
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
      release(flatImage(RED));
      await vi.advanceTimersByTimeAsync(0);
      expect(peekSwatch("/slow.jpg")).toBe(RED);
      expect(cb).toHaveBeenCalledWith(RED);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getSwatchSync (frame-1 probe via native pixel LRU)", () => {
  it("reads peekPixels, picks, and commits into the JS cache", () => {
    nativeState.peekPixels = vi.fn(() => flatImage(BLUE));
    expect(getSwatchSync("/s.jpg", "w342")).toBe(BLUE);
    expect(peekSwatch("/s.jpg")).toBe(BLUE);
    expect(nativeState.peekPixels).toHaveBeenCalledWith(
      "https://image.tmdb.org/t/p/w92/s.jpg",
      64,
    );
    // Second probe is served from the JS cache — no native call.
    expect(getSwatchSync("/s.jpg", "w342")).toBe(BLUE);
    expect(nativeState.peekPixels).toHaveBeenCalledTimes(1);
  });

  it("native miss returns undefined (not a failure — async path may still land)", () => {
    nativeState.peekPixels = vi.fn(() => null);
    expect(getSwatchSync("/m.jpg")).toBeUndefined();
    expect(peekSwatch("/m.jpg")).toBeUndefined();
  });

  it("grey pixels return undefined without memoizing a failure", () => {
    nativeState.peekPixels = vi.fn(() => flatImage("#808080"));
    expect(getSwatchSync("/g.jpg")).toBeUndefined();
    expect(peekSwatch("/g.jpg")).toBeUndefined();
  });
});
