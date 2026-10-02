import type { ImageColorsResult } from "react-native-image-colors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getImageUrl } from "@filmsnaps/shared";
import { colors } from "../theme/colors";
import { MovieAccent, DECODE_WIDTH } from "../modules/movie-accent";
import {
  C,
  buildPalette as buildPaletteCore,
  paintAccent,
  pickAccent,
  swatchesFromPixels,
  type Swatch,
} from "./accentCore";

export type AccentMode = "dark" | "light";

/**
 * The app ships a single dark theme (app.json `userInterfaceStyle: "dark"`).
 * The light argument exists so switching themes later only flips this
 * constant — v10's recipe (lib/accentCore.ts) is dark-only, as the lab was.
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
  /**
   * v10 hero tint — the accent color laid over the backdrop image (bottom
   * weighted, transparent at the top). Rendered as a PLAIN alpha layer by
   * `components/HeroTint.tsx`, NOT a mixBlendMode multiply: the blend path
   * forced the image into an Android saveLayer group and made it blank during
   * the close transition (see HeroTint header + port-spec line 27's fallback).
   * Additive key; only palettes produced by this module carry it.
   */
  tint: string;
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

const TIMEOUT_SENTINEL = Symbol("movieAccent.extractTimeout");

/** Accepts #RGB / #RRGGBB only — the shapes TMDB/extraction ever produce. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * `backdrop_path` → picked raw swatch (the seed hex; the PAINT happens in
 * `buildPalette` through v10's `paintAccent`).
 * `null` is the failure memo: a real rejection is never retried this session.
 * An absent key means "not attempted yet".
 */
const swatchCache = new Map<string, string | null>();

// Cache keys are versioned so changing the extraction recipe migrates instead
// of silently serving stale swatches. The version prefix also makes keys
// idempotent under re-entry.
// v6: the v10 "Glow+" port — pixel-histogram extraction (swatchesFromPixels)
// + the lab's verbatim pick/paint/wash engine (lib/accentCore.ts) replaced
// the v5 gate/paint/AA-solver recipe. v5 and older keys are dropped once and
// re-extracted onto the new baseline — one-time re-extraction.
const SWATCH_KEY_VERSION = "v6";

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
 * rejection) once this session. A transport failure is NO LONGER memoized as
 * "no swatch" — one flaky-network moment on first view used to strand a
 * title on brand gold until relaunch. First failure: not memoized (the next
 * visit retries). Second failure for the same path: memo null and stop
 * looping. Resolved-but-unusable results (genuinely grey art, <50 usable
 * pixels) still memo null immediately — that is a real answer, not an error.
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
          // swatches, v4 pre-AA-solver paints, v5 gate/paint-band recipes)
          // are dropped — the new engine re-extracts them once onto the
          // v10 baseline.
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

// ── v10 pipeline (lab recipe — see lib/accentCore.ts) ─────────────────────

/**
 * The pixel path: RGBA dump → OKLCH hue histogram → accent pick.
 * Returns the picked RAW hex (the seed), or null when the art yields
 * nothing usable (all-grey / <50 usable pixels — real answers, memoized as
 * failures by the callers). Never throws.
 */
function pickFromPixels(data: Uint8Array | Uint8ClampedArray): string | null {
  try {
    return pickAccent(swatchesFromPixels(data))?.hex ?? null;
  } catch {
    return null; // degenerate art (<50 usable px) — a real answer
  }
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

/**
 * Fallback engine (react-native-image-colors) pick. Extraction differs
 * there — a named-swatch bag, not pixels — so candidates are fabricated as
 * FLAT swatches (share = wshare = 1; no pixel shares exist) and handed to
 * the lab's `pickAccent`, which scores vividness + skin/mud penalties and
 * skips grey. Paint is identical either path (it happens in `buildPalette`).
 */
export function pickAccentSwatch(result: ImageColorsResult): string | null {
  const order = result.platform === "ios" ? IOS_SWATCHES : ANDROID_SWATCHES;
  const bag = result as unknown as Record<string, unknown>;
  const candidates: Swatch[] = [];
  for (const key of order) {
    const hex = swatchHex(bag[key]);
    if (!hex || !HEX_COLOR.test(hex)) continue;
    candidates.push({
      name: key,
      hex: hex.toLowerCase(),
      population: 1,
      share: 1,
      wshare: 1,
    });
  }
  return pickAccent(candidates)?.hex ?? null;
}

/**
 * The dim brand color, used whenever there is no backdrop or extraction
 * fails. HAND-COMPUTED literals — failed pages must keep EXACTLY the classic
 * gold look they had before the v10 port:
 *  - accent/accentText: goldDim on bg, as always;
 *  - glow/mid/faded: the pre-v10 derivePalette mixes (38/42/62 % toward bg)
 *    at the OLD alphas .32 / .50 / .94 — the v10 wash alphas (.82/.94/1.0)
 *    must NOT leak into the fallback;
 *  - tint: hand-picked gold tint — the v10 tint of the gold seed
 *    (paintAccent(#B88B2A) → buildPalette → tint), captured once here.
 */
export const FALLBACK_PALETTE: MovieThemePalette = {
  accent: colors.goldDim,
  accentText: colors.bg,
  glow: "rgba(117, 89, 29, 0.32)",
  mid: "rgba(110, 84, 28, 0.5)",
  faded: "rgba(74, 57, 21, 0.94)",
  tint: "#975706",
};

/**
 * Turn a raw swatch (the picked seed hex) into a ready-to-paint v10
 * palette, or null if the art is grey/invalid (caller paints the fallback).
 * `mode` is kept for the signature — v10 is dark-only (APP_COLOR_SCHEME).
 */
export function buildPalette(
  swatch: string,
  mode: AccentMode = APP_COLOR_SCHEME,
): MovieThemePalette | null {
  void mode; // v10 recipe is dark-only; light branch never existed live
  if (!HEX_COLOR.test(swatch)) return null;
  const painted = paintAccent(swatch);
  if ("fail" in painted) return null;
  return buildPaletteCore(painted.accent, painted.text);
}

/**
 * Perceptual hue distance (0–180°) between two colors, measured on their
 * NORMALIZED accents — the CTA tone each would paint — not on raw swatches.
 * v10: normalization = `paintAccent` (keeps hue, solves L for AA), and the
 * distance is measured in OKLCH hue (the engine's own axis). Used to decide
 * whether a late backdrop swatch should REPLACE an already-painted
 * poster-derived accent (< 60° = keep the painted one, no shift) — part of
 * the "user should never see color changing" contract.
 */
export function hueDistance(hexA: string, hexB: string): number {
  const norm = (hex: string): string | null => {
    if (!HEX_COLOR.test(hex)) return null;
    const painted = paintAccent(hex);
    return "fail" in painted ? null : painted.accent;
  };
  const a = norm(hexA) ?? hexA;
  const b = norm(hexB) ?? hexB;
  const ha = HEX_COLOR.test(a) ? C.oklch(a).h : 0;
  const hb = HEX_COLOR.test(b) ? C.oklch(b).h : 0;
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
 * - Engine: the MovieAccent native module (off-JS-thread OkHttp + exact-64px
 *   RGBA dump + the lab's histogram pick, 3 KB/15 KB sources) when present;
 *   react-native-image-colors otherwise (old dev-clients / iOS / Expo Go).
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
        nativeEngine.getPixels(url, DECODE_WIDTH),
        timeout,
      ]);
      if (timer) clearTimeout(timer);
      if (outcome === TIMEOUT_SENTINEL) {
        // Late commit still lands (see commitSwatch) — never memoized.
        nativeEngine
          .getPixels(url, DECODE_WIDTH)
          .then((late) => {
            const lateSwatch = late ? pickFromPixels(late) : null;
            if (lateSwatch) commitSwatch(cacheKey, lateSwatch);
            else swatchCache.set(cacheKey, null);
          })
          .catch(() => swatchCache.set(cacheKey, null));
        return null;
      }
      const swatch = outcome ? pickFromPixels(outcome) : null;
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
 * Synchronous fast path: memory cache first, then the native module's pixel
 * LRU (which survives Metro reloads — the native process keeps its cache when
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
    const pixels = nativeEngine.peekPixels(
      cheapUrlFor(backdropPath, size),
      DECODE_WIDTH,
    );
    if (!pixels) return undefined;
    const hex = pickFromPixels(pixels);
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
