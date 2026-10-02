import type { ImageColorsResult } from "react-native-image-colors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import tinycolor from "tinycolor2";
import { oklch, clampChroma, formatHex, formatRgb } from "culori";
import { getImageUrl } from "@filmsnaps/shared";
import { colors } from "../theme/colors";
import { MovieAccent, DECODE_WIDTH } from "../modules/movie-accent";

export type AccentMode = "dark" | "light";

/**
 * The app ships a single dark theme (app.json `userInterfaceStyle: "dark"`),
 * so the dark normalization path below is the live one. The light path exists
 * so switching themes later only flips this constant.
 */
export const APP_COLOR_SCHEME: AccentMode = "dark";

export interface MovieThemePalette {
  /** Solid accent — primary CTA background. */
  accent: string;
  /** WCAG AA text/icon color that sits on `accent`. */
  accentText: string;
  /** Accent blended into the app background — soft wash behind hero content. */
  glow: string;
  /** Accent blended into the app background — mid stop of the cinematic fade. */
  mid: string;
  /** Accent blended into the app background — solid end of the cinematic fade. */
  faded: string;
}

/**
 * Extraction runs on the SAME TMDB variant the biggest surface renders
 * (Hero's w1280). The old w300 sample told a different color story than the
 * image the user was looking at — hero washes visibly disagreed with their
 * own backdrop.
 *
 * This is a SIZE CLASS, not a rendition name: cheapUrlFor maps any class
 * above w500 to the cheap w300 backdrop source (any at-or-below class to
 * w92). The literal "w1280" caused a future-self trap once already — it
 * must never be "fixed" into fetching 200 KB w1280 renditions.
 */
const EXTRACT_SIZE_CLASS = "w1280";

/** A hung extraction must not stall the hero — see `resolveSwatch`. */
const EXTRACT_TIMEOUT_MS = 3000;

const AA_CONTRAST = 4.5;

// ── OKLCH tone recipe (phase 3 — energy, temperature, coverage) ───────────
// Hue is the ONLY thing taken from the artwork — tone/chroma are the app's.
// Hue preservation = mood preservation (horror ≠ romcom). OKLCH is used
// because its L/C axes are perceptually uniform: clamping L produces the
// same visual weight for every hue, unlike HSL where yellow at L 0.5 is
// blinding and blue at L 0.5 is navy.
//
// GATES vs PAINT BAND (separated in phase 3 — they used to be conflated and
// everything painted at the gate floor, which read as dull):
//
// GATE_MIN_C / BROWN_MIN_C / MUD_MIN_C only decide ELIGIBILITY of a swatch
// (strict pass vs relaxed lift vs grey rejection). They never set what
// ships.
//
// The PAINT band is what the CTA actually shows, AFTER the gate, in both
// tiers: chroma clamped to [PAINT_MIN_C, PAINT_MAX_C], relaxed lifts
// straight to PAINT_LIFT_C, and the L band is widened to [0.48, 0.62]
// because the AA SOLVER below (not L clamping) keeps text legal.
const TONE_MIN_L = 0.48;
const TONE_MAX_L = 0.62;
const GATE_MIN_C = 0.09;
const PAINT_MIN_C = 0.12;
const PAINT_MAX_C = 0.19;
const PAINT_LIFT_C = 0.13;
// Brown/skin gate: warm hues (OKLCH H ≈ 15–70°) at low chroma ARE brown —
// #8a5a3c at C .085 is "military mud"'s warm cousin and, because posters are
// full of warm grading and faces, it won constantly ("the app is brown and
// light-red"). Warm hues below 0.11 chroma are rejected in the strict tier
// (so a better-hued swatch can win) and LIFTED in the relaxed tier (so
// warm-graded posters still earn a vivid amber/caramel accent instead of
// no accent at all — the lift preserves the hue, never the mud).
const BROWN_HUE_LO = 15;
const BROWN_HUE_HI = 70;
const BROWN_MIN_C = 0.11;
// Olive/khaki hues (OKLCH H ≈ 75–115°) are the #1 "cheap color" generator:
// at low chroma they read as military mud on a dark UI. Same tier structure
// as the brown gate.
const MUD_HUE_LO = 75;
const MUD_HUE_HI = 115;
const MUD_MIN_C = 0.1;
// Grey gate floor — LIGHTNESS-AWARE (see isGreySwatch below).
const RELAXED_MIN_C = 0.04;
// Second-chance tier: muted-but-hued swatches (≥ RELAXED_MIN_C, lightness-
// aware) are LIFTED into the paint band on their own hue rather than
// dropping the surface to brand gold. True grey (lightness-aware below)
// is never faked — B&W stays neutral.
const RELAXED_LIFT_C = 0.13;

const TEXT_LIGHT = "#ffffff";
const TEXT_DARK = "#070708";

const ANDROID_SWATCHES = [
  "darkVibrant",
  "darkMuted",
  "vibrant",
  "muted",
  "dominant",
  "average",
  "lightVibrant",
  "lightMuted",
] as const;

const IOS_SWATCHES = ["background", "primary", "secondary", "detail"] as const;

const TIMEOUT_SENTINEL = Symbol("movieAccent.extractTimeout");

/**
 * `backdrop_path` → picked raw swatch.
 * `null` is the failure memo: a real rejection is never retried this session.
 * An absent key means "not attempted yet".
 */
const swatchCache = new Map<string, string | null>();

// Cache keys are versioned so changing the extraction recipe (size, pick
// order, clamps) migrates instead of silently serving stale swatches. The
// version prefix also makes keys idempotent under re-entry.
// v5: the paint recipe moved to a separated gate/paint model with an AA
// SOLVER (phase 3 — energy/temperature/coverage). v4 keys come from the
// pre-solver recipe, so they are dropped once and re-extracted onto the
// new baseline — one-time re-extraction.
const SWATCH_KEY_VERSION = "v5";

function extractKey(backdropPath: string): string {
  const base = backdropPath.split("?")[0].trim();
  if (base.startsWith(`${SWATCH_KEY_VERSION}|`)) return base; // already versioned
  return `${SWATCH_KEY_VERSION}|${base}`;
}

/**
 * Synchronous cache probe. Returns `undefined` when nothing is known yet so
 * callers can tell "not fetched" apart from "fetched and failed".
 */
export function peekSwatch(backdropPath: string): string | null | undefined {
  const key = extractKey(backdropPath);
  return swatchCache.has(key) ? swatchCache.get(key)! : undefined;
}

// ── Subscribers ────────────────────────────────────────────────────────────
// A surface that misses the cache can wait here instead of giving up: a
// slow extraction that only lands after the 3s timeout still pushes its
// swatch through `commitSwatch`, which updates every live subscriber.

const swatchListeners = new Map<string, Set<(hex: string) => void>>();

function notifySwatch(path: string, hex: string): void {
  const subs = swatchListeners.get(path);
  if (!subs) return;
  for (const cb of [...subs]) {
    try {
      cb(hex);
    } catch {
      // one bad subscriber must not break the commit
    }
  }
}

/**
 * Fires only on a successful commit. Synchronously replays if the swatch
 * already landed (it can commit between the caller's `peek` and this call).
 */
export function subscribeSwatch(
  backdropPath: string,
  cb: (hex: string) => void,
): () => void {
  const cacheKey = extractKey(backdropPath);
  let subs = swatchListeners.get(cacheKey);
  if (!subs) {
    subs = new Set();
    // Must key the set by the SAME versioned key notifySwatch uses — the
    // pre-fix code stored it under the raw path, so late-commit subscribers
    // never received their swatch (heroes could strand on the fallback).
    swatchListeners.set(cacheKey, subs);
  }
  subs.add(cb);

  const cached = peekSwatch(backdropPath);
  if (typeof cached === "string") cb(cached);

  return () => {
    const live = swatchListeners.get(cacheKey);
    if (!live) return;
    live.delete(cb);
    if (live.size === 0) swatchListeners.delete(cacheKey);
  };
}

// ── Persistence ────────────────────────────────────────────────────────────
// Successes only: a memoized failure is often a transient network miss and
// must not outlive the session.

const PERSIST_KEY = "@movieAccent/v1";
const PERSIST_CAP = 120;
const PERSIST_DEBOUNCE_MS = 2_000;

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let hydratePromise: Promise<void> | undefined;

function persistableSwatches(): Record<string, string> {
  // Insertion order = recency of commit; overflow drops the oldest.
  const entries = [...swatchCache].filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  const kept =
    entries.length > PERSIST_CAP
      ? entries.slice(entries.length - PERSIST_CAP)
      : entries;
  return Object.fromEntries(kept);
}

function flushSwatchPersist(): void {
  persistTimer = undefined;
  void AsyncStorage.setItem(
    PERSIST_KEY,
    JSON.stringify(persistableSwatches()),
  ).catch(() => {});
}

/** Trailing debounce — priming bursts collapse into one write. */
function scheduleSwatchPersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(flushSwatchPersist, PERSIST_DEBOUNCE_MS);
}

/** Every success (including late timeout results) lands here. */
function commitSwatch(cacheKey: string, hex: string): void {
  swatchCache.set(cacheKey, hex);
  transportFailures.delete(cacheKey);
  scheduleSwatchPersist();
  notifySwatch(cacheKey, hex);
}

/**
 * Paths whose extraction failed with a TRANSPORT error (network/decode
 * rejection) once this session. Phase 3: a transport failure is NO LONGER
 * memoized as "no swatch" — one flaky-network moment on first view used to
 * strand a title on brand gold until relaunch. First failure: not memoized
 * (the next visit retries). Second failure for the same path: memo null and
 * stop looping. Resolved-but-unusable bags (genuinely grey art) still memo
 * null immediately — that is a real answer, not an error.
 */
const transportFailures = new Set<string>();

/**
 * Insert persisted swatches into the memory cache. Idempotent, never
 * rejects. Subscribers waiting on a path get the restored value too.
 */
export function hydrateAccentCache(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = AsyncStorage.getItem(PERSIST_KEY)
      .then((raw) => {
        if (!raw) return;
        const stored = JSON.parse(raw) as Record<string, unknown>;
        for (const storedKey of Object.keys(stored)) {
          const hex = stored[storedKey];
          if (typeof hex !== "string") continue;
          // Only entries in the CURRENT format hydrate. Older versions
          // (v1 raw paths, v2 large-image swatches, v3 preference-walk
          // swatches, v4 pre-AA-solver paints) are dropped — the new
          // engine re-extracts them once onto the current baseline.
          if (!storedKey.startsWith(`${SWATCH_KEY_VERSION}|`)) continue;
          if (swatchCache.has(storedKey)) continue;
          swatchCache.set(storedKey, hex);
          notifySwatch(storedKey, hex);
        }
      })
      .catch(() => {});
  }
  return hydratePromise;
}

// ── Home-wide accent (Hero-tinted home) ──────────────────────────────────
// The Hero owns the accent; the rest of home (section headings, See-All
// links, hairlines, the ambient glow) paints from the SAME palette so every
// surface always agrees. Components subscribe here instead of extracting —
// one image decode, one source of truth, no drift between rows.

let homeAccentPalette: MovieThemePalette | null = null;
const homeAccentListeners = new Set<(p: MovieThemePalette | null) => void>();

/** Hero-only: publish the live hero palette (or null while neutral). */
export function setHomeAccent(palette: MovieThemePalette | null): void {
  if (homeAccentPalette === palette) return;
  homeAccentPalette = palette;
  for (const cb of [...homeAccentListeners]) {
    try {
      cb(palette);
    } catch {
      // one bad subscriber must not break the publish
    }
  }
}

/** Sync probe so late-mounting decor starts already tinted (no first-frame flash). */
export function peekHomeAccent(): MovieThemePalette | null {
  return homeAccentPalette;
}

/**
 * Rows/decor: follow the hero accent. Calls back synchronously with the
 * current palette, then on every hero commit.
 */
export function subscribeHomeAccent(
  cb: (p: MovieThemePalette | null) => void,
): () => void {
  homeAccentListeners.add(cb);
  cb(homeAccentPalette);
  return () => {
    homeAccentListeners.delete(cb);
  };
}

type TrendingQueryClientLike = {
  getQueryData: (key: readonly unknown[]) => unknown;
};

/**
 * First-launch warm: while the LegalGate still holds the UI, extract the
 * trending hero pick's swatch so the FIRST hero ever painted already
 * carries its accent — the user never sees a brand-gold → accent
 * transition on a cold app start. On warm boots this is a near-no-op
 * (hydrate + cache peek). Best-effort; never throws.
 */
export async function warmHeroAccent(
  queryClient: TrendingQueryClientLike,
): Promise<void> {
  try {
    const data = queryClient.getQueryData(["movies", "trending"]) as
      | { results?: Array<{ backdrop_path?: string | null }> }
      | undefined;
    const hero =
      data?.results?.find((r) => r.backdrop_path) ?? data?.results?.[0];
    const path = hero?.backdrop_path;
    if (path) await resolveSwatch(path);
  } catch {
    // best-effort warm
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Max chroma sRGB can hold at a given (L, H) — computed by PROBE, not
 * analytically: clampChroma a high-chroma probe and read back what fits.
 * This is the yardstick for both the vividness score and the lightness-
 * aware grey gate (dark corners of OKLCH simply cannot hold much chroma —
 * a genuinely blue dark poster swatch must not be misread as grey there).
 */
function cMax(l: number, h: number): number {
  const probe = clampChroma({ mode: "oklch", l, c: 0.4, h }, "oklch");
  return probe?.c ?? 0;
}

/**
 * LIGHTNESS-AWARE grey gate: reject as "grey" only when the chroma is low
 * AND low relative to what sRGB could hold at this lightness/hue
 * (C < 0.04 AND C < 0.30 × cMax(L, H)). A flat C < 0.04 cut misclassified
 * dark cool posters (low-L navy/teal swatches live at C ≈ 0.03 where the
 * gamut itself is tiny) as grey and stranded them on brand gold; true B&W
 * (C ≈ 0.01, far under both bounds) still falls back.
 */
function isGreySwatch(l: number, c: number, h: number): boolean {
  return c < RELAXED_MIN_C && c < 0.3 * cMax(l, h);
}

/**
 * GAMUT-AWARE (L, C) solve: clampChroma at high L steals chroma from cool
 * hues (at L 0.6 blue caps out around C 0.13 while warm hues hold 0.19),
 * which silently painted cool accents duller than warm ones. When the
 * wanted chroma doesn't fit at the band lightness, walk L DOWN in 0.02
 * steps (floor 0.45) until it does; if it never fits, keep the (L, C)
 * with the max achievable chroma. Cool accents trade a little lightness
 * for FULL chroma — no more cool-dulling.
 */
function gamutFit(l: number, c: number, h: number): { l: number; c: number } {
  let cur = clamp(l, 0.45, 1);
  while (cur >= 0.45) {
    const fitted = clampChroma({ mode: "oklch", l: cur, c, h }, "oklch");
    if (fitted && (fitted.c ?? 0) >= c - 1e-4) {
      return { l: cur, c };
    }
    if (fitted && cur === 0.45) {
      // Bottom of the walk — take the best the gamut can hold.
      return { l: cur, c: fitted.c ?? c };
    }
    cur = Math.round((cur - 0.02) * 1000) / 1000;
  }
  const fitted = clampChroma({ mode: "oklch", l: 0.45, c, h }, "oklch");
  return { l: 0.45, c: fitted?.c ?? c };
}

/**
 * Pull an accent out of a raw swatch in OKLCH. HUE IS PRESERVED EXACTLY
 * from the seed (mood lives in hue).
 *
 * Phase 3 separation — GATES decide eligibility, the PAINT band decides
 * what ships (they used to be conflated, so everything painted at the gate
 * floor and read dull):
 *  - gates: grey (lightness-aware), brown (warm C < 0.11), mud (olive
 *    C < 0.10) — unchanged in role from phase 2;
 *  - strict tier: an eligible swatch paints at clamp(c, PAINT_MIN_C,
 *    PAINT_MAX_C) — a C 0.095 swatch no longer ships at 0.095;
 *  - relaxed tier: a muted-but-hued swatch (grey-gate survivor) LIFTS
 *    straight to PAINT_LIFT_C on its own hue — muted art still tells a
 *    color story, and fabricating chroma is what guarantees the CTA never
 *    ships the muted value that read as dull/brown.
 * The gamut solve then fits (L, C) into sRGB without stealing chroma.
 */
function normalizeAccent(
  hex: string,
  mode: AccentMode,
  relaxed = false,
): string | null {
  const color = oklch(hex);
  if (!color || color.l == null) return null;

  if (mode === "dark") {
    const hue = color.h ?? 0;
    const seedL = color.l;
    const seedC = color.c ?? 0;

    // Grey gate (lightness-aware) — true grey is never faked into color;
    // B&W posters stay on brand gold. Applies in BOTH tiers.
    if (isGreySwatch(seedL, seedC, hue)) return null;

    // Hue-family chroma minimums: warm (brown/skin) and olive hues at low
    // chroma ARE mud — the #1 "the app is brown" generator.
    const hueMinC =
      hue >= BROWN_HUE_LO && hue <= BROWN_HUE_HI
        ? BROWN_MIN_C
        : hue >= MUD_HUE_LO && hue <= MUD_HUE_HI
          ? MUD_MIN_C
          : 0;
    if (seedC < Math.max(GATE_MIN_C, hueMinC)) {
      // GATE: strict rejects (a better-hued swatch may win the scoring
      // pass); relaxed LIFTS the muted-but-hued survivor into the paint
      // band so muted/warm posters still get an accent instead of brand
      // gold ("the accent is not working" from phase 2).
      if (!relaxed) return null;
    }

    // PAINT BAND — what ships, in BOTH tiers, regardless of the seed's
    // chroma. Nothing paints at the gate floor any more.
    const paintC = relaxed
      ? PAINT_LIFT_C
      : clamp(Math.max(seedC, PAINT_MIN_C), PAINT_MIN_C, PAINT_MAX_C);
    const fitted = gamutFit(clamp(seedL, TONE_MIN_L, TONE_MAX_L), paintC, hue);
    const clamped = clampChroma(
      { mode: "oklch", l: fitted.l, c: fitted.c, h: hue },
      "oklch",
    );
    return clamped ? (formatHex(clamped) ?? null) : null;
  }

  // Light-mode path (dormant — see APP_COLOR_SCHEME): same hue preservation,
  // slightly deeper paint band so accents hold weight on white.
  const fitted = gamutFit(clamp(color.l, 0.42, 0.52), 0.14, color.h ?? 0);
  const clamped = clampChroma(
    { mode: "oklch", l: fitted.l, c: fitted.c, h: color.h ?? 0 },
    "oklch",
  );
  return clamped ? (formatHex(clamped) ?? null) : null;
}

/**
 * Hue zone → text side. The pairing policy is HUE-AWARE because the
 * perceptual failure modes are asymmetric: light red reads cosmetic/salmon
 * (nobody ships black-on-red CTAs — YouTube/Netflix are white-on-red;
 * Netflix red passes white text at 4.77:1), while light amber looks rich
 * and REQUIRES near-black text. Zones:
 *  - red (H 330–360 ∪ 0–40, wrapping): white text, ALWAYS — deep blood
 *    red, never salmon. Never take the dark-text side for a red hue even
 *    when it is "closer" in L.
 *  - luminous (H 40–150, orange→amber→yellow→lime→green): near-black text.
 *  - cool (H 150–330, teal→blue→purple→magenta): white text (passes easily).
 * Boundaries are starting values — if a gold ever flips to white text the
 * H-40 boundary is too low (nudge to 45).
 */
function textSideFor(hue: number): "white" | "dark" {
  if (hue >= 330 || hue <= 40) return "white"; // red zone (wraps)
  if (hue <= 150) return "dark"; // luminous: amber→green
  return "white"; // cool: teal→blue→purple→magenta
}

/** White-side taste target — pulls reds a touch deeper than the 4.5 floor.
 *  The legal AA minimum (4.5) still applies when the band can't reach 5.0.
 *  If deep reds ever read maroon/brown, relax this to 4.7 first. */
const AA_TASTE_TARGET = 5.0;
/** Red-zone whites may solve DEEPER than the band floor — deep is correct
 *  for red; the paint band's 0.48 floor is not a hard stop there. */
const RED_ZONE_FLOOR_L = 0.44;
/** Luminous-zone dark text may solve brighter than the band cap (rare). */
const DARK_EXTEND_MAX_L = 0.72;

/**
 * AA SOLVER v2 (hue-aware). The v1 solver searched BOTH text sides and
 * picked the solution closest to L 0.56 — a hue-blind tie-break that, for
 * red, could land on the dark-text side and ship LIGHT red (salmon): red's
 * WCAG luminance is low, so both sides are in-band and distance votes
 * wrong. v2: the side is POLICY (textSideFor), never distance. Only L ever
 * moves (hue + chroma FIXED — chroma is never reduced for contrast), and
 * only when the policy pairing fails at the painted value:
 *  - white side: push to the 5.0 taste target (brightest passing L at or
 *    below the painted one); legal floor 4.5 when 5.0 is unreachable; red
 *    zone may solve down to 0.44; near-neon extends further in 0.02 steps.
 *  - dark side: solve upward to the darkest L that reaches 4.5 with
 *    near-black text (keeps golds/greens rich instead of pastel).
 * clampChroma re-runs at every L move so the result stays in sRGB.
 */
function aaSolver(accent: string): { accent: string; text: string } {
  const o = oklch(accent);
  if (!o) {
    return { accent, text: TEXT_LIGHT };
  }
  const hue = o.h ?? 0;
  const chroma = o.c ?? 0;
  const l = o.l;

  const hexAt = (target: number): string => {
    const fitted = clampChroma(
      { mode: "oklch", l: target, c: chroma, h: hue },
      "oklch",
    );
    return (
      formatHex(fitted ?? { mode: "oklch", l: target, c: chroma, h: hue }) ??
      accent
    );
  };

  if (textSideFor(hue) === "white") {
    const redZone = hue >= 330 || hue <= 40;
    const loBound = redZone ? RED_ZONE_FLOOR_L : TONE_MIN_L;
    if (tinycolor.readability(accent, TEXT_LIGHT) >= AA_TASTE_TARGET) {
      return { accent, text: TEXT_LIGHT }; // already at/above taste — keep
    }
    // Brightest L at-or-below the painted value reaching the taste target
    // (contrast vs white rises as L falls). Falls back to the 4.5 floor.
    const solve = (target: number): number | null => {
      if (tinycolor.readability(hexAt(loBound), TEXT_LIGHT) < target)
        return null;
      let lo = loBound; // passes
      let hi = l; // fails (accent itself was below target)
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (tinycolor.readability(hexAt(mid), TEXT_LIGHT) >= target) {
          lo = mid; // passes → try brighter
        } else {
          hi = mid; // fails → go darker
        }
      }
      return lo;
    };
    const deep = solve(AA_TASTE_TARGET) ?? solve(AA_CONTRAST);
    if (deep != null) return { accent: hexAt(deep), text: TEXT_LIGHT };
    // Even the floor L misses the legal minimum (near-neon) — extend down.
    for (
      let cur = Math.round((loBound - 0.02) * 1000) / 1000;
      cur >= 0.3;
      cur = Math.round((cur - 0.02) * 1000) / 1000
    ) {
      const probe = hexAt(cur);
      if (tinycolor.readability(probe, TEXT_LIGHT) >= AA_CONTRAST) {
        return { accent: probe, text: TEXT_LIGHT };
      }
    }
    return { accent, text: TEXT_LIGHT };
  }

  // Luminous zone: near-black text; contrast vs dark RISES with L.
  if (tinycolor.readability(accent, TEXT_DARK) >= AA_CONTRAST) {
    return { accent, text: TEXT_DARK }; // keep the painted value
  }
  // Darkest L at-or-above the painted value reaching 4.5 (solve upward —
  // minimal move, keeps the gold as deep as readability allows).
  if (
    tinycolor.readability(hexAt(DARK_EXTEND_MAX_L), TEXT_DARK) >= AA_CONTRAST
  ) {
    let lo = l; // fails
    let hi = DARK_EXTEND_MAX_L; // passes
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      if (tinycolor.readability(hexAt(mid), TEXT_DARK) >= AA_CONTRAST) {
        hi = mid; // passes → try darker
      } else {
        lo = mid; // fails → go brighter
      }
    }
    return { accent: hexAt(hi), text: TEXT_DARK };
  }
  return { accent, text: TEXT_DARK };
}

function derivePalette(
  accent: string,
  text: string,
  background: string,
): MovieThemePalette {
  return {
    accent,
    accentText: text,
    // Wash shares are tuned against the richer accent band: a brighter
    // accent needs a smaller mix share to hit the same visual weight,
    // otherwise pages glow like a highlighter instead of a cinema.
    glow: tinycolor.mix(accent, background, 38).setAlpha(0.32).toRgbString(),
    mid: tinycolor.mix(accent, background, 42).setAlpha(0.5).toRgbString(),
    faded: tinycolor.mix(accent, background, 62).setAlpha(0.94).toRgbString(),
  };
}

/**
 * The dim brand color, used whenever there is no backdrop or extraction fails.
 * Pre-computed (not normalized) so a failed page looks exactly like the app
 * does today.
 */
export const FALLBACK_PALETTE: MovieThemePalette = derivePalette(
  colors.goldDim,
  colors.bg,
  colors.bg,
);

/** Turn a raw swatch into a ready-to-paint palette, or null if unusable. */
export function buildPalette(
  swatch: string,
  mode: AccentMode = APP_COLOR_SCHEME,
): MovieThemePalette | null {
  // Strict gate first, then the relaxed tier (lift). The hook paints
  // whatever swatch the extractor committed — including a relaxed pick —
  // so the relaxed acceptance must be reachable here too, otherwise
  // muted posters would extract fine and still paint brand gold.
  const normalized =
    normalizeAccent(swatch, mode) ?? normalizeAccent(swatch, mode, true);
  if (!normalized) return null;
  const { accent, text } = aaSolver(normalized);
  return derivePalette(accent, text, mode === "dark" ? colors.bg : "#ffffff");
}

/**
 * VIVIDNESS (phase 3 scoring) — chroma RELATIVE to the sRGB maximum at the
 * swatch's own (L, H). HSL saturation overrates warm hues (sRGB gives them
 * higher HSL-s at equal OKLCH chroma), which biased every pick warm;
 * vividness is perceptually fair across the hue wheel.
 */
function vividness(l: number, c: number, h: number): number {
  const cap = cMax(l, h);
  return cap > 0 ? c / cap : 0;
}

/**
 * Skin/beige penalty in OKLCH — movie art is full of faces, and skin tones
 * are the #1 "beige app" failure mode. The old HSL box (h 15–45°, s 0.2–
 * 0.5) missed graded-orange skin at s 0.5–0.8 — exactly what modern
 * posters are full of — so faces escaped the penalty and won on population.
 * The OKLCH box (h 25–80°, C 0.03–0.14) catches them. Penalty, NEVER a
 * gate: a warm poster with nothing else still earns its warm accent (hue
 * preservation is the contract).
 */
export function skinPenalty(hex: string): number {
  const o = oklch(hex);
  if (!o) return 1;
  const h = o.h ?? 0;
  const c = o.c ?? 0;
  return h >= 25 && h <= 80 && c >= 0.03 && c <= 0.14 ? 0.4 : 1;
}

/**
 * score = vividness × √population × skin-penalty.
 * √population (phase 3): linear population let a big amber sky beat a vivid
 * teal sliver every time; the square root keeps population meaningful while
 * letting a genuinely vivid sliver win.
 */
function swatchScore(hex: string, population: number): number {
  const o = oklch(hex);
  if (!o) return 0;
  const v = vividness(o.l, o.c ?? 0, o.h ?? 0);
  return v * Math.sqrt(Math.max(population, 0)) * skinPenalty(hex);
}

function usableSwatch(
  value: unknown,
): value is string | { hex: string; population?: number } {
  // Accepts BOTH native shapes: plain hex strings (react-native-image-colors
  // fallback) and v4 { hex, population } objects from the native module.
  if (typeof value === "string") {
    return value.length >= 4 && tinycolor(value).isValid();
  }
  if (value && typeof value === "object") {
    const hex = (value as { hex?: unknown }).hex;
    return (
      typeof hex === "string" && hex.length >= 4 && tinycolor(hex).isValid()
    );
  }
  return false;
}

/** Normalize a bag entry to its raw hex regardless of native shape. */
function swatchHex(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const hex = (value as { hex?: unknown }).hex;
    if (typeof hex === "string") return hex;
  }
  return null;
}

/** Native bags carry a pixel-share population; string bags don't. */
function swatchPopulation(value: unknown): number {
  if (value && typeof value === "object") {
    const p = (value as { population?: unknown }).population;
    if (typeof p === "number" && p > 0) return p;
  }
  return 1; // fallback engine: every candidate weighs the same
}

interface BagPick {
  hex: string;
  tier: "strict" | "relaxed";
}

/**
 * Population-weighted pick from a swatch bag.
 *
 * When the bag carries populations (native v4 engine), candidates are scored
 * vividness × √population × skin-penalty (OKLCH — see swatchScore) and the
 * best-scoring ACCENT wins — a tiny but vivid sliver can beat a large dull
 * field, while a big beige face is penalized. When no populations exist (fallback engine),
 * the original preference-order walk is kept verbatim: it IS the tuned
 * behavior for that engine and inventing weights there would be a guess.
 *
 * Both paths share the gate: strict pass first, then one relaxed pass
 * (strict-first so a strict candidate always beats a relaxed one).
 */
function pickFromBag(
  order: readonly string[],
  bag: Record<string, unknown>,
): BagPick | null {
  // Pass 1 — strict tier.
  let best: { hex: string; score: number } | null = null;
  for (const key of order) {
    const value = bag[key];
    if (!usableSwatch(value)) continue;
    const hex = swatchHex(value) ?? "";
    if (!normalizeAccent(hex, APP_COLOR_SCHEME)) continue;
    const score = swatchScore(hex, swatchPopulation(value));
    if (!best || score > best.score) best = { hex, score };
  }
  if (best) return { hex: best.hex, tier: "strict" };

  // Pass 2 — relaxed tier (near-neutrals tint).
  for (const key of order) {
    const value = bag[key];
    if (!usableSwatch(value)) continue;
    const hex = swatchHex(value) ?? "";
    if (normalizeAccent(hex, APP_COLOR_SCHEME, true)) {
      return { hex, tier: "relaxed" };
    }
  }
  return null;
}

export function pickAccentSwatch(result: ImageColorsResult): string | null {
  const order = result.platform === "ios" ? IOS_SWATCHES : ANDROID_SWATCHES;
  return (
    pickFromBag(order, result as unknown as Record<string, unknown>)?.hex ??
    null
  );
}

/** Native-engine variant: the module returns the Android swatch bag only. */
export function pickFromSwatchBag(
  bag: Record<string, unknown> | null | undefined,
): string | null {
  if (!bag) return null;
  return pickFromBag(ANDROID_SWATCHES, bag)?.hex ?? null;
}

export interface AccentPickMeta {
  hex: string;
  /** Which named swatch won ("darkVibrant", "vibrant", …). */
  name: string;
  /** Which tier accepted it. */
  tier: "strict" | "relaxed";
  /** score = vividness × √population × skin-penalty (population defaults 1). */
  score?: number;
}

/**
 * Diagnostics twin of `pickFromSwatchBag` (dev Accent Lab): the same walk,
 * but reports WHO won and WHY. Not used by production rendering.
 * `opts.relaxed === false` simulates a strict-only build (lab toggle).
 */
export function pickAccentWithMeta(
  bag: Record<string, unknown> | null | undefined,
  opts?: { relaxed?: boolean },
): AccentPickMeta | null {
  if (!bag) return null;
  const allowRelaxed = opts?.relaxed !== false;

  // Pass 1 — strict (population-weighted).
  let best: { key: string; hex: string; score: number } | null = null;
  for (const key of ANDROID_SWATCHES) {
    const value = bag[key];
    if (!usableSwatch(value)) continue;
    const hex = swatchHex(value) ?? "";
    if (!normalizeAccent(hex, APP_COLOR_SCHEME)) continue;
    const score = swatchScore(hex, swatchPopulation(value));
    if (!best || score > best.score) best = { key, hex, score };
  }
  if (best) {
    return { hex: best.hex, name: best.key, tier: "strict", score: best.score };
  }
  if (!allowRelaxed) return null;

  // Pass 2 — relaxed (preference order, as production).
  for (const key of ANDROID_SWATCHES) {
    const value = bag[key];
    if (!usableSwatch(value)) continue;
    const hex = swatchHex(value) ?? "";
    if (normalizeAccent(hex, APP_COLOR_SCHEME, true)) {
      const population = swatchPopulation(value);
      return {
        hex,
        name: key,
        tier: "relaxed",
        score: population > 1 ? swatchScore(hex, population) : undefined,
      };
    }
  }
  return null;
}

/**
 * Which quality gates would engage for a raw swatch (dev Accent Lab labels).
 * Purely descriptive — production behavior lives in normalizeAccent.
 */
export function accentGateLabels(hex: string): string[] {
  const color = oklch(hex);
  if (!color || color.l == null) return ["invalid"];
  const labels: string[] = [];
  const c = color.c ?? 0;
  const l = color.l;
  const hue = color.h ?? 0;
  if (isGreySwatch(l, c, hue)) {
    labels.push("grey gate");
    return labels;
  }
  const hueMinC =
    hue >= BROWN_HUE_LO && hue <= BROWN_HUE_HI
      ? BROWN_MIN_C
      : hue >= MUD_HUE_LO && hue <= MUD_HUE_HI
        ? MUD_MIN_C
        : 0;
  if (c < Math.max(GATE_MIN_C, hueMinC)) labels.push("relaxed lift");
  if (hue >= BROWN_HUE_LO && hue <= BROWN_HUE_HI && c < BROWN_MIN_C) {
    labels.push("brown gate");
  }
  if (hue >= MUD_HUE_LO && hue <= MUD_HUE_HI && c < MUD_MIN_C) {
    labels.push("mud gate");
  }
  // OKLCH skin box (h 25–80°, C 0.03–0.14) — matches the scoring penalty.
  if (hue >= 25 && hue <= 80 && c >= 0.03 && c <= 0.14) labels.push("skin-box");
  if (labels.length === 0) labels.push("strict pass");
  return labels;
}

type ImageColorsModule = {
  getColors: (
    uri: string,
    config?: Record<string, unknown>,
  ) => Promise<ImageColorsResult>;
};

/**
 * Loaded lazily: the package resolves its native binding at import time, so a
 * missing binding must not take the whole bundle down with it.
 */
let imageColorsModule: ImageColorsModule | null | undefined;

async function loadImageColors(): Promise<ImageColorsModule | null> {
  if (imageColorsModule !== undefined) return imageColorsModule;
  try {
    const loaded = (await import("react-native-image-colors")) as unknown as {
      default?: ImageColorsModule;
    } & ImageColorsModule;
    imageColorsModule = loaded.default ?? loaded;
  } catch {
    imageColorsModule = null;
  }
  return imageColorsModule;
}

/**
 * Perceptual hue distance (0–180°) between two colors, measured on their
 * NORMALIZED accents — the CTA tone each would paint — not on raw swatches.
 * Raw swatches of the same artwork can sit far apart in lightness/chroma
 * (a dark poster face vs a bright sky) while painting the same CTA hue;
 * comparing the painted accents is what "same color story" actually means.
 * Used to decide whether a late backdrop swatch should REPLACE an
 * already-painted poster-derived accent (< 60° = keep the painted one, no
 * shift) — part of the "user should never see color changing" contract.
 */
export function hueDistance(hexA: string, hexB: string): number {
  const norm = (hex: string): string | null => {
    const h =
      normalizeAccent(hex, APP_COLOR_SCHEME) ??
      normalizeAccent(hex, APP_COLOR_SCHEME, true);
    return h;
  };
  const a = norm(hexA) ?? hexA;
  const b = norm(hexB) ?? hexB;
  const ha = tinycolor(a).toHsl().h;
  const hb = tinycolor(b).toHsl().h;
  const d = Math.abs(ha - hb) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Extraction source URL. Accent needs ~64px of pixels, so fetch the smallest
 * TMDB rendition instead of what the screen renders (w92 poster ≈ 3 KB,
 * w300 backdrop ≈ 15 KB vs w342 ≈ 25 KB / w1280 ≈ 200 KB) — network bytes
 * were the dominant latency, not the palette step.
 */
function cheapUrlFor(path: string, size: string): string {
  const numeric = parseInt(size.replace(/\D/g, ""), 10) || 1280;
  const src = numeric <= 500 ? "w92" : "w300";
  return `https://image.tmdb.org/t/p/${src}/${path.replace(/^\//, "")}`;
}

/** Native engine present (dev-client built with modules/movie-accent). */
const nativeEngine = MovieAccent;

/**
 * Fetch the accent swatch for a poster/backdrop path. Never throws.
 *
 * - Engine: the MovieAccent native module (off-JS-thread OkHttp + Palette,
 *   3 KB/15 KB sources) when present; react-native-image-colors otherwise
 *   (old dev-clients / iOS / Expo Go).
 * - Timed-out requests are NOT memoized: the work continues in the background
 *   and a late success commits through `commitSwatch` — warming the cache for
 *   the next visit AND live-updating any subscriber still waiting on it.
 * - TRANSPORT rejections (network/decode) are not memoized on first failure
 *   — the next visit retries (extraction is cheap; failures are usually
 *   transient). A second failure for the same path memoizes null for the
 *   session. Unusable RESOLVED results (genuinely grey art) memo null
 *   immediately — that is a real answer.
 */
export async function resolveSwatch(
  backdropPath: string,
  size: string = EXTRACT_SIZE_CLASS,
): Promise<string | null> {
  // Persisted swatches land asynchronously at boot. Awaiting the (idempotent,
  // already in-flight) hydration before the cache probe means a warm entry is
  // returned directly — no re-extraction, no gold-then-accent flash on a
  // backdrop the app already knows.
  await hydrateAccentCache();

  const cacheKey = extractKey(backdropPath);
  const cached = peekSwatch(cacheKey);
  if (cached !== undefined) return cached;

  if (nativeEngine) {
    const url = cheapUrlFor(backdropPath, size);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), EXTRACT_TIMEOUT_MS);
    });
    try {
      const outcome = await Promise.race([
        nativeEngine.getSwatches(url, DECODE_WIDTH),
        timeout,
      ]);
      if (timer) clearTimeout(timer);
      if (outcome === TIMEOUT_SENTINEL) {
        // Late commit still lands (see commitSwatch) — never memoized.
        nativeEngine
          .getSwatches(url, DECODE_WIDTH)
          .then((late) => {
            const lateSwatch = late ? pickFromSwatchBag(late) : null;
            if (lateSwatch) commitSwatch(cacheKey, lateSwatch);
            else swatchCache.set(cacheKey, null);
          })
          .catch(() => swatchCache.set(cacheKey, null));
        return null;
      }
      const swatch = outcome ? pickFromSwatchBag(outcome) : null;
      if (swatch) commitSwatch(cacheKey, swatch);
      else swatchCache.set(cacheKey, null); // engine ran and found nothing usable
      return swatch;
    } catch {
      if (timer) clearTimeout(timer);
      // Transport failure — retry on the NEXT visit (see transportFailures).
      if (transportFailures.has(cacheKey)) {
        swatchCache.set(cacheKey, null); // second failure: stop looping
      } else {
        transportFailures.add(cacheKey);
      }
      return null;
    }
  }

  const imageColors = await loadImageColors();
  if (!imageColors) {
    swatchCache.set(cacheKey, null);
    return null;
  }

  let request: Promise<ImageColorsResult>;
  try {
    request = imageColors.getColors(getImageUrl(backdropPath, size), {
      cache: true,
      key: cacheKey,
      fallback: "#000000",
      pixelSpacing: 8,
      quality: "low",
    });
  } catch {
    swatchCache.set(cacheKey, null);
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), EXTRACT_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([request, timeout]);
    if (timer) clearTimeout(timer);

    if (outcome === TIMEOUT_SENTINEL) {
      request.then(
        (late) => {
          const lateSwatch = pickAccentSwatch(late);
          if (lateSwatch) commitSwatch(cacheKey, lateSwatch);
          else swatchCache.set(cacheKey, null);
        },
        () => swatchCache.set(cacheKey, null),
      );
      return null;
    }

    const swatch = pickAccentSwatch(outcome);
    if (swatch) commitSwatch(cacheKey, swatch);
    else swatchCache.set(cacheKey, swatch);
    return swatch;
  } catch {
    if (timer) clearTimeout(timer);
    // Transport failure — retry on the NEXT visit (see transportFailures).
    if (transportFailures.has(cacheKey)) {
      swatchCache.set(cacheKey, null); // second failure: stop looping
    } else {
      transportFailures.add(cacheKey);
    }
    return null;
  }
}

/**
 * Synchronous fast path: memory cache first, then the native module's LRU
 * (which survives Metro reloads — the native process keeps its cache when
 * the JS bundle restarts). Commits a native hit into the JS cache so later
 * probes stay synchronous. undefined when neither knows the path.
 */
export function getSwatchSync(
  backdropPath: string,
  size: string = EXTRACT_SIZE_CLASS,
): string | null | undefined {
  if (!backdropPath) return undefined;
  const cached = peekSwatch(backdropPath);
  if (cached !== undefined) return cached;
  if (!nativeEngine) return undefined;
  try {
    const bag = nativeEngine.peekSwatches(
      cheapUrlFor(backdropPath, size),
      DECODE_WIDTH,
    );
    if (!bag) return undefined;
    const hex = pickFromSwatchBag(bag);
    if (hex) {
      commitSwatch(extractKey(backdropPath), hex);
      return hex;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Prefetch swatches for a batch of list items — call from
 * onViewableItemsChanged (and keep onPressIn warming as the safety net).
 * Fire-and-forget, never throws; each resolve still commits + notifies so
 * any waiting surface picks the result up. Extraction uses the cheap w92 /
 * w300 renditions, so warming 20 rows is a few hundred KB total.
 */
export function warmSwatches(
  items: { poster_path?: string | null; backdrop_path?: string | null }[],
): void {
  for (const item of items) {
    if (item.poster_path) void resolveSwatch(item.poster_path, "w342");
    if (item.backdrop_path) void resolveSwatch(item.backdrop_path);
  }
}

/** Bench/test helper: drop the in-memory cache and native LRU. */
export function clearSwatchCache(): void {
  swatchCache.clear();
  transportFailures.clear();
  try {
    nativeEngine?.clear();
  } catch {
    // native side best-effort
  }
}

/** Dev/lab helper: sRGB rgba() string for an accent at a given alpha. */
export function accentWithAlpha(hex: string, alpha: number): string {
  const rgb = formatRgb(oklch(hex) ?? hex);
  if (!rgb) return hex;
  // formatRgb → "rgb(r g b / a)"; rebuild with the requested alpha.
  const m = rgb.match(/rgba?\(([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (!m) return hex;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
}
