You are taking over work on the **FilmSnaps** cross-platform streaming app. The current focus is the **Android WebView player module** (`apps/mobile/modules/player-webview`).

## What You're Solving: Provider Fallthrough / Redirect Hijacking

**User-visible bug:** When a user selects Server 2–6 in the Android app, the WebView silently switches to a different provider (usually Server 1/nxsha) after 1–3 seconds, while the React UI still shows the original selection.

**Requirement:** "No matter what if I load server 2 I should instantly see it no matter what error comes. The selected provider MUST NOT change under any circumstances."

## Root Causes (All Identified)

1. **`userInitiatedNavigation` flag leak** — `loadUrl()` bypasses `shouldOverrideUrlLoading`, flag stays `true`, leaks into first in-page nav
2. **`Sec-Fetch-Dest` unreliable on Android WebView** — Often `null` for iframe loads, so cross-provider iframe documents weren't blocked
3. **`clearAllState()` race condition** — Fire-and-forget clear meant old provider's IndexedDB/cookies contaminated new load (caused zxcstream↔cinemaos ping-pong)
4. **Provider embed pages redirect** — Server-side 302 or client-side `window.location` to other providers

## What's Been Implemented (P0 — Complete & Compiling)

### Q1: Session-Locked Allowlist (`PlayerWebViewOverlayView.kt`)
- Removed `userInitiatedNavigation` entirely
- Added `sessionLock`, `lockedRootHost`, `lockedAllowedHosts`
- Added `PROVIDER_ROOT_HOSTS` (all known provider hostnames)
- Added `loadProviderUrl(url)` — locks allowlist **then** calls `loadUrl()`
- `shouldOverrideUrlLoading` now blocks ANY main-frame nav to host ∉ session allowlist
- `sourceUri` setter now calls `loadProviderUrl()`

### Q2: Cross-Provider Iframe Blocking (`PlayerWebViewOverlayView.kt`)
- Policy check at **TOP** of `shouldInterceptRequest` (before R1–R8)
- Blocks non-main-frame requests to other provider root hosts ∉ session allowlist
- Added `looksLikeDocumentLoad()` — uses `Accept` header (`text/html`, `xhtml`) + URL patterns as fallback when `Sec-Fetch-Dest` is null
- Added `emptyDocumentResponse()` / `emptyResourceResponse()` — 200 OK empty responses (silent block)

### Q6: Await `clearAllState()` Sequencing (`VideoWebView.tsx`)
```typescript
const switchProvider = async (newId: string) => {
  // ... UI state reset ...
  try { await clearAllState(); } catch { /* best-effort */ }
  setProviderId(newId);
  setMountGen((g) => g + 1);  // remount AFTER state cleared
};
```

## What's NOT Done (P1/P2)

| Item | Priority |
|------|----------|
| Pre-initialized WebViews per provider (eliminate remount) | P1 |
| Guard script re-injection on pool reuse (`addDocumentStartJavaScript` staleness) | P1 |
| `Sec-Fetch-Dest` polyfill via `shouldInterceptRequest` | P1 |
| Provider health pre-check / ranking | P2 |
| Web player (`SecureIframe`) parity | P2 |

## Verification
```bash
pnpm build:shared          # ✅ TypeScript
pnpm build:filters         # ✅ TypeScript
cd apps/mobile/android && ./gradlew :player-webview:compileDebugKotlin  # ✅ Kotlin
```

## Key Files to Know
- `apps/mobile/modules/player-webview/android/.../PlayerWebViewOverlayView.kt` — Main native logic
- `apps/mobile/components/VideoWebView.tsx` — React provider switching
- `packages/shared/src/providers/registry.ts` — Provider URL templates
- `expert-review-provider-fallthrough.md` — Full expert consultation doc

## Test Checklist
1. `cd apps/mobile && npx expo run:android`
2. Open TV show with multiple providers
3. Rapidly switch Server 2, 3, 5, 6
4. Verify: selected provider loads and **stays** (no silent swap)
5. Check logcat for `[AB] HIJACK BLOCK`, `P0:cross-provider-doc`, `P0:cross-provider-resource`