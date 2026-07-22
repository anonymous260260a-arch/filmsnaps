# FilmSnaps — Agent Handoff Context

## Project Overview
**FilmSnaps** is a cross-platform streaming app (Web + Mobile + Desktop) with a unified "Cinematic Void" design system. This handoff focuses on the **Android WebView player module** (`apps/mobile/modules/player-webview`).

---

## The Problem We're Solving: Provider Fallthrough / Redirect Hijacking

When a user selects a streaming provider (Server 2–6) in the Android app, the WebView **silently switches to a different provider** (typically Server 1 / nxsha) after 1–3 seconds, while the React UI still shows the original provider as "selected."

| User Action | Observed Behavior |
|-------------|-------------------|
| Select Server 2 (peachify) | Shows peachify ~1s → nxsha loads |
| Select Server 3 (screenscape) | Shows screenscape ~1–3s → nxsha loads |
| Select Server 4 (nhdapi) | Slow 2–3s switch, but stays |
| Select Server 5 (zxcstream) | Loads zxcstream → 1s later cinemaos → 1s later zxcstream again |
| Select Server 6 (cinemaos) | Loads cinemaos → 1s later zxcstream |

**Requirement:** "No matter what if I load server 2 I should instantly see it no matter what error comes. The selected provider MUST NOT change under any circumstances."

---

## Root Causes Identified

| # | Root Cause | Location |
|---|------------|----------|
| 1 | **`userInitiatedNavigation` flag leak**: `loadUrl()` bypasses `shouldOverrideUrlLoading`, so the flag stays `true` and leaks into the first in-page navigation, allowing hijacks | `PlayerWebViewOverlayView.kt` |
| 2 | **`Sec-Fetch-Dest` unreliable on Android WebView**: Often `null` for iframe loads, so heuristic blocking (R4/R5) was skipped, allowing cross-provider iframe documents | `PlayerWebViewOverlayView.kt: shouldInterceptRequest` |
| 3 | **`clearAllState()` race condition**: Fire-and-forget cookie/IndexedDB clear meant old provider's `localStorage`/`IndexedDB` persisted into new load, causing zxcstream↔cinemaos ping-pong via stored "preferred source" keys | `VideoWebView.tsx: switchProvider` |
| 4 | **Provider embed pages redirect**: Server-side 302 or client-side `window.location` to other providers | Provider embed pages |

---

## Architecture (Key Files)

```
apps/mobile/
├── components/VideoWebView.tsx          # React player, provider switching logic
├── modules/player-webview/
│   ├── src/PlayerWebView.tsx            # Native module wrapper (Expo)
│   ├── src/PlayerWebviewModule.ts       # clearAllState() bridge
│   └── android/.../PlayerWebViewOverlayView.kt   # <-- MAIN NATIVE LOGIC
│       ├── shouldOverrideUrlLoading()   # Main-frame navigation blocking
│       ├── shouldInterceptRequest()     # Subresource/iframe blocking (R1–R8)
│       ├── loadProviderUrl()            # NEW: locks session allowlist
│       └── addDocumentStartJavaScript   # Guard script injection
packages/shared/
├── src/providers/registry.ts            # Provider embed URL templates
└── src/security/playerGuard.ts          # Shared guard script (injected)
```

**Provider Registry** (`packages/shared/src/providers/registry.ts`):
```typescript
// Server 1 — nxsha       { baseUrl: 'https://web.nxsha.app', embed: { tv: `/embed/tv/${id}` } }
// Server 2 — peachify    { baseUrl: 'https://peachify.top/embed', embed: { tv: `/tv/${id}` } }
// Server 3 — screenscape { baseUrl: 'https://screenscape.me/embed', embed: { tv: `?tmdb=${id}` } }
// Server 4 — nhdapi      { baseUrl: 'https://nhdapi.com', embed: { tv: `/embed/tv/${id}` } }
// Server 5 — zxcstream   { baseUrl: 'https://zxcstream.xyz', embed: { tv: `/player/tv/${id}` } }
// Server 6 — cinemaos    { baseUrl: 'https://cinemaos.live', embed: { tv: `/tv/watch/${id}` } }
```

---

## What We Implemented (P0 — Complete & Compiling)

### Q1: Session-Locked Allowlist (replaces `userInitiatedNavigation`)
**File:** `PlayerWebViewOverlayView.kt`

- **Removed** `userInitiatedNavigation` field entirely
- **Added** session-locked fields:
  ```kotlin
  private val sessionLock = Any()
  private var lockedRootHost: String? = null
  private var lockedAllowedHosts: Set<String> = emptySet()
  ```
- **Added** `PROVIDER_ROOT_HOSTS` companion object (all known provider hostnames)
- **Added** `loadProviderUrl(url: String)` — locks allowlist **then** calls `loadUrl()`
- **Rewrote** `shouldOverrideUrlLoading`: blocks ANY main-frame navigation to host ∉ `lockedAllowedHosts`
- **Changed** `sourceUri` setter to call `loadProviderUrl()` instead of `loadUrl()`

### Q2: Cross-Provider Iframe Blocking (runs FIRST in `shouldInterceptRequest`)
**File:** `PlayerWebViewOverlayView.kt`

- Policy check at **TOP** of `shouldInterceptRequest` (before R1–R8, before bridge injection)
- Blocks non-main-frame requests to other provider root hosts ∉ session allowlist
- **Added** `looksLikeDocumentLoad(request)` — uses `Accept` header (`text/html`, `xhtml`) + URL patterns as fallback when `Sec-Fetch-Dest` is null
- **Added** `emptyDocumentResponse()` / `emptyResourceResponse()` — 200 OK empty responses (silent block, no error signals)

### Q6: Await `clearAllState()` Sequencing
**File:** `apps/mobile/components/VideoWebView.tsx`

```typescript
const switchProvider = async (newId: string) => {
  setLoading(true); setError(null); setShowPicker(false);
  navigationChainRef.current = new Set();
  pageLoadedRef.current = false;
  navigationGenRef.current += 1;
  navigationAttemptsRef.current = 0;
  // ... startAt logic ...

  try { await clearAllState(); } catch { /* best-effort */ }
  setProviderId(newId);
  setMountGen((g) => g + 1);  // forces WebView remount AFTER state cleared
};
```

---

## What We Did NOT Implement (P1 / Future)

| Item | Description | Priority |
|------|-------------|----------|
| **Pre-initialized WebViews per provider** | Keep N WebViews (one per provider) instead of pool recycling — eliminates remount cost | P1 |
| **Guard script re-injection on pool reuse** | `addDocumentStartJavaScript` scripts persist and become stale; need to clear/re-register on provider switch | P1 |
| **`Sec-Fetch-Dest` polyfill** | Inject header via `shouldInterceptRequest` for more reliable resource-type detection | P1 |
| **Provider health pre-check** | Rank providers by health/latency before showing picker (partially in shared `health.ts`) | P2 |
| **Desktop/Web parity** | Web player (`SecureIframe`) needs equivalent cross-origin blocking | P2 |

---

## Verification Status

| Build Target | Status |
|--------------|--------|
| `pnpm build:shared` (TypeScript) | ✅ PASS |
| `pnpm build:filters` (TypeScript) | ✅ PASS |
| `./gradlew :player-webview:compileDebugKotlin` | ✅ PASS |

**Note:** Mobile TypeScript (`npx tsc --noEmit`) shows pre-existing errors unrelated to these changes (`LinearGradient` style props, missing `pickOptimalSize`, `queryCache` types).

---

## How to Test (Manual)

1. Build and run the Android app: `cd apps/mobile && npx expo run:android`
2. Open a TV show with multiple providers
3. Switch between Server 2, 3, 5, 6 rapidly
4. **Expected:** Selected provider loads and **stays** — no silent swap to nxsha/cinemaos/zxcstream
5. Check logcat for `[AB] HIJACK BLOCK` and `P0:cross-provider-doc` / `P0:cross-provider-resource` entries

---

## Key Log Tags for Debugging

```kotlin
// Navigation blocking
"[AB] HIJACK BLOCK (not in session allowlist): ..."
// Cross-provider resource blocking
"BLOCK P0:cross-provider-doc host=... dest=... url=..."
"BLOCK P0:cross-provider-resource host=... dest=... url=..."
// Session lock
"OVERLAY loadProviderUrl host=... allowedSize=..."
```

---

## Expert Review Document
Full architecture context, 6 key questions, and expert recommendations:
`expert-review-provider-fallthrough.md`

---

## Design System Context (Separate Track)
Phases 1–3 of "Cinematic Void" redesign are complete:
- Shared tokens, storage, security scripts (`packages/shared`)
- Web redesign with Playfair Display, player decomposition, history page
- Mobile color migration, `VideoWebView` 2082→707 lines, CastCarousel/TrailerModal

This handoff is **only** for the provider fallthrough fix. The redesign work is in separate branches/PRs.