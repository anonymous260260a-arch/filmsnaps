# App Technical Overview (Confidential — for expert consultation)

> **DO NOT SHARE THIS DOCUMENT EXTERNALLY.**  
> Anonymized for consultation — no app name, provider names, URLs, or business purpose are disclosed.

---

## 1. Architecture Overview

### 1.1 Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native (Expo managed workflow) |
| Language | TypeScript |
| Navigation | Expo Router (file-based routing) |
| State Mgmt | React Query (TanStack Query) for server data |
| Styling | NativeWind (Tailwind CSS for React Native) |
| Monorepo | Turborepo with shared packages |

### 1.2 Package Structure (Monorepo)

```
apps/
  mobile/          — React Native (Expo) app
packages/
  shared/          — Shared types, provider registry, utilities
```

### 1.3 Key Libraries

- `react-native-webview` — renders third-party embed pages (media player)
- `expo-router` — file-based navigation
- `@tanstack/react-query` — data fetching + caching
- `react-native-reanimated` — animations (overlay fade, gestures)
- `expo-keep-awake` — prevent screen sleep during playback
- `expo-screen-orientation` — lock orientation in fullscreen
- `nativewind` / `tailwindcss` — styling utilities
- `zustand` — lightweight client state (favorites, history)
- `expo-secure-store` — encrypted storage for sensitive data
- `expo-file-system` + `expo-media-library` — download/save files

---

## 2. Module Breakdown

### 2.1 Media Discovery (Home / Browse)

- **TMDB API** as the metadata source (movies, TV shows, images)
- React Query with stale-while-revalidate caching
- Server-side rendered placeholder data on app launch (prefetch)
- Grid-based MediaCard components with memoization (`useMemo`, `React.memo`)

### 2.2 Search

- Debounced text input (300ms via `useDebounce`)
- FlatList with 3-column grid layout
- `media_type` filter (movie vs tv) — hardcoded per media detail page
- Prefetches media details on card tap before navigation

**Known issue (FIXED):** Keyboard dismissal on first tap consumed the tap event. Fixed by adding `keyboardShouldPersistTaps="always"` to the results FlatList.

### 2.3 Media Detail Screen

- Shows metadata (title, year, poster, overview, cast)
- Episode/season picker for TV shows
- Server/provider selection modal
- "Watch" button → navigates to the player screen

### 2.4 Video Player (Watch Page) — *Most Complex Module*

The watch page is a single-screen WebView-based media player. Key subsystems:

#### 2.4.1 Provider Registry
- Centralized list of streaming sources (third-party embed pages)
- Each provider has: `id`, `baseUrl`, embed URL templates (movie/TV), `enabled` flag
- Dynamically selected by the user from a picker modal
- Sorted by priority (`order` field, lower = first)

#### 2.4.2 Script Injection
Two script variants injected via `injectedJavaScriptBeforeContentLoaded`:

**Script A (Browser-fingerprint spoofing + ad blocking):**
- Overrides `navigator.webdriver`, `navigator.plugins`, `navigator.languages`
- Patches `WebGLRenderingContext.getParameter` (GPU fingerprint)
- Blocks `window.open`, intercepts `fetch`/`XHR` to ad domains
- Intercepts `document.createElement` for ad iframes
- Blocks `pushState`/`replaceState` navigation to ad URLs
- Removes service worker registration attempts
- Style injection to hide ad overlays
- MutationObserver + periodic sweeper for ad elements

**Script B (Minimal — for Cloudflare-protected providers):**
- Same browser-fingerprint spoofing
- Fullscreen API interception → notifies React Native via `postMessage`
- Minimal iframe-based ad removal
- Provider-specific UI element hiding (install banners, login buttons)
- No `pushState`/`location` blocking (Cloudflare needs these)

#### 2.4.3 Navigation Blocking
- `onShouldStartLoadWithRequest` blocks navigation to non-provider domains
- Chain navigation tracking (set of visited URLs) — only provider-host URLs allowed
- `intent://` URLs blocked universally (would open external browser)

#### 2.4.4 Orientation + Screen Sleep
- `useKeepAwake()` — prevents screen sleep while component is mounted
- Fullscreen API patched → posts message to RN → locks to landscape
- Exit fullscreen → unlocks to portrait
- Auto-hiding overlay bar with Animated opacity (fades after 4s idle)

#### 2.4.5 Provider-Specific UI Element Hiding
- Each provider's embed page has unique ad/install banner elements
- CSS injection + MutationObserver + periodic sweeper to remove them
- Text-content matching is fragile (false positives break the player)
- Parent DOM climbing is aggressive (can break player if over-hidden)
- Current approach: CSS-only constructable stylesheets + targeted element removal

#### 2.4.6 Episode Switching
- Season/episode picker modal
- `webViewKey` changes → forces WebView remount (new URL)
- Loading spinner overlay during transition

**Known issue (FIXED):** Selecting the same episode triggered infinite spinner because WebView key didn't change (same state), so `onLoadEnd` never fired to clear loading state. Fixed by only setting loading state when episode actually changes.

### 2.5 Download Feature

- Two separate download screens (different provider integrations)
- WebView-based content download with file saving to device
- `useKeepAwake()` keeps screen on during long downloads

---

## 3. Key Mechanisms

### 3.1 Data Fetching

```
TMDB API ← React Query (cache + prefetch) ← React components
```

- React Query with `staleTime` (1 hour) for media metadata
- Prefetch on card hover/tap to reduce perceived navigation time
- Infinite query for paginated content (home/browse)

### 3.2 Navigation Flow

```
Home → Media Detail → Watch Page (WebView)
                    → Download Page (WebView)
```

- Expo Router with file-based routing (`/movie/[id]`, `/tv/[id]`, etc.)
- Server provider selection persists across watch sessions via state
- No persistent navigation state — fresh mount each time

### 3.3 Styling System

- Tailwind CSS via NativeWind
- Custom theme tokens (colors: `void`, `elevated`, `subtle`, `gold`, `t1`-`t3`)
- Dark theme only (no light mode toggle)
- SafeAreaInsets for notched devices

---

## 4. Performance Profile

### 4.1 Current Bottlenecks (Suspected)

| Area | Issue |
|---|---|
| WebView startup | 2-8s delay before video plays (provider DNS, Cloudflare challenge, ad redirect chain) |
| Script injection | Large injected JS blocks page parsing (Script A is ~200 lines) |
| MutationObserver | `attributes: true, subtree: true` on full document causes jank on SPAs |
| Periodic sweepers | `setInterval` at 3s scanning DOM for ad elements — expensive on mobile |
| Bundle size | Expo managed + WebView + React Query + Reanimated + NativeWind = large JS bundle |
| Image loading | Unoptimized TMDB images (no blurhash, no progressive loading) |
| React re-renders | State changes (loading, overlay visibility, provider switch) cause full-tree re-renders |

### 4.2 Bundle Size Analysis (Estimated)

| Package | Estimated Size |
|---|---|
| `react-native-webview` | ~150KB |
| `react-native-reanimated` | ~200KB |
| `@tanstack/react-query` | ~35KB |
| `expo-router` + navigation | ~100KB |
| `nativewind` / tailwind | ~50KB |
| App code + shared packages | ~200KB+ |
| **Total JS bundle** | **~800KB-1.2MB** |

---

## 5. Security

### 5.1 Current Measures
- Third-party cookies disabled for WebView
- Mixed content blocked (`mixedContentMode="never"`)
- Geolocation disabled
- `intent://` URL blocking (prevents launching external browser via ad popups)
- Fetch/XHR interception to ad domains
- Iframe creation interception (blocks ad frames)
- Service worker removal (prevents persistent background scripts)
- Navigation locking via `onShouldStartLoadWithRequest`

### 5.2 Security Risks

| Risk | Severity | Notes |
|---|---|---|
| Third-party code execution | **High** | WebView loads unvetted third-party pages with full JS execution |
| Cookie leakage | Medium | Cookies shared across provider domains via `sharedCookiesEnabled` |
| XSS via injected scripts | Medium | Injected JS is static template literals, but provider URLs are dynamic |
| Data exfiltration via fetch | Medium | Ad domain blocking is regex-based, not exhaustive |
| Service worker persistence | Low | SW removal is best-effort (runs after registration, not before) |

---

## 6. Known Bugs & Potential Issues

### 6.1 Confirmed Bugs
1. **Install banner hiding breaks player** — Aggressive text-content sweeping or parent DOM climbing from ad elements hides shared containers that include the video player. Currently unresolved for some providers.
2. **MutationObserver jank on SPAs** — Watching attribute changes on full document with `subtree: true` causes frame drops on React-heavy pages.
3. **WebView memory leak** — No explicit cleanup of WebView on unmount (Android WebView retains DOM in memory).
4. **Provider redirect chain** — Page may navigate through 2-3 intermediate URLs before video starts. Navigation blocking can interfere.
5. **Orientation race condition** — Fullscreen → landscape lock can conflict with system animation, causing a 1-2 frame portrait flash.

### 6.2 Potential Bugs (Untested Scenarios)
1. **Multiple WebViews** — If user opens watch page while download page is active (WebView in background), both keep memory/CPU.
2. **Expo update rollback** — OTA updates via EAS Update could fail, leaving app in inconsistent state.
3. **Service worker interference** — Third-party service workers (if they register before our removal sweeper) could cache malicious scripts.
4. **Secure store corruption** — If `expo-secure-store` data gets corrupted, favorites/history could be lost silently.
5. **React Query stale data** — TMDB images or metadata could be stale for up to 1 hour (current `staleTime`).
6. **Android back button** — WebView may intercept hardware back button before React Navigation, showing blank white screen instead of navigating back.

---

## 7. Recommendations Needed

We need expert advice on the following areas:

### 7.1 Performance & Loading
- How to reduce WebView cold-start time (currently 2-8s)?
- Preloading strategies: pre-connect, pre-render, or hidden WebView pool?
- Reducing script injection overhead — should we split scripts by phase?
- Image optimization pipeline for TMDB posters (resize, WebP, blurhash)?
- FlatList virtualization tuning for large search result sets?

### 7.2 Bundle Size
- Can we tree-shake unused native modules?
- Is NativeWind runtime overhead worth it vs static styles?
- Dynamic imports for heavy screens (WebView, detail pages)?
- Hermes vs JSC — is Hermes reducing or increasing our binary size?

### 7.3 UI/UX
- Skeleton loaders vs loading spinners for media grid?
- Animation jank during overlay fade — should we use native driver?
- Better error states for failed provider loads?
- Touch target sizing on media cards (especially with keyboard overlap)?
- Could we preload the next episode's WebView while current episode plays?

### 7.4 Data & Caching
- Optimal React Query caching strategy for TMDB data?
- Should we persist search history locally for instant re-search?
- Prefetch adjacent episodes in the background?
- Offline support for previously viewed metadata?

### 7.5 Security & Privacy
- Is WebView sandboxing sufficient? Should we use `allowFileAccess={false}`?
- Cookie isolation between providers — current approach vs per-origin stores?
- Server name visibility — can providers detect our origin?
- Injection detection — can third-party pages detect our script injections?

### 7.6 Testing & QA
- What are the top 10 test cases to run after every change?
- How to regression-test across 10+ providers without manual testing?
- Network condition testing (slow 3G, connection drop during playback)?
- Platform-specific testing checklist (Android vs iOS subtleties)?

### 7.7 User Behavior Prediction
- How to detect and preload the user's likely next action?
- Watch history analysis for content recommendations?
- Abandonment detection (user leaves before video starts — why?)
- Could we measure time-to-first-frame for each provider?

### 7.8 App Architecture
- Should we migrate from Expo managed to bare workflow for performance?
- Is Turborepo monorepo adding value or overhead at this scale?
- Would modularizing providers as separate WebViews help with memory?
- Is there a better architecture than WebView for this use case?

---

## 8. Data Flow Diagram (Abstract)

```
[User] → UI (React Native) → React Query → TMDB API (media metadata)
                                          → Embedded Provider APIs (stream URLs)

[User] → Tap "Watch" → Router → Watch Screen
                              → WebView loads {providerBaseUrl}{embedPath}
                              → Injected JS runs (fingerprint spoofing, ad blocking)
                              → Third-party page loads video player
                              → Fullscreen intercept ↔ RN orientation lock
                              → Navigation blocking ↔ prevent ad redirects
```

---

## Appendix: Avoiding Common Pitfalls

1. **Do NOT match broad keywords in DOM** ("download", "install", "app") — they hit legitimate player UI elements. Match exact strings or URLs only.
2. **Do NOT use MutationObserver with `attributes: true` on `subtree: true`** — it floods the callback on SPA pages. Use `childList: true` only, or isolate the observer to a specific subtree.
3. **Do NOT use `setInterval` for DOM sweeps shorter than 8s** — causes jank on mid-range Android devices. Prefer `setTimeout` (one-time delayed) or MutationObserver.
4. **Do NOT climb parent DOM more than 2 levels** from hidden elements — risk of hiding shared containers that include the video player.
5. **Always use `(document.head || document.documentElement)`** for style injection in `injectedJavaScriptBeforeContentLoaded` — `document.head` may not exist yet.
