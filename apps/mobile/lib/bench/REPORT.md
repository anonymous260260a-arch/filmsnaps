# Instant per-title accent: report

## 0. Read this first (honesty notes)

- **The benchmark numbers below are projections, not device measurements.** I have no Android device or emulator here. `lib/bench/accentBench.ts` measures p50/p95 and JS stall on your device in about 2 minutes. Please run it before trusting any figure.
- **I don't have your existing `movieAccent.ts` or its 10 tests.** I rebuilt them from the spec.
  - Gates, swatch order, AA pairing, cache keys, 120-entry cap, 2s debounce and 3s timeout follow the spec.
  - **`glow` / `mid` / `faded` are placeholders.** Paste your real formulas into `buildPalette`. They are the only lines that can change how the UI looks.
  - The strict/relaxed boundary is my reading of the spec: strict is raw s >= 0.18, relaxed is s 0.08–0.18 with l 0.22–0.42, and the olive and grey gates apply to both.
  - My 11 tests are a reconstruction. Merge them with your originals and keep whichever are stricter.
- **Finding:** on Android, `react-native-image-colors` already runs Palette natively, so the JS thread isn't really the bottleneck. **Bytes downloaded are.** A w1280 backdrop is about 150–250 KB and a w342 poster about 20–30 KB, while a w92 poster is about 3 KB and a w300 backdrop about 15 KB. The recommendation exploits this.

## 1. Benchmark (projected, mid-range Android, warm HTTP/2 connection to image.tmdb.org)

| Approach                                                                                      | Poster p50 / p95                    | Backdrop p50 / p95 | JS stall                                 | Mem peak              | APK delta             |
| --------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------ | ---------------------------------------- | --------------------- | --------------------- |
| **1. Native module**: OkHttp + subsampled decode (~64–128px) + palette-ktx, w92 / w300 source | **~35 / 90 ms** (cold TLS p95 ~250) | **~60 / 150 ms**   | ~0–2 ms (one bridge call)                | ~1–2 MB transient     | ~+40 KB               |
| 2a. image-colors as-is (w342 / w1280)                                                         | 200–400 / 600                       | 1000–3000 / 3500   | small on Android, bridge + JSON only     | 8–15 MB (full decode) | 0                     |
| 2b. image-colors tuned (`quality:'low'`, `pixelSpacing`) + w92 / w300 URL                     | ~90–160 / 300                       | ~150–300 / 500     | small                                    | ~2 MB                 | 0                     |
| 3. expo-image-manipulator 64px + base64 + JS `image-q`                                        | ~250–450 / 700                      | ~400–800 / 1200    | **10–30 ms** (quantize and base64 parse) | ~3–5 MB               | ~+0.3 MB + ~100 KB JS |
| 4. (complement) prefetch visible list items / precompute server-side                          | n/a                                 | n/a                | 0                                        | 0                     | 0                     |

Estimates come from payload sizes, the usual JPEG decode cost at 64–128px, and expo-modules bridge overhead (about 1–3 ms). Sweeping quality and pixelSpacing in 2b only changes the ~5 ms Palette step. The tuned variant gets most of its gain from the smaller URL, and the same trick is applied to approach 1.

## 2. Recommendation: approach 1 (native module) with cheap-URL fetch, JS gates unchanged

- Both budgets fit: poster ~35 ms p50 against a ≤50 ms budget, backdrop ~60 ms against ≤300 ms.
- It has the lowest variance, because it is independent of JS thread load during navigation, and it is the only option with a **synchronous native LRU peek** that survives Metro reloads.
- Risk is low. It is a sibling of your two existing modules, it adds no APK weight (OkHttp ships with RN), it is Android-only, and `movieAccent.ts` falls back to `react-native-image-colors` if the module is absent. You can ship the TS before rebuilding the dev-client.
- Expect small colour differences from today. Palette runs on a w92 / w300 source instead of w342 / w1280, so swatches can shift slightly, and this is the main behavioural risk. The hue-gap gate (< 60°) absorbs most of it. Spot-check about 20 titles and compare old and new.
- **Extraction speed alone won't reach >90% tinted first paint.** Navigation takes about 150–300 ms and a cold poster fetch can take 250 ms or more. The real lever is **calling `warmSwatches(items)` from list `onViewableItemsChanged`** so most titles are cached before the tap. `onPressIn` warming stays as the safety net.

## 3. Files (all under `apps/mobile/`)

- `modules/movie-accent/{package.json, expo-module.config.json, index.ts, src/index.ts, android/build.gradle, android/src/main/AndroidManifest.xml, android/src/main/java/expo/modules/movieaccent/MovieAccentModule.kt}`
- `lib/movieAccent.ts`
- `lib/__tests__/movieAccent.test.ts`
- `lib/bench/accentBench.ts`

## 4. Integration steps

1. Copy the files in. **Diff `android/build.gradle` against `modules/player-webview/android/build.gradle`** and keep your plugin/header block if it differs. Only the two `dependencies` lines are essential.
2. Confirm the `modules/` directory is picked up by autolinking (the same way as your other two modules). No extra pnpm package is needed: `tinycolor2` and `@react-native-async-storage/async-storage` are already present.
3. Reconcile `movieAccent.ts` with your current file: paste your `glow` / `mid` / `faded` lines, then merge the tests.
4. Metro reload only: the TS runs on the JS fallback engine. Run `pnpm --filter mobile test`.
5. Rebuild the dev-client: `cd apps/mobile && npx expo prebuild --platform android && npx expo run:android`. Confirm `MovieAccent` is non-null (`console.log(!!require('./modules/movie-accent').MovieAccent)`).
6. Add `warmSwatches(visibleItems)` to your list `onViewableItemsChanged` handlers. Keep `onPressIn` as is.
7. Run `runAccentBench()` on a real device, and fill in the real numbers next to the projected ones above.
8. If the old iOS path matters, leave it. `platforms: ["android"]` means iOS silently uses the fallback.

## 5. Verify on device

1. Native module loads (non-null), and logcat shows no `MovieAccent` errors.
2. Bench: poster p50 ≤ 50 ms and backdrop p50 ≤ 300 ms, with worst JS stall under 16 ms.
3. Scroll a list, then tap a card that stayed on screen for about 1 s. The detail first frame is already tinted.
4. Airplane mode: detail paints the neutral theme, and nothing hangs (the 3s race resolves null).
5. Tap a card instantly after the list loads (cold). There is no gold-to-accent flash, only at most a 450 ms crossfade.
6. Force a slow network (throttle). The late commit arrives via `subscribeSwatch` and crossfades, with no snap.
7. A title with a grey or olive poster keeps the neutral or relaxed tier, with no mud accents.
8. Check AA on the CTA for 10 saturated and 10 pale posters (text readable at 4.5:1).
9. Reload Metro and reopen a previously seen title. `getSwatchSync` hits the native LRU on first render.
10. Home hero and row glow still update through `setHomeAccent` / `subscribeHomeAccent`, with no regressions.
