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
│  OkHttp (2.6s call timeout) → BitmapFactory subsampled decode (~64px)   │
│  → androidx.palette (16 colors, resize disabled)                        │
│  → RAW swatch bag {darkVibrant…lightMuted} → "#RRGGBB" strings          │
│  LRU cache (200) + in-flight dedupe + peekSwatches (sync) + warm()      │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ getSwatches(url, 64) — promise, off JS thread
               ▼
┌─ JS CORE ── lib/movieAccent.ts ─────────────────────────────────────────┐
│ resolveSwatch(path, size)      • 3s race, late commits, null memos      │
│ getSwatchSync(path)            • memory → native LRU (survives reloads) │
│ pickFromSwatchBag / pickAccentSwatch  • preference-ordered gate walk    │
│ normalizeAccent (strict + relaxed tiers, mud/grey gates)                │
│ withReadableText (WCAG AA 4.5:1) → derivePalette (glow/mid/faded)       │
│ swatchCache Map + AsyncStorage "@movieAccent/v1" (v3 keys, 120 cap)     │
│ subscribeSwatch(path, cb)      • late-commit pub/sub                    │
│ setHomeAccent / subscribeHomeAccent / homeAccentTints / accentAmbient   │
│ warmSwatches(items)            • list prefetch                          │
│ warmHeroAccent(queryClient)    • first-launch warm behind the LegalGate │
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
(same header pattern as player-webview; adds `androidx.palette:palette-ktx:1.0.0`
and `com.facebook.react:react-android`; OkHttp already ships with RN),
`MovieAccentModule.kt`.

**Pipeline per call** (`load(url, w)`):

1. LRU hit (`200` entries, `"w|url"` keys) → return immediately.
2. In-flight dedupe: concurrent callers share one `Deferred` (loser cancels
   its own unstarted duplicate).
3. `OkHttp` GET — dispatcher 16 max / 8 per host, connect 2s, **call 2.6s**
   (deliberately under the JS 3s race so a native failure memoizes a real
   null instead of racing the timeout).
4. `BitmapFactory` bounds decode → `inSampleSize` power-of-2 subsample to
   ≤64px width, `ARGB_8888`.
5. `Palette.from(bmp).maximumColorCount(16).resizeBitmapArea(0)` — resize
   disabled because the bitmap is already tiny.
6. Emit **raw** swatch map (+ computed `average`) as hex strings; recycle bitmap.

**Deliberate boundary**: native returns RAW swatches only. All taste
(saturation/lightness bands, mud/grey rejection, AA pairing) stays in JS — one
place to tune, identical behavior on the fallback engine.

**Threading**: 3-thread pool (`NORM_PRIORITY-1`), own `SupervisorJob` scope;
cancelled in `OnDestroy`. JS thread cost ≈ one bridge call.

**Kotlin/DSL note**: `AsyncFunction("getSwatches")` is **Promise-based** (the
`expo.modules.kotlin.promise.Promise` pattern used by the repo's expo-video
patch) rather than the `Coroutine {}` infix DSL — the latter needs an import
the initial file omitted and failed to compile. The coroutine still runs on
the module pool, off the JS thread.

**Dev client**: after `expo prebuild` + `expo run:android`, `NativeModules.MovieAccent`
exists. Before that, `MovieAccent` is `null` and JS falls back transparently.

---

## 3. JS core (`lib/movieAccent.ts`)

### Cache & keys

- `swatchCache: Map<string, string|null>` — absent = not attempted,
  `null` = failed memo (real failures never retried this session), string = RAW hex.
- Keys: **`v3|<path>`** for backdrops; **poster paths use their raw path**
  (poster + backdrop can coexist for one title). v3 = small-rendition baseline;
  hydration **drops** older-format entries (v1 raw, v2 large-image) so all
  titles re-extract once onto one consistent source.
- Persistence: successes only, 120-entry cap (recency order), 2s trailing
  debounce, idempotent `hydrateAccentCache()` awaited by `resolveSwatch`
  before probing (kills the cold-start double-flash).

### Extraction sizes (`cheapUrlFor`)

Accent needs ~64px of pixels, so we download the smallest rendition:
**poster → `w92` (~3 KB), backdrop → `w300` (~15 KB)** regardless of the
`size` argument (it only selects which class). Bytes were the dominant
latency — this is where most of the speed came from, more than the native module.

### Quality gate (`normalizeAccent`, dark scheme)

- Strict tier: s ∈ [0.18, 0.7], l clamped [0.28, 0.5].
- **Mud gate**: hue 40–85° (olive/khaki) requires s ≥ 0.3.
- **Grey gate**: s < 0.08 never faked into color (B&W posters stay neutral).
- Relaxed tier (per-swatch AND per-buildPalette): s ≥ 0.08, l ∈ [0.22, 0.42] —
  near-neutral steel/teal posters still tint instead of falling back to gold.
- `pickFromBagInOrder`: walk swatches in preference order
  (`darkVibrant → darkMuted → vibrant → muted → dominant → average → lightVibrant
→ lightMuted`), first **strict** pass wins; else first **relaxed** pass.

### Palette derivation

1. `normalizeAccent` (strict, then relaxed) → normalized accent.
2. `withReadableText`: choose white or near-black text; darken/lighten the
   accent in 8% steps (≤8 iterations) until WCAG 4.5:1.
3. `derivePalette` (mixed against `colors.bg #070708`):
   - `glow` = mix(accent, bg, 38%) @ α 0.32 — ambient pools
   - `mid` = mix(accent, bg, 42%) @ α 0.50 — wash middle stop
   - `faded` = mix(accent, bg, 62%) @ α 0.94 — wash bottom stop

- `FALLBACK_PALETTE` = precomputed from `goldDim` (failed pages look like the
  classic app).

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
never pop.

Order of resolution per mount:

1. **Frame-1 sync probe**: memory → `getSwatchSync` (native LRU — this is why a
   Metro reload no longer cascades: a known title is tinted on the first frame).
2. **Effect on key**: cache hit → apply; miss → fade old out + `resolveSwatch`.
3. **Poster-first fast path** (detail pages): the poster swatch paints in
   ~tens of ms because the extraction source is tiny (~3 KB w92) AND the
   warm call fired at touch-down (press-in timing) — note the card's decoded
   w342 image is a DIFFERENT URL/cache than the extraction's w92, so decode
   warmth is not the mechanism. The backdrop refines later **only if hue
   gap ≥ 60°** — same-family refinements never repaint, so the user never
   sees a correction.
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
