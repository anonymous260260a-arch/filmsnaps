/**
 * accentCore — Accent recipe v10 "Glow+" — VERBATIM port of the CORE block
 * from accent-lab-v10.html (browser lab; spec + source: the approved port
 * spec). TUNE + hand-rolled OKLCH engine + extraction + pick + paint +
 * palette. Do not redesign, re-tune, simplify, or substitute color
 * libraries — bit-exact parity with the lab-approved colors is the gate.
 *
 * v10 "Glow+": saturation is now a FRACTION OF THE DISPLAY GAMUT (not tied
 * to the poster's own dull chroma) → no pastel/milky accents.
 * v9 "Glow": two roles. ACCENT = small bright CTA. WASH = big
 * deep-but-saturated gradient. Bright where it's small, rich where it's
 * large → energetic without glare.
 *
 * NOT ported (per spec): T8 / paintV8 (A/B scaffolding) and the DOM
 * harness. Lab oddities ported as-is and noted in the PR:
 *  - pickAccent scores on `wshare`, never `population`;
 *  - swatchesFromPixels THROWS "no usable pixels" when <50 usable pixels
 *    (a grey field with ≥50 px returns [] instead);
 *  - paintAccent's white side floors at L 0.40, so AA can stay < target
 *    there (readability loop is bounded, never infinite).
 */

export interface Swatch {
  name: string;
  hex: string;
  population: number;
  share: number;
  wshare: number;
}

export type Zone =
  | "red"
  | "coral"
  | "amber"
  | "gold"
  | "green"
  | "cool"
  | "violet";

export interface PaintSuccess {
  accent: string;
  text: string;
  zone: Zone;
  rawL: number;
  rawC: number;
  hue: number;
}

export type PaintResult = PaintSuccess | { fail: string };

/** Ready-to-paint palette (lab shape + additive tint; lab-only `_hex` dropped). */
export interface Palette {
  accent: string;
  accentText: string;
  glow: string;
  mid: string;
  faded: string;
  tint: string;
}

export interface OklchInput {
  mode?: string;
  l: number;
  c: number;
  h?: number;
  a?: number;
  b?: number;
}

export interface OklchColor {
  mode: string;
  l: number;
  c: number;
  h: number;
  a: number;
  b: number;
}

export const TUNE = {
  // v11 "Cinema" — OLED/vivid renders ~15% hotter than the lab monitor.
  // Calibrated so the LAB reads slightly muted and the DEVICE reads
  // cinematic-but-alive. vs v10: CTA chroma 0.90–1.0 → 0.72–0.85 of gamut;
  // washes deeper (L↓, glow/mid alphas↓); white-text-zone anchors pulled
  // down; dark-text-zone anchors untouched (text-side stability).
  anchors: [
    { h: 10, L: 0.6, c: 0.26 },
    { h: 30, L: 0.7, c: 0.23 },
    { h: 55, L: 0.76, c: 0.2 },
    { h: 80, L: 0.84, c: 0.18 },
    { h: 105, L: 0.86, c: 0.19 },
    { h: 135, L: 0.76, c: 0.2 },
    { h: 165, L: 0.74, c: 0.16 },
    { h: 200, L: 0.72, c: 0.16 },
    { h: 240, L: 0.6, c: 0.21 },
    { h: 275, L: 0.57, c: 0.23 },
    { h: 315, L: 0.6, c: 0.24 },
    { h: 350, L: 0.6, c: 0.25 },
  ],
  src: { lPull: 0.35, lMax: 0.05 },
  sat: { lo: 0.72, hi: 0.85, srcFull: 0.1 }, // was 0.90–1.0 — the glare
  comfort: { fromL: 0.75, cap: 0.82, hLo: 90, hHi: 195 }, // cap tracks sat.hi
  whiteBelowL: 0.67,
  aaTarget: 5.0,
  aaFloor: 4.5,
  grey: { minC: 0.02, ratio: 0.22 },
  hist: { bins: 36, minPxC: 0.02, maxCands: 4, minRel: 0.12 },
  pick: {
    skin: { hLo: 25, hHi: 75, cLo: 0.03, cHi: 0.13, lFloor: 0.55, pen: 0.4 },
    mud: { hLo: 70, hHi: 115, lMax: 0.62, cMax: 0.11, pen: 0.45 },
  },
  // v11.1: wash = CTA color at wash lightness. Same hue always;
  // L tracks the CTA's L; gold band handled by chroma cap, not hue shift.
  // glow feeds ONLY the detail-page pool (movie/tv): 0.62 tracked the CTA
  // too literally and lit up the whole detail screen — capped to 0.50,
  // back toward v10/v11's fixed 0.46.
  wash: {
    L: {
      glowMul: 0.74,
      glowLo: 0.4,
      glowHi: 0.5,
      midMul: 0.55,
      midLo: 0.3,
      midHi: 0.5,
      fadedMul: 0.38,
      fadedLo: 0.18,
      fadedHi: 0.36,
      tintMul: 0.55,
      tintLo: 0.4,
      tintHi: 0.52,
    },
    // glow = detail-page pool only; mid = the hero wash glow (home +
    // detail backdrop). Both lowered: pool 0.65→0.45, mid 0.84→0.68.
    // faded stays opaque (1.0) — it's the text-readability floor.
    a: { glow: 0.45, mid: 0.68, faded: 1.0 },
    cFrac: 1.0,
    cCap: 0.2,
    goldCap: 0.13,
    goldLo: 80,
    goldHi: 115,
    fadedCFrac: 0.85,
    gamut: 0.98,
  },
};

export const C = (() => {
  const lin = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const gam = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  function hex2rgb(hex: string) {
    hex = hex.replace("#", "");
    if (hex.length === 3)
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgb2hex(r: number, g: number, b: number) {
    const h = (v: number) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0");
    return "#" + h(r) + h(g) + h(b);
  }
  function rgb2oklab({ r, g, b }: { r: number; g: number; b: number }) {
    const R = lin(r / 255),
      G = lin(g / 255),
      B = lin(b / 255);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return {
      L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    };
  }
  function oklab2lin({ L, a, b }: { L: number; a: number; b: number }) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b,
      m_ = L - 0.1055613458 * a - 0.0638541728 * b,
      s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3,
      m = m_ ** 3,
      s = s_ ** 3;
    return {
      r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    };
  }
  function fromLab({
    L,
    a,
    b,
  }: {
    L: number;
    a: number;
    b: number;
  }): OklchColor {
    const c = Math.sqrt(a * a + b * b);
    let h = c < 1e-6 ? 0 : (Math.atan2(b, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { mode: "oklch", l: L, c, h, a, b };
  }
  const oklchRGB = (r: number, g: number, b: number) =>
    fromLab(rgb2oklab({ r, g, b }));
  const oklch = (hex: string) => fromLab(rgb2oklab(hex2rgb(hex)));
  function clampChroma(col: OklchInput): OklchInput {
    const hr = ((col.h ?? 0) * Math.PI) / 180;
    const ok = (c: number) => {
      const { r, g, b } = oklab2lin({
        L: col.l,
        a: c * Math.cos(hr),
        b: c * Math.sin(hr),
      });
      return (
        r >= -1e-4 &&
        r <= 1.0001 &&
        g >= -1e-4 &&
        g <= 1.0001 &&
        b >= -1e-4 &&
        b <= 1.0001
      );
    };
    if (ok(col.c)) return { ...col };
    let lo = 0,
      hi = col.c;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (ok(m)) lo = m;
      else hi = m;
    }
    return { ...col, c: lo };
  }
  function formatHex(col: OklchInput) {
    const hr = ((col.h ?? 0) * Math.PI) / 180;
    const { r, g, b } = oklab2lin({
      L: col.l,
      a: col.c * Math.cos(hr),
      b: col.c * Math.sin(hr),
    });
    return rgb2hex(gam(r) * 255, gam(g) * 255, gam(b) * 255);
  }
  return {
    hex2rgb,
    rgb2hex,
    rgb2oklab,
    oklab2lin,
    oklch,
    oklchRGB,
    fromLab,
    clampChroma,
    formatHex,
    rgb: hex2rgb,
  };
})();

export const BG = "#070708",
  TEXT_DARK = "#0a0a0b",
  TEXT_LIGHT = "#ffffff";
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
export const cMaxAt = (l: number, h: number) =>
  C.clampChroma({ mode: "oklch", l, c: 0.4, h }).c;
export function contrast(a: string, b: string) {
  const lum = (h: string) => {
    const { r, g, b } = C.rgb(h);
    const f = (v: number) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export const rgba = (hex: string, a: number) => {
  const { r, g, b } = C.rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
export function zoneOf(h: number): Zone {
  return h >= 330 || h < 30
    ? "red"
    : h < 55
      ? "coral"
      : h < 80
        ? "amber"
        : h < 110
          ? "gold"
          : h < 155
            ? "green"
            : h < 260
              ? "cool"
              : "violet";
}
export function isGrey(col: { l: number; c: number; h: number }) {
  return (
    col.c < TUNE.grey.minC || col.c < TUNE.grey.ratio * cMaxAt(col.l, col.h)
  );
}

/* ── extraction: hue-histogram in OKLCH (vivid representative per hue family, no RGB-averaging mud) ── */
export function swatchesFromPixels(
  data: Uint8ClampedArray | Uint8Array | number[],
): Swatch[] {
  const H = TUNE.hist,
    B = H.bins,
    bw = 360 / B,
    W = new Float64Array(B);
  const items: { bi: number; w: number; L: number; a: number; b: number }[] =
    [];
  let used = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    if (data[i + 3] < 200) continue;
    if (r < 18 && g < 18 && b < 18) continue;
    if (r > 238 && g > 238 && b > 238) continue;
    used++;
    const o = C.oklchRGB(r, g, b);
    if (o.c < H.minPxC) continue;
    const w = Math.pow(o.c, 1.5) * (o.l >= 0.3 && o.l <= 0.8 ? 1 : 0.35);
    const bi = Math.floor(o.h / bw) % B;
    W[bi] += w;
    items.push({ bi, w, L: o.l, a: o.a, b: o.b });
  }
  if (used < 50) throw new Error("no usable pixels");
  const totalW = W.reduce((x, y) => x + y, 0);
  const sm = Array.from(
    W,
    (w, i) => w + 0.5 * (W[(i + B - 1) % B] + W[(i + 1) % B]),
  );
  const out: Swatch[] = [];
  let first = 0;
  for (let k = 0; k < H.maxCands; k++) {
    let best = -1,
      bv = 0;
    sm.forEach((v, i) => {
      if (v > bv) {
        bv = v;
        best = i;
      }
    });
    if (best < 0 || (k > 0 && bv < H.minRel * first)) break;
    if (k === 0) first = bv;
    for (let d = -2; d <= 2; d++) sm[(best + d + B) % B] = 0;
    const near = new Set([(best + B - 1) % B, best, (best + 1) % B]);
    let sw = 0,
      sL = 0,
      sa = 0,
      sb = 0,
      n = 0,
      wsum = 0;
    for (const it of items) {
      if (near.has(it.bi)) {
        const w2 = it.w * it.w;
        sw += w2;
        sL += it.L * w2;
        sa += it.a * w2;
        sb += it.b * w2;
        n++;
        wsum += it.w;
      }
    }
    if (!sw) continue;
    const col = C.clampChroma(
      C.fromLab({ L: sL / sw, a: sa / sw, b: sb / sw }),
    );
    out.push({
      name: "h" + (out.length + 1),
      hex: C.formatHex(col),
      population: n,
      share: n / used,
      wshare: wsum / (totalW || 1),
    });
  }
  return out;
}

/* ── pick: vivid + sizeable, avoid skin & olive mud ── */
export function scoreSwatch(s: Swatch) {
  const col = C.oklch(s.hex);
  const { c, h, l } = col;
  let v = Math.sqrt(s.wshare) * Math.pow(c / cMaxAt(l, h), 0.8);
  const k = TUNE.pick.skin,
    m = TUNE.pick.mud;
  if (h >= k.hLo && h <= k.hHi && c >= k.cLo && c <= k.cHi && l >= k.lFloor)
    v *= k.pen;
  if (h >= m.hLo && h <= m.hHi && l <= m.lMax && c <= m.cMax) v *= m.pen;
  return v;
}
export function pickAccent(
  swatches: Swatch[],
): (Swatch & { score: number }) | null {
  let best: (Swatch & { score: number }) | null = null;
  for (const s of swatches) {
    const col = C.oklch(s.hex);
    if (isGrey(col)) continue;
    const score = scoreSwatch(s);
    if (!best || score > best.score) best = { ...s, score };
  }
  return best;
}

/* ── paint: keep hue, pull L/C toward a hue-aware "bright but comfortable" anchor ── */
export function anchorAt(h: number) {
  const A = TUNE.anchors;
  h = ((h % 360) + 360) % 360;
  let i = A.length - 1;
  for (let k = 0; k < A.length; k++) if (A[k].h <= h) i = k;
  const a = A[i],
    b = A[(i + 1) % A.length];
  const span = (b.h - a.h + 360) % 360 || 360;
  const t = ((h - a.h + 360) % 360) / span;
  return { L: a.L + (b.L - a.L) * t, c: a.c + (b.c - a.c) * t };
}
export function paintAccent(rawHex: string): PaintResult {
  const col = C.oklch(rawHex);
  if (isGrey(col)) return { fail: "grey" };
  const h = col.h,
    an = anchorAt(h),
    s = TUNE.src,
    S = TUNE.sat,
    cf = TUNE.comfort;
  let L = an.L + clamp((col.l - an.L) * s.lPull, -s.lMax, s.lMax);
  const satT = S.lo + (S.hi - S.lo) * Math.min(1, col.c / S.srcFull);
  const hexAt = (LL: number) => {
    let f = satT;
    if (LL >= cf.fromL && h >= cf.hLo && h <= cf.hHi) f = Math.min(f, cf.cap);
    return C.formatHex(
      C.clampChroma({ mode: "oklch", l: LL, c: cMaxAt(LL, h) * f, h }),
    );
  };
  const white = L < TUNE.whiteBelowL;
  const text = white ? TEXT_LIGHT : TEXT_DARK;
  const ok = (LL: number, t: number) => contrast(hexAt(LL), text) >= t;
  if (white) {
    L = Math.min(L, TUNE.whiteBelowL - 0.01);
    while (L > 0.4 && !ok(L, TUNE.aaTarget)) L -= 0.01;
  } else {
    while (L < 0.93 && !ok(L, TUNE.aaTarget)) L += 0.01;
  }
  return {
    accent: hexAt(L),
    text,
    zone: zoneOf(h),
    rawL: col.l,
    rawC: col.c,
    hue: h,
  };
}
export function buildPalette(accent: string, text: string): Palette {
  const col = C.oklch(accent),
    W = TUNE.wash;
  const h = col.h; // v11.1: wash keeps the CTA hue exactly — no shift
  const gold = h >= W.goldLo && h <= W.goldHi;
  const cw = Math.min(col.c * W.cFrac, gold ? W.goldCap : W.cCap);
  const mk = (L: number, f = 1) =>
    C.formatHex(
      C.clampChroma({
        mode: "oklch",
        l: L,
        c: Math.min(cw * f, cMaxAt(L, h) * W.gamut),
        h,
      }),
    );
  const d = (m: number, lo: number, hi: number) => clamp(col.l * m, lo, hi);
  const hx = {
    glow: mk(d(W.L.glowMul, W.L.glowLo, W.L.glowHi)),
    mid: mk(d(W.L.midMul, W.L.midLo, W.L.midHi)),
    faded: mk(d(W.L.fadedMul, W.L.fadedLo, W.L.fadedHi), W.fadedCFrac),
    tint: mk(d(W.L.tintMul, W.L.tintLo, W.L.tintHi)),
  };
  return {
    accent,
    accentText: text,
    glow: rgba(hx.glow, W.a.glow),
    mid: rgba(hx.mid, W.a.mid),
    faded: rgba(hx.faded, W.a.faded),
    tint: hx.tint,
  };
}
