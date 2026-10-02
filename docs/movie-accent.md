# Movie Accent — Architecture & Data Flow

The per-title "cinematic accent" system: extract a color from a title's artwork
and blend it through the UI (like Spotify's per-album colors). This doc maps
every layer so gaps are visible. Section 9 lists known gaps and improvements.

---

## 1. Bird's-eye flow

```
 TMDB CDN (image.tmdb.org)
   w92 poster (~3 KB) / w300 backdrop (~15 KB)
        │
        ▼
┌─ NATIVE (Android only) ── modules/movie-accent ─────────────────────────┐
│ MovieAccentModule.kt                                                    │
│  OkHttp (2.6s call timeout) → subsampled decode, scaled to EXACTLY 64px  │
│  → Bitmap.getPixels → RAW RGBA byte dump (Uint8Array, 4 bytes/px)       │
│  pixel LRU (100, ~2.4MB) + in-flight dedupe + peekPixels (sync) + warm() │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ getPixels(url, 64) — promise, off JS thread
               ▼
┌─ JS CORE ── lib/accentCore.ts + lib/movieAccent.ts ─────────────────────┐
│ accentCore (v10 "Glow+" engine + v11.1 wash):                             │
│   swatchesFromPixels (OKLCH hue histogram + wshare) → pickAccent        │
│   → paintAccent (AA-solved anchor) → buildPalette (glow/mid/faded/tint) │
│ movieAccent (orchestration):                                            │
│   resolveSwatch(path, size)      • 3s race, late commits, null memos    │
│   getSwatchSync(path)            • memory → native pixel LRU            │
│   pickAccentSwatch               • image-colors fallback bag → same pick│
│   swatchCache Map + AsyncStorage "@movieAccent/v1" (v6 keys, 120 cap)   │
│   subscribeSwatch(path, cb)      • late-commit pub/sub                  │
│   setHomeAccent / subscribeHomeAccent / homeAccentTints / accentAmbient │
│   warmSwatches(items)            • list prefetch                        │
│   warmHeroAccent(queryClient)    • first-launch warm behind the LegalGate│
└──────────────┬──────────────────────────────────────────────────────────┘
               │ useMovieTheme(backdropPath, posterPath)
               ▼
┌─ HOOK ── hooks/useMovieTheme.ts ────────────────────────────────────────┐
│ frame-1 sync probe (memory → native LRU)                                │
│ poster-first fast path (w342 key, <60° hue-gap refine guard)            │
│ single Animated progress 0→1, 450ms crossfade-only color changes        │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ { palette, hasAccent, progress }
               ▼
┌─ UI SURFACES ───────────────────────────────────────────────────────────┐
│ Home   Hero (wash + image crossfade + staged swap + CTA color lerp)     │
│        HomeAccentGlow (top + bottom pools)   HeroRowsBridge (seam)      │
│        MediaCarousel (tick + SeeAll tint + row wash)                    │
│ Detail movie/[id] tv/[id] (scrim wash, glow pool, accentAmbient root,   │
│        accent CTA)                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

Fallback: when the native module is absent (iOS, Expo Go, old dev-client),
`resolveSwatch` uses `react-native-image-colors` on the same cache keys.
Nothing upstream changes.

---

## 2. Native side (`modules/movie-accent`)

**Files**: `expo-module.config.json` (platforms `["android"]`), `build.gradle`
(same header pattern as player-webview; keeps `androidx.palette:palette-ktx`
for the dev-only `getSwatches` path and `com.facebook.react:react-android`;
OkHttp already ships with RN), `MovieAccentModule.kt`.

**Pipeline per call** (`getPixels(url, decodeWidth)` — promise, off the JS
thread):

1. Pixel LRU hit (`100` entries ≈ 2.4MB max, `"p|<width>|<url>"` keys) →
   return the cached RGBA dump immediately.
2. In-flight dedupe: concurrent callers share one deferred result.
3. `OkHttp` GET — dispatcher 16 max / 8 per host, connect 2s, **call 2.6s**
   (deliberately under the JS 3s race so a native failure memoizes a real
   null instead of racing the timeout).
4. `BitmapFactory` bounds decode → `inSampleSize` power-of-2 subsample →
   `Bitmap.createScaledBitmap` to **EXACTLY `decodeWidth` (64) px wide**
   (height proportional), `ARGB_8888`.
5. `Bitmap.getPixels` → RGBA `ByteArray` (4 bytes/px) → JS `Uint8Array`.
   Fetch/decode failures resolve **`null`** (a miss is a real answer, not a
   rejection); only an internal throw rejects.

**`peekPixels(url, decodeWidth)`** — sync, reads the pixel LRU only (no
decode, no network). This is the frame-1 fast path: `getSwatchSync` picks
from these bytes after a Metro reload, because the native process keeps its
LRU across JS bundle restarts.

**`getSwatches` / `peekSwatches`** — the legacy `androidx.palette` 16-color
bag path, **kept only for the dev Accent Lab** (`app/dev/accent-lab.tsx`)
readouts. Production never calls it.

**`warm(urls, decodeWidth)`** prefetches **pixels** (what the pipeline
consumes); `clear()` empties both the pixel LRU and the legacy swatch cache.

**Deliberate boundary**: native returns RAW RGBA pixels only. All taste
(saturation/lightness bands, hue histogram, grey/mud/skin rejection, AA
pairing) stays in JS (`lib/accentCore.ts`) — one place to tune, identical
behavior on the fallback engine.

**Threading**: 3-thread pool (`NORM_PRIORITY-1`), own `SupervisorJob` scope;
cancelled in `OnDestroy`. JS thread cost ≈ one bridge call.

**Kotlin/DSL note**: `AsyncFunction("getPixels")` is **Promise-based** (the
`expo.modules.kotlin.promise.Promise` pattern used by the repo's expo-video
patch) rather than the `Coroutine {}` infix DSL — the latter needs an import
the initial file omitted and failed to compile. The coroutine still runs on
the module pool, off the JS thread.

**Dev client**: after `expo prebuild` + `expo run:android`, `NativeModules.MovieAccent`
exists. Before that, `MovieAccent` is `null` and JS falls back transparently.

---

## 3. JS core (`lib/accentCore.ts` + `lib/movieAccent.ts`)

The port splits the core in two: **`accentCore.ts` is the browser "Accent Lab
v10 Glow+" engine** (extraction / pick / paint fixture-pinned by tests) plus a
device-side retune — **v11 "Cinema"** (`TUNE` only: CTA chroma 0.72–0.85 of
gamut, deeper washes, white-zone anchors down) and **v11.1 wash** (see below);
**`movieAccent.ts` is the app-side orchestration** (cache, timeouts, warm
paths, fallback engine) whose contracts are unchanged from the pre-port
design.

### The engine (`lib/accentCore.ts`, v10 core + v11/v11.1 `TUNE`)

- **Hand-rolled OKLab/OKLCH math** (`C.oklch` / `C.rgb`, `cMaxAt`
  hue-preserving gamut clamp, `contrast` WCAG ratio, `zoneOf`, `isGrey`,
  `rgba`). Deliberately NOT swapped for `culori`/`tinycolor2` (both now
  removed from mobile deps): the lab's arithmetic must stay bit-exact, and
  it costs sub-ms on a 64px frame.
- **`swatchesFromPixels(rgba, w, h)`** — per-pixel OKLCH histogram → zones +
  `wshare` (well-lit hue share). Skips alpha < 200 and near-black pixels.
  All-grey art (≥50 usable px) → `[]` (a real "no color" answer); fewer
  than 50 usable px → **throws `"no usable pixels"`** — callers catch and
  treat as null. This is the lab's own contract, quirks included.
- **`pickAccent(swatches)`** — scores on **`wshare`, not `population`**
  (the lab's choice), with vividness + skin-box/mud penalties; grey
  candidates are skipped (`{ fail: "grey" }`).
- **`anchorAt(h)` / `paintAccent(hex)`** — the 2-point anchor ladder →
  AA-solved `{ accent, text }` per zone (white side floors at L 0.40).
  `paintAccent` does NOT validate its input — `movieAccent.buildPalette`
  guards with `HEX_COLOR` first (an invalid hex would otherwise paint
  `#NaNNaNNaN`).
- **`buildPalette(accent, text)`** — **v11.1**: the wash _is_ the CTA color.
  Every zone keeps the accent's exact hue (no hue remap — `washHue` was
  deleted in v11.1); lightness is derived from the CTA's own L:
  `clamp(CTA_L × mul, lo, hi)` per zone (glow ×0.74 → .40–.62, mid ×0.55 →
  .30–.50, faded ×0.38 → .18–.36, tint ×0.55 → .40–.52). Chroma comes from
  the accent (`col.c`, capped at **.20**, tightened to **.13** in the gold
  band 80–115° instead of hue-shifting to bronze), clamped to the gamut at
  0.98. Glow/mid/faded are emitted against `BG = #070708` at alphas
  **.65 / .84 / 1.0**, plus the solid **`tint`** hero color.
- **Parity pins**: `__tests__/accentParity.test.ts` (20 titles, bit-exact
  picked/painted hexes against `__tests__/fixtures/accent-lab-v10-export.json`)
  and `__tests__/accentCore.test.ts` (synthetic swatches, AA, wash, zones).
  Device caveat: the gate runs on Node/V8; Hermes may differ in the last bit
  (≤1/255) on some titles.

### Orchestration (`lib/movieAccent.ts`)

**Cache & keys**

- `swatchCache: Map<string, string|null>` — absent = not attempted,
  `null` = failed memo (real failures never retried this session), string =
  the picked **raw seed hex** (painting happens later, in `buildPalette`).
- Keys: **`v6|<path>` for BOTH posters and backdrops** (`extractKey`
  versions everything; it is also idempotent under re-entry). v6 = the v10
  pixel-histogram + verbatim-engine baseline; hydration **drops** v5 and
  older entries so every title re-extracts once onto one recipe.
- Persistence: successes only, 120-entry cap (recency order), 2s trailing
  debounce, idempotent `hydrateAccentCache()` awaited by `resolveSwatch`
  before probing (kills the cold-start double-flash).

### Extraction sizes (`cheapUrlFor`)

Accent needs ~64px of pixels, so we download the smallest rendition:
**poster → `w92` (~3 KB), backdrop → `w300` (~15 KB)** regardless of the
`size` argument (it only selects which class; class ≤500 → w92, above → w300).
Bytes were the dominant latency — this is where most of the speed came from,
more than the native module.

### Pipeline (`resolveSwatch`, unchanged flow)

1. Await hydration → cache probe → native `getPixels` raced against 3s.
2. Pixels → `pickFromPixels` = `swatchesFromPixels` → `pickAccent`
   (throw → null). Success commits + notifies subscribers; timeout returns
   null **without memoizing** (the late retry commits when it lands);
   transport failures retry once, then memoize null; unusable results
   (grey art) memoize null immediately.
3. Fallback engine (no native module: iOS / Expo Go / old dev-client):
   `react-native-image-colors` named bag → **`pickAccentSwatch` fabricates
   FLAT swatches** (`share = wshare = 1`, no pixel shares exist) → the same
   `pickAccent`. Paint is identical either way (it happens in `buildPalette`).

### Paint (`buildPalette`, `hueDistance`)

- `buildPalette(swatch, mode)`: `HEX_COLOR` guard → `paintAccent` (fail →
  null) → engine `buildPalette`. `mode` is signature-compat only — v10 is
  dark-only. Callers paint `FALLBACK_PALETTE` on null.
- `hueDistance(a, b)`: normalizes both through `paintAccent`, then measures
  OKLCH hue distance (0–180°). The **< 60° refine gate** uses it: a late
  backdrop swatch only replaces an already-painted poster accent when the
  hues differ enough to be worth a shift.
- `FALLBACK_PALETTE` = **hand-picked literals** so failed pages keep
  EXACTLY the classic gold look: accent `goldDim`, accentText `bg`,
  glow/mid/faded at the **OLD** alphas **.32 / .50 / .94** (the v10 wash
  alphas must not leak into the fallback), tint `#975706` (the v10 tint of
  the gold seed, computed once).

### Home store (hero → rows, single source of truth)

- Hero publishes via `setHomeAccent(palette|null)`; rows/glow subscribe via
  `subscribeHomeAccent` (subscribers get the current value **synchronously** —
  late-mounting rows start already tinted).
- `homeAccentTints(p)`: `heading` (lightened 18%, desaturated 10%), `accent`,
  `hairline` (α 0.22, currently unused by UI), `wash` (α 0.055 — the row
  background tone the bridge decays into).
- `accentAmbient(p)`: mix(accent, bg, **3%**) — whole-page tint for detail roots.

### Warm paths

- `warmHeroAccent(queryClient)`: first-launch warm behind the LegalGate
  (retried once after query-cache restore).
- `prepareDetail` (`onPressIn`): warms the **card poster's** swatch (the exact
  w342 file the card decoded) + backdrop.
- `warmSwatches(items)`: from carousel `onViewableItemsChanged` (50% visible).
- Hero swap: stages the incoming item's swatch before flowing it in.

---

## 4. The hook (`hooks/useMovieTheme`)

Contract: `{ palette, hasAccent, progress }` — `progress` is one `Animated.Value`
per mount; **every** color change is a crossfade (450ms), never a snap; a key
change fades the OLD accent out immediately (250ms) instead of painting movie A's
color over movie B; mid-fade the previous palette stays "painted" so consumers
never pop. The hook itself is unchanged by the v10 port — only what the cache
returns moved (seed hexes now picked by `accentCore`, keys bumped to `v6`,
which drops persisted v5 entries and re-extracts each title once).

Order of resolution per mount:

1. **Frame-1 sync probe**: memory → `getSwatchSync` (memory → native **pixel
   LRU** via `peekPixels`, picked on the spot — this is why a Metro reload no
   longer cascades: a known title is tinted on the first frame).
2. **Effect on key**: cache hit → apply; miss → fade old out + `resolveSwatch`.
3. **Poster-first fast path** (detail pages): the poster swatch paints in
   ~tens of ms because the extraction source is tiny (~3 KB w92) AND the
   warm call fired at touch-down (press-in timing) — note the card's decoded
   w342 image is a DIFFERENT URL/cache than the extraction's w92, so decode
   warmth is not the mechanism. The backdrop refines later **only if
   `hueDistance` ≥ 60°** — the distance is measured on `paintAccent`-normalized
   OKLCH hues (the CTA tone each would paint), so same-family refinements
   never repaint and the user never sees a correction.
4. Timeout path (3s): caller gets null, subscribes; the late commit still lands
   via `subscribeSwatch` (never memoized).

---

## 5. UI blending map

| Surface           | What carries the accent                                                                                           | Mechanism                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Hero image        | two stacked layers, 450ms fade on swap                                                                            | staged: decode + swatch gates open → one-frame swap                      |
| Hero wash         | gradient `mid`→`faded` bottom 30–70%                                                                              | `Animated` opacity on `LinearGradient`                                   |
| Hero CTA          | background **and** label color                                                                                    | true color **lerp** (JS driver), from `goldDim`/`#070708` — no alpha mud |
| Home ambient      | `HomeAccentGlow`: top pool (140px) + bottom pool (280px) behind all content                                       | opacity fade with accent                                                 |
| Hero→rows seam    | `HeroRowsBridge` (110px, −34px overlap): `faded → wash → transparent`                                             | gradient stops end at the exact row tone — no perceptible join           |
| Rows              | whole-row background `tints.wash` (~5% alpha), edge-to-edge; accent tick; See All tint; heading **default color** | instant color swap synced to the hero crossfade frame                    |
| Detail root       | `accentAmbient` 3% page tint                                                                                      | instant, paired with the wash crossfade                                  |
| Detail scrim/glow | same gradient pattern as home + glow pool under backdrop                                                          | `Animated` opacity                                                       |

Choreography rule: **one 450ms scene rhythm**. The wash, image fade, CTA lerp,
row tint swap, and glow all change in the same window, so the eye reads a
single scene shift. Neutral surfaces are never animated _into_ visibility
rows/glow at opacity 0 are simply transparent until the accent exists.

---

## 6. Warm/cold behavior matrix

| Scenario                  | What the user sees                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Warm boot, known hero     | tinted frame 1 (sync probe)                                                                          |
| Cold boot (LegalGate)     | hero warm fires behind the gate; first paint tinted                                                  |
| Tap a card seen in a list | swatch pre-warmed by viewability + onPressIn → tinted first paint                                    |
| Tap a cold card           | skeleton neutral → poster swatch paints in ~50–100ms (native) → backdrop refines only if hue differs |
| Extraction fails          | neutral forever (null memo); nothing hangs                                                           |
| Extraction slow           | 3s caller timeout; late commit crossfades in                                                         |
| Metro reload, seen title  | native LRU → tinted frame 1 (no cascade)                                                             |

---

## 7. Tests & bench

- `lib/__tests__/movieAccent.test.ts` — 16 tests: strict/relaxed tiers, mud/grey
  rejection, no-stranded-swatch walk, AA sweep across hues, wash luminance
  bounds, native-bag picker, resolve memo/timeout/late-commit (subscriber
  regression for the v2-keying bug).
- `lib/bench/accentBench.ts` — `runAccentBench(posters, backdrops)` → p50/p95 +
  worst JS stall; budgets poster ≤50ms, backdrop ≤300ms, stall <16ms.
  REPORT.md has the projected table; fill in device numbers.

---

## 8. Extension guide (how to tint something new)

1. Subscribe: `subscribeHomeAccent` (home surfaces) or `useMovieTheme` (own hero).
2. Prefer **backgrounds/chrome** over content; never tint faces/posters/text.
3. Use the precomputed tones: `palette.glow` (ambient), `tints.wash` (~5% row
   bg), `accentAmbient` (3% page bg), `palette.accent` (CTA-scale only).
4. Animate with the scene: 450ms, or instant-but-synced to the hero crossfade.
5. Neutral state must be a no-op (transparent / `colors.bg`), never animated in.

---

## 9. Known gaps & improvement candidates

**Correctness / consistency**

1. **Small-source hue drift** — swatches now come from w92/w300, so ~20-title
   spot-check vs old colors is pending; the 60° refine gate absorbs most drift.
2. **Poster-key inconsistency** — poster keys are raw paths, backdrops `v3|path`;
   `peekSwatch` probes both, but a future `v4` should version poster keys too.
3. **`hueDistance` raw-vs-normalized** — compares RAW swatch hexes; comparing
   normalized accents (post-clamp) would match what the eye sees more closely.
4. **Single-swatch source** — `dominant` population weight (swatch pixel share)
   is unused; scoring `saturation × population` could beat the fixed order.
5. **Kotlin untested on device until your build** — the Promise-style
   AsyncFunction compiles clean; logcat is the arbiter.

**UX polish** 6. **Detail-section cards still opaque** (`bgSurface`) — they sit above the 3%
ambient tint; making section containers translucent would deepen the vibe. 7. **Tab bar / headers unthemed** — the vibe stops at the page edge; the same
store could tint the tab bar border/active color. 8. **Watch page has no accent** — the biggest un-themed surface. 9. **Row tint swap is instant** — fine today (synced to the hero crossfade
frame), but interpolating `tints.wash` color would make it literally seamless. 10. **LegalGate warm covers the hero only** — could extend `warmSwatches` to
the first rows during the gate for fully-warm first scroll.

**Robustness** 11. **Native LRU vs persisted cache can disagree after re-extraction** —
`getSwatchSync` commits native hits into memory, which wins; acceptable,
but a merge policy could prefer the newer commit. 12. **No iOS engine** — iOS silently uses react-native-image-colors; a native
Swift/ZPalette port would close the gap if iOS ever matters. 13. **Bench not scheduled anywhere** — RESOLVED: the dev Accent Lab
(`app/dev/accent-lab.tsx`) runs `runAccentBench` over the corpus and
shows p50/p95/stall on-device.
