# Accent Feature — UI/UX Audit: Home + TV Detail

Scope: where the per-title accent shows up, on the **Home tab** and the **TV detail page** (`app/tv/[id].tsx`), with the relevant code and wireframe sketches.

Pipeline in one line: backdrop/poster pixels → native swatch extraction → gated `buildPalette(swatch)` → `Palette { accent, accentText, glow, mid, faded }` → surfaces subscribe/fade.

```
poster/backdrop (w92/w300) → MovieAccent.getSwatches → pickSwatch (gates)
   → buildPalette (AA text pairing) → useMovieTheme / home store → UI layers
```

---

## 1. The palette contract

`apps/mobile/lib/movieAccent.ts:401`

```ts
function derivePalette(accent, text, background): MovieThemePalette {
  return {
    accent,      // CTA fill, tick, See-All link
    accentText,  // text on accent fill (≥ 4.5:1, AA)
    glow:        // ambient pool behind hero / page
    mid:         // deep gradient stop under backdrop
    faded:       // soft wash / seam color
  };
}
// No accent / extraction failed → brand gold, never a broken state
export const FALLBACK_PALETTE = derivePalette(colors.goldDim, colors.bg, colors.bg);
```

Two derived helpers matter for the sketches below:

```ts
// lib/movieAccent.ts:289 — home decor tints
homeAccentTints(p) → { heading, accent, hairline, wash /* ~5.5% alpha */ }

// lib/movieAccent.ts:306 — detail page root tint
accentAmbient(p) → accent mixed 3% into bg
```

---

## 2. Home page

### Sketch

```
┌──────────────────────────────────────────┐
│ HomeAccentGlow (absoluteFill, pointer=none)
│   ▒▒▒ top pool  = glow @ 140px ▒▒▒      │  ← behind status bar / top chrome
│                                          │
│  ┌────────────────────────────────────┐  │
│  │           HERO BACKDROP           │  │  Hero.tsx
│  │   accent wash: mid → faded         │  │  (opacity = theme.progress)
│  │                                   │  │
│  │   Title / meta                    │  │
│  │   [ ▶ Watch Now ]  ← accent fill  │  │  color-lerp 450ms from goldDim
│  └────────────────────────────────────┘  │
│  ▁▁▁▁ HeroRowsBridge ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁  │  faded → wash → transparent
│                                          │
│  ▌ Trending      [See All →]             │  tick + See-All = accent
│  ░░░ row bg = wash (~5%) ░░░░░░░░░░░░░  │  MediaCarousel
│  [poster][poster][poster]                │  ← posters NOT tinted
│                                          │
│  ▌ Popular TV     [See All →]            │  same treatment, shares
│                                          │  the hero's single palette
│   ░▒▒ bottom pool = glow @ 280px ▒▒░     │  ← HomeAccentGlow
└──────────────────────────────────────────┘
```

### Where accent shows

| Surface        | Element                 | Value                           | Code                                  |
| -------------- | ----------------------- | ------------------------------- | ------------------------------------- |
| Ambient        | top + bottom glow pools | `palette.glow`                  | `components/HomeAccentGlow.tsx:56-74` |
| Hero           | backdrop wash           | `palette.mid` → `palette.faded` | `components/Hero.tsx:330-331`         |
| Hero           | Watch Now CTA           | `palette.accent` + `accentText` | `components/Hero.tsx:164,487`         |
| Hero→rows seam | bridge gradient         | `faded` → `wash` → transparent  | `HomeAccentGlow.tsx:122`              |
| Rows           | section tick (3×16)     | `tints.accent ?? colors.gold`   | `components/MediaCarousel.tsx:166`    |
| Rows           | See All text/icon       | `tints.accent`                  | `MediaCarousel.tsx:174`               |
| Rows           | whole-row background    | `tints.wash` (~5.5% alpha)      | `MediaCarousel.tsx:150`               |
| Rows           | section heading         | **untouched** (default color)   | `MediaCarousel.tsx:172`               |

### Key code

Single source of truth — the hero publishes its palette; nothing else decodes an image:

```ts
// components/Hero.tsx:74
setHomeAccent(shownTheme.hasAccent ? shownTheme.palette : null);

// components/MediaCarousel.tsx:86 (subscribes, no extra decode)
return p ? homeAccentTints(p) : null;
```

CTA never hard-jumps gold → accent (color lerp, not alpha blend — no mud):

```ts
// components/Hero.tsx:177
Animated.timing(ctaTint.current, {
  toValue: 1,
  duration: 450,
  easing: Easing.inOut(Easing.quad),
  useNativeDriver: false, // backgroundColor/color are JS-driven only
}).start();
```

Ambient glow fades with the accent (450ms), `pointerEvents="none"`, opacity 0 while neutral:

```ts
// components/HomeAccentGlow.tsx:39
Animated.timing(fade.current, { toValue: p ? 1 : 0, duration: 450, ... })
```

---

## 3. TV detail page (`app/tv/[id].tsx`)

### Sketch

```
┌──────────────────────────────────────────┐
│ (back)                (bookmark)(share)  │  ← neutral glass, never tinted
│                                          │
│  ┌────────────────────────────────────┐  │
│  │         BACKDROP 16:9             │  │
│  │  ▓▓▓ bottom gradient: mid→faded ▓▓│  │  opacity = theme.progress
│  └────────────────────────────────────┘  │
│  ░░░░ accent wash pools under it ░░░░░░  │  glow, spans full width
│   ┌──────┐                               │
│   │POSTER│  Title  ★ 2024  •  3 Seasons  │  poster: neutral border
│   └──────┘                               │
│   Overview text (default color)          │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │   ▶ Resume S1 E3 / Play S1 E1     │  │  ← accent fill, accentText
│  └────────────────────────────────────┘  │     SNAPS in 1 frame (no lerp)
│  [ 🎬 Trailer ]      [ ⬇ Download ]     │  ← neutral dark, not tinted
│                                          │
│  Seasons / Episodes / Cast …             │  ← neutral surfaces
└──────────────────────────────────────────┘
```

### Where accent shows

| Surface                             | Element              | Value                           | Code                      |
| ----------------------------------- | -------------------- | ------------------------------- | ------------------------- |
| Backdrop                            | lower gradient       | `palette.mid` → `palette.faded` | `app/tv/[id].tsx:559-560` |
| Page                                | pool under backdrop  | `palette.glow`                  | `app/tv/[id].tsx:587`     |
| CTA                                 | Play / Resume button | `palette.accent`                | `app/tv/[id].tsx:835`     |
| CTA                                 | play icon + label    | `palette.accentText`            | `app/tv/[id].tsx:845`     |
| Nav / Trailer / Download / episodes | —                    | **not tinted**                  | `app/tv/[id].tsx:395,859` |

### Key code

Mounted only once an accent exists, driven by the shared `progress` value (never unmounts later → no pop):

```tsx
// app/tv/[id].tsx:543-568
{
  theme.hasAccent && (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: 0,
        height: BACKDROP_HEIGHT * 0.7,
        opacity: theme.progress,
      }}
    >
      <LinearGradient
        colors={[
          "rgba(7,7,8,0)",
          "rgba(7,7,8,0)",
          theme.palette.mid,
          theme.palette.faded,
        ]}
        locations={[0, 0.35, 0.68, 1]}
      />
    </Animated.View>
  );
}
```

```tsx
// app/tv/[id].tsx:571-594 — full-width wash so scroll never shows a black edge
colors={["rgba(7,7,8,0)", theme.palette.glow, "rgba(7,7,8,0)"]}
```

CTA decision: **snap** the control, **crossfade** the wash — never alpha-blend the two together:

```tsx
// app/tv/[id].tsx:353-364, 835-845
const renderCtaContent = (color: string) => (…);   // neutral helper
<TouchableOpacity style={{ backgroundColor: theme.palette.accent, borderRadius: 12 }}>
  {renderCtaContent(theme.palette.accentText)}
</TouchableOpacity>
```

Hook behaviour behind both pages (`hooks/useMovieTheme.ts`):

```ts
const FADE_MS = 450;
// first accent this mount  → wash fades 0 → 1
// later accent (late/deep) → dips to 0.25 then back to 1 (crossfade, no hue snap)
// key change               → old wash fades OUT in 250ms (never paints A's color on B)
// poster fast path          → w342 lands in ~200–400ms; backdrop refines only if hueGap ≥ 60°
```

---

## 4. UX verdict

**Working well**

- **One palette per surface.** Home derives everything from the hero; detail derives from its own backdrop. No competing accents on a screen.
- **No gold→accent flash.** Sync cache probe paints known accents on frame 1 (`useMovieTheme.ts:66-76`); cold boot is warmed during LegalGate (`warmHeroAccent`) and cache is hydrated in `_layout.tsx:105`.
- **No hard hue jumps.** Every color change goes through the 450ms quad-in-out; CTA is a lerp between solid fills, not an alpha blend.
- **Text legibility.** `accentText` is paired to reach ≥ 4.5:1 against the final accent; gates clamp saturation ≤ 0.7 and lightness 0.28–0.5.
- **Restraint.** Posters, headings, nav glass and secondary buttons stay neutral — accent lives in chrome (tick, See-All, CTA, ambient wash), so it reads as atmosphere, not decoration.
- **Graceful fallback.** Grey/olive/no-backdrop → `FALLBACK_PALETTE` (brand gold-dim). Failure is invisible.

**Risks / open items**

| #   | Issue                                                                | Where                    | Suggest                                                                                                                       |
| --- | -------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Glow pools are large animated layers over the whole home scroll      | `HomeAccentGlow.tsx`     | verify on low-end Android; opacity-only fade is native-driven, but two full-bleed `LinearGradient`s still composite per frame |
| 2   | CTA lerp is JS-driven (`useNativeDriver: false`)                     | `Hero.tsx:181`           | can stutter if JS thread is busy during hero rotation — worth a look in `accentBench`                                         |
| 3   | Detail CTA snaps in 1 frame while the wash crossfades                | `tv/[id].tsx:353`        | intentional, but check first-tap perception: button may look "ahead" of the page on slow extraction                           |
| 4   | `tints.wash` at 5.5% alpha is near-imperceptible on OLED             | `MediaCarousel.tsx:150`  | audit on-device in daylight; consider a hairline accent (already computed, unused: `tints.hairline`)                          |
| 5   | Trailer/Download rows read flat next to a vivid CTA                  | `tv/[id].tsx:849+`       | optionally tint only the icon/border with `faded`, keep fill neutral                                                          |
| 6   | `accentAmbient` (page-root tint) exists but is unused on the TV page | `lib/movieAccent.ts:306` | apply to screen root so long scrolls never show a hard black edge under tinted sections                                       |

**Accessibility checklist**

- [x] CTA text ≥ 4.5:1 against accent (`pairText` / AA gate, `accent/movieAccent.test.ts:52`)
- [x] Accent is decorative — `pointerEvents="none"` on all glow layers
- [ ] Confirm section tick + See-All accent vs. background reaches 3:1 (non-text contrast) on the washed row background
- [ ] Confirm reduced-motion: 450ms fades are still acceptable; consider `AccessibilityInfo.isReduceEnabled` short-circuit

---

_Companion docs: `docs/movie-accent.md` (pipeline), `accent/REPORT.md` (extraction/bench)._
