# Security Architecture

FilmSnaps streams content from third-party streaming providers inside embedded
webviews/iframes. Those providers inject ads, trackers, popups, and malicious
scripts into the player surface. This document is the authoritative reference
for the security stack that keeps the player functional while blocking that
behavior. It reflects the **actual implementation** — every layer named here
maps to real code.

> **Documentation contract:** this file describes what the code does today. If
> a layer's behavior changes, update this document in the same commit.

---

## Table of contents

1. [Threat model](#threat-model)
2. [The core principle](#the-core-principle)
3. [Shared building blocks](#shared-building-blocks)
4. [Desktop: R0–R8 rule cascade](#desktop-r0r8-rule-cascade)
5. [Desktop: L2–L8 defense layers](#desktop-l2l8-defense-layers)
6. [Mobile (Android/iOS) security](#mobile-androidios-security)
7. [Web security](#web-security)
8. [Configuration: `providers.json` + `filters.txt` v5](#configuration-providersjson--filterstxt-v5)
9. [Audit & diagnostics](#audit--diagnostics)
10. [Threat matrix](#threat-matrix)

---

## Threat model

| Threat                       | Example                                        | Consequence if unblocked              |
| ---------------------------- | ---------------------------------------------- | ------------------------------------- |
| **Popup / popunder ads**     | `window.open("https://ads.example")`           | New windows, redirect chains          |
| **Navigation hijack**        | `location.href = "https://ads.example"`        | Player escapes to ad page             |
| **Ad iframes / overlays**    | Injected `<iframe>` / fixed-position div       | Ads covering the video                |
| **Tracking beacons**         | `fetch`/`XHR` to ad network                    | User fingerprinting                   |
| **Malware / fake downloads** | Auto-triggered `.apk`/`.exe` download          | Drive-by install                      |
| **Service-worker abuse**     | `navigator.serviceWorker.register()`           | Request interception, push spam       |
| **Code injection**           | `eval()` / `new Function()` of packed payloads | Arbitrary script execution            |
| **WebView detection**        | `navigator.webdriver` / `window.chrome` probes | Provider blocks playback              |
| **Anti-hotlink CDN gating**  | CDN rejects requests missing `Referer`         | Stream stalls before playback         |
| **Home-page escape**         | Provider error UI "Go Home" → `provider.com/`  | Player frame escapes to provider home |

**Adversary model:** the third-party provider page is _untrusted content_. It
may run scripts we did not author, on domains we did not choose. Everything it
requests must be treated as potentially hostile until proven otherwise.

---

## The core principle

> **Block at the network/navigation layer, not through aggressive DOM
> manipulation. Let the page load normally; intercept hostile actions.**

The most effective layers run **before any page JavaScript executes** — in the
native process or the platform's request pipeline. DOM-level scriptlets and
cosmetic filters are defense-in-depth for the cases those layers miss (e.g.
same-origin ads), not the primary mechanism.

A second, load-bearing principle: **coverage must not depend on timing or on a
single delivery mechanism.** Every page must be protected _by construction_,
across reloads, cross-site navigations, process swaps, and programmatically
created frames. This is why desktop layers overlap (L5 session preload + L7b
frame sweep) and why they are idempotent behind a shared guard.

---

## Shared building blocks

All three platforms consume the same guard logic from `@filmsnaps/shared`:

| Module                                 | Purpose                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `src/security/playerGuard.ts`          | 15-layer popup/ad-blocking injection bundle (pure string builder).       |
| `src/security/scriptlets.ts`           | uBlock Origin–style anti-anti-adblock scriptlets.                        |
| `src/security/navigation-home.ts`      | Path-level home-page escape detection (pure function).                   |
| `src/providers/registry.ts`            | Provider registry — the single source of truth for provider definitions. |
| `src/theme/`, `src/state/`, `src/api/` | Shared design tokens, watch-history state, TMDB API.                     |

The player guard bundle is built by `buildAllScriptsWithScriptlets()` and
injected:

- **Mobile** — directly into the WebView via `injectedJavaScriptBeforeContentLoaded`.
- **Desktop** — baked into `provider-preload.js` at build time by
  `apps/desktop/scripts/build-provider-preload.mjs`, then delivered by the
  session preload (L5) and frame sweep (L7b).

---

## Desktop: R0–R8 rule cascade

**File:** `apps/desktop/src/security/rule-cascade.ts`

The central blocking decision-maker. Every request in the provider session
passes through `shouldBlockRequest()`. Rules are evaluated in a fixed order,
fastest-to-most-expensive, with **block rules before allow rules** where it
matters — an operator-declared always-block can never be overridden by trust or
an allowlist (`deny-by-exception`).

| Rule         | What it does                                                                                                | Why                                                                                                                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R5**       | Always-block domains (`rules.alwaysBlock.domains` in `providers.json`) — **checked first, unconditionally** | Operator-declared blocks win over any trust/allowlist (fixes `googletagmanager`/`cloudflareinsights` leaking through R0).                                                                                                                                             |
| **R6**       | Always-block path patterns (`rules.alwaysBlock.pathPatterns`) — substring match on the URL                  | Blocks ad paths that rotate domains.                                                                                                                                                                                                                                  |
| **R0 / R0b** | Session trust — allow, scoped to the verified video path                                                    | Once a host actually serves video (`.ts`, `.m3u8`, `.mp4`, disguised segments), its _video directory_ bypasses the cascade. **Path-scoped, never whole-host** — a video host may also serve ads. TTL 15 min (sliding window, MIME-based).                             |
| **R1**       | Provider allowlist + `adblockDisabled` bypass                                                               | Provider's known CDN/embed domains clear early. When a provider has `adblockDisabled: true`, the filter engine is skipped but R5–R7 still run.                                                                                                                        |
| **R2**       | Global CDN allowlist                                                                                        | Known-good CDN domains from `allowedCdnHosts`.                                                                                                                                                                                                                        |
| **R3**       | Provider embed domain                                                                                       | The provider's own hostname always loads.                                                                                                                                                                                                                             |
| **R3.5**     | Per-provider profile allowlist (`providerProfiles`)                                                         | Mobile-parity: any `script`/`iframe`/`image` whose host is **not** in the provider's profile is blocked. Rotation-proof — a rotating ad-orchestrator subdomain is blocked by definition. Never blocks the main frame or media.                                        |
| **R7a**      | Same-origin ad paths (`SAME_ORIGIN_AD_PATH`)                                                                | Blocks `/ads/`, `/banners/`, `/popup/`, `/tracking/` etc. **served from the provider's own host** — invisible to cross-origin filter rules.                                                                                                                           |
| **R4b**      | Mobile-parity URL-substring block                                                                           | Whole-URL substring trie fed from the **same `android-adblock-patterns.json`** mobile uses. Catches rotating ad orchestrators `@ghostery/adblocker` can't (their subdomains aren't in compiled lists). Guards: never blocks the main frame or video-looking requests. |
| **R4**       | `@ghostery/adblocker` FiltersEngine (migrated from `@cliqz/adblocker` — same Rust core, same API)           | Aho-Corasick O(L) matching against EasyList/EasyPrivacy/AdGuard/uBO compiled patterns from `filters.txt`.                                                                                                                                                             |
| **R7**       | Legacy `blocklist.ts` fallback                                                                              | Flat keyword/domain scan + download-URL detection; kept as a backstop.                                                                                                                                                                                                |
| **R8**       | Default allow                                                                                               | Anything that cleared every rule above loads.                                                                                                                                                                                                                         |

### Session trust granularity (R0)

`apps/desktop/src/security/session-trust.ts` — a host is **not** trusted as a
whole. Trust is recorded as `(hostname, pathPrefix)` and applies only when:

1. the request is a **media-type resource** (`media`, `video`, `audio`, `fetch`), **or**
2. the request path falls **under the verified video directory**.

Disguised HLS/DASH segments are recognized (`seg-…`, `init-…`, `chunk-…`,
`part-…` with non-video extensions like `.woff2`, `.png`, `.css`, `.js`) and
grant trust so the substring backstop (R4b) doesn't kill real streams.

---

## Desktop: L2–L8 defense layers

These are the operational layers installed across the Electron main process and
the provider `<webview>` session. **Layer numbers appear in code comments —
this table is the map.**

| Layer   | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | File                                              | Load-bearing?                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| **L2**  | R0–R8 cascade via `session.webRequest.onBeforeRequest` — runs in the main process **before any renderer JS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `request-filter.ts`                               | ✅ primary network gate                         |
| **L3**  | CSP + security headers via `onHeadersReceived` (installed at startup, before any webview exists)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `request-filter.ts` (`setupSecurityHeaders`)      | ✅ closes the "first commit had no headers" gap |
| **L4**  | Main-process navigation/popup/redirect guard: `setWindowOpenHandler` (deny all popups), `will-navigate`, `will-redirect`, + path-level home-escape guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `navigation-guard.ts`                             | ✅ cannot be bypassed by page JS                |
| **L5**  | Session-level provider preload (`session.registerPreloadScript({ type: 'frame' })`) — runs at document-start in the **main frame and every child frame**, survives cross-site navigations and process swaps                                                                                                                                                                                                                                                                                                                                                                                                                   | `preload/provider-preload.ts`                     | ✅ **primary in-page protection**               |
| **L6**  | Cosmetic CSS + engine-derived scriptlets applied by the preload (posts class/id/href tokens to the engine)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `cosmetic-filter.ts` + preload                    | ✅                                              |
| **L7**  | CDP verification — probes each live frame to _confirm_ the preload guard is active. **Does not inject** (a stethoscope, not a shield)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `provider-security.ts` (`attachProviderSecurity`) | verification only                               |
| **L7b** | Fail-closed per-frame sweep (no CDP): injects the protection bundle into `about:`/`srcdoc:`/`blob:`/`data:` hole frames, and if a committed frame lacks the guard, **stops that frame only** (never the whole webview)                                                                                                                                                                                                                                                                                                                                                                                                        | `provider-security.ts` (`verifyPreloadInFrames`)  | ✅ fail-closed                                  |
| **L8**  | HTML‑bytes injection at `document_start` via `Page.addScriptToEvaluateOnNewDocument` — injects the guard IIFE and engine‑derived cosmetic CSS before any page JS executes. **Replaces the old `Fetch` domain approach** (which paused every network request including HLS segments and caused playback stutter and Cloudflare 403s). Runs in the same debugger session as L7 verification — one attach total, zero network overhead. Defense in depth (idempotent via the GUARD sentinel): L5 session preload + L7b frame sweep + L8 HTML‑bytes injection form three independent delivery paths, any of which alone suffices. | `provider-security.ts` (`attachProviderSecurity`) | ✅ active — L5/L6/L8 triple‑guarantee           |

### L8: HTML‑bytes injection at `document_start`

L8 is now **active**, running via `Page.addScriptToEvaluateOnNewDocument` in the
same debugger session as L7 verification. This injects the guard IIFE and
engine‑derived cosmetic CSS as part of the document's HTML bytes at
document-start — before any page JS executes, with **zero network overhead** and
**zero Cloudflare 403 risk** (headers are preserved because no re-issuance is
performed).

The old `Fetch` domain approach (`session.protocol.handle` → `session.fetch()`)
is left in place as unused diagnostic code (the handler at
`html-injector.ts:147‑154`). It is retained so re‑arming is a one‑line uncomment
if a future use case strictly requires HTML‑body rewriting; but it is **not
enabled by default** because `Fetch.enable` with `urlPattern: '*'` pauses every
network request including HLS `.ts`/DASH `.m4s` segments, causing 5–20ms IPC
round‑trips per segment that destroy playback buffers and spike CPU on low-end
devices. L5 + L7b + L8 together form a triple‑guarantee: any single layer
suffices for coverage.

### Why the old `Fetch` domain is disabled

`html-injector.ts` ends with a V8 diagnostic (2026-08-04): intercepting every
`https`/`http` request and re-issuing it via `session.fetch()` from the main
process **drops the renderer-context headers Chromium adds** (`Sec-Fetch-*`,
`Accept`, `Accept-Language`, `Origin`, POST `Content-Type`). Cloudflare then
403s provider token POSTs even with a clean UA. The handler is left in place
(unused) so re-arming is a one-line uncomment. **L5 + L7b + L8** (the new
`addScriptToEvaluateOnNewDocument` approach) remain the fail‑closed gate —
protection coverage does not depend on the disabled `Fetch` domain.

### Webview lockdown

`apps/desktop/src/main.ts` — on `will-attach-webview`, only the
`persist:filmsnaps-provider` partition is accepted, and `webPreferences` are
hard-forced: `sandbox: true` (strips Node APIs from the preload scope),
`contextIsolation: false` + `nodeIntegrationInSubFrames: true` (required for the
preload to reach every frame's main world), `webSecurity: true`,
`nodeIntegration: false`, `allowRunningInsecureContent: false`, no `allowpopups`.

### Provider session lifecycle

`apps/desktop/src/security/request-filter.ts` — the provider session
(`persist:filmsnaps-provider`, `cache: false`) is **pre-created at app startup**
so R0–R8 filters, CSP, the preload, and the clean User-Agent are armed before
the first webview navigates. The `onBeforeRequest` handler is installed
**once** (idempotency guard) and reads the mutable `_currentBlockingProviderId`
so provider switches don't reinstall handlers or wipe session trust. `provider:clear`
wipes storage (cookies, localStorage, IndexedDB, service workers, cache) and trust.

The provider partition uses a **clean desktop-Chrome User-Agent** derived from
`process.versions.chrome` — Electron's default UA embeds the app identity
(`@filmsnaps/desktop/1.0.3 ... Electron/42.4.1`), which Cloudflare bot-management
flags at the edge (403 on provider token APIs → player stall).

---

## Mobile (Android/iOS) security

### Native module: `apps/mobile/modules/player-webview`

The mobile player uses a native Expo module (`PlayerWebView`) instead of the
generic `react-native-webview` for the actual provider surface.

| Component                                                     | Purpose                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `android/.../PlayerWebViewOverlayView.kt`                     | Window-overlay WebView (bypasses Fabric compositing for video), navigation gating, DOM sweeper, disable-devtool redirect blocker, provider-specific handling.                                                                               |
| `android/.../AdblockEngine.kt`                                | Native filter engine for `shouldInterceptRequest`: domain allowlist/blocklist + Aho-Corasick unified trie over `filters.txt`-derived `android-adblock-patterns.json` patterns. **Blocks at the network level, before JS.**                  |
| `android/.../BlocklistConfig.kt` / `BlocklistConfigLoader.kt` | Config schema (v5: `providers.json` + `filters.txt`) + OTA loader with Ed25519 verification (Android `java.security.KeyFactory` with Conscrypt for API 23+), ring-buffer rollback (3 configs), and 3×-failure watchdog → `heal-events.log`. |
| `ios/PlayerWebView.swift`                                     | iOS counterpart (same role).                                                                                                                                                                                                                |
| `src/PlayerWebView.tsx`                                       | React wrapper.                                                                                                                                                                                                                              |

### In-page guard bundle

`apps/mobile/components/VideoWebView.tsx` builds the consolidated injection via
`buildAllScriptsWithScriptlets()` from `@filmsnaps/shared` (15-layer guard +
uBO scriptlets + provider cosmetic CSS) and injects it through the native
module at `document-start`. A DOM sweeper (`MutationObserver` + periodic
interval) removes overlay ads and re-applies protection to frames created after
load.

### Mobile rule layers (in the overlay view)

Mirrored in Kotlin, keyed to the same `providers.json`:

- **Rule 5 / profile allowlist** — any page-facing `script`/`iframe`/`image`
  whose host is not in the provider's `providerProfiles` is blocked (rotation-proof).
  Provider profiles are rotation-proof per-embed-domain allowlists keyed by the
  provider's `embedDomains` (mobile Rule 5 parity).
- **Session trust (v5)** — MIME-type-first trust acquisition (`Content-Type` is
  `video/*`, `application/dash+xml`, `application/vnd.apple.mpegurl`, etc.) with
  a 15-minute sliding window (`trustTTLMs`, default 900000ms). Pausing playback
  does not expire trust; resuming loads the next segment without re-verification.
- **`shouldInterceptRequest` filtering** — every resource request is matched
  against the native `AdblockEngine` (allowlist → blocklist → Aho-Corasick →
  allow).
- **NavGuard server-redirect fix** — `allowServerRedirects` flag on redirect-mesh
  providers (vidsrc→viduki.net, videasy→videasy.to) lets the provider's initial
  301/302/307/308 redirect pass during the bootstrap window, instead of `ERR_FAILED`.
- **API synthetic interception** — `apiIntercepts` rules (e.g. screenscape
  `/api/ads/cycles`) short-circuit ad-orchestrator APIs with synthetic responses.
- **Cosmetic rules** — `cosmeticRules` from `providers.json` injected as static
  CSS at HTML-bytes level (L8-style), plus periodic DOM sweeper for React-created
  elements.
- **Navigation gating** — top-level navigations are vetted; `intent://` deep
  links always blocked.
- **disable-devtool neutralization** — providers ship a `disable-devtool`
  script that detects tampering and redirects to its 404 page; each detector is
  neutralized by name (DefineId, Performance, DateToString, FuncToString,
  closeWindow).
- **Home-page escape guard** — the path-level `isHomeEscape` logic ported from
  `packages/shared/src/security/navigation-home.ts`.

### iOS

`PlayerWebView.swift` implements the same protection contract for WKWebView.
Both platforms consume the shared guard bundle, so behavior is consistent.

---

## Web security

The web app (`apps/web`) is a Next.js (App Router) app. Because a browser
iframe is a sandboxed guest, web-layer protection is necessarily lighter than
native:

- **`next.config` / Netlify headers** — `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `X-DNS-Prefetch-Control`, `Permissions-Policy` (see
  `netlify.toml`).
- **Proxy routes** — `/api/player/[provider]` and `/api/[provider]/[...asset]`
  exist for proxying provider requests server-side, but the `PROXIED_PROVIDERS`
  set is **currently empty** (dormant — the proxy stack is preserved for future
  use, not active).
- **Watch page** — `apps/web/app/watch/[...id]/WatchClient.tsx` mounts provider
  embeds in a `<DesktopSecureWebview>` / sandboxed iframe with the shared
  protection script.

The web app is primarily a **discovery/UI layer**; the hardened player
experience lives in the desktop and mobile apps.

---

## Configuration: `providers.json` + `filters.txt` v5

**The config is now split into two files that travel together:**

### `providers.json` (repo root, schema v5)

- Ed25519-signed (`providers.json.sig`) — public key committed to repo, private key in `.keys/` (gitignored).
- Per-provider logic that uBO syntax can't express:
  - `embedDomains` / `cdnDomains` (exact/suffix matching)
  - `enabled`, `allowServerRedirects`, `blockHomePaths`
  - `apiIntercepts` (synthetic API responses, e.g. screenscape `/api/ads/cycles`)
  - `cosmeticRules` (CSS injected at HTML-bytes level)
  - `adblockDisabled` (true for providers whose ad scripts double as video auth)
- OTA: signed fetch on launch + every 2h; signature verified before apply; ring-buffer rollback (3 configs); 3×-failure watchdog → `heal-events.log`
- V5 schema fields: `version`, `providers[]`, `providerProfiles`, `navigationGuard`, `rules.videoDetection`, `rules.alwaysBlock`, `allowedCdnHosts`, `providerRootHosts`

### `filters.txt` (repo root)

- Standard **uBO/EasyList** syntax
- **Exact/suffix matching** only (`@@||domain^` — never substring)
- Example rules:
  ```
  @@||cloudfront.net^              # exact/suffix, not substring
  @@||viduki.net^$document       # allowlist for redirect-mesh upstreams
  ||doubleclick.net^$3p          # block 3rd-party trackers
  ##.ad-banner                   # cosmetic
  ```
- Compiled by `@filmsnaps/filter-compiler` into `compiled-engine.bin` (desktop R4)
  and `android-adblock-patterns.json` (mobile R4b/R5b).

The two files travel together and are signed by the same Ed25519 key. The app
never applies an OTA update without signature verification.

### Old `blocklist.json`

- Still present at repo root for backward compatibility.
- Read by `provider-config.ts` when `providers.json` is absent (v4 fallback).
- Deprecated: new OTA updates should only target `providers.json` + `filters.txt`.

---

## Audit & diagnostics

Security layers emit structured logs. Enable them with env vars on the desktop
app:

| Env var                | What it logs                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FILMSNAPS_AUDIT=1`    | ALLOW-side `[ReqLog]` lines (which rule let a request through — the highest-value diagnostic), `[STREAM-AUDIT]` (player stream provisioning), `[PROTECTION]` (what the injected bundle intercepted), `[NavGuard]` home-escape evaluations. |
| `FILMSNAPS_AUDITNET=1` | CDP `[NET]` request/response header samples (Referer, Cookie, Authorization) for auth-relevant requests.                                                                                                                                   |

These are opt-in; production runs quiet (only blocks are logged).

---

## Threat matrix

| Threat                    | Primary mitigation                                           | Supporting layers                       |
| ------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Popup / popunder ads      | L4 `setWindowOpenHandler` (deny)                             | JS guard `window.open` override         |
| Navigation hijack         | L4 `will-navigate`/`will-redirect`                           | JS location freeze, mobile nav gating   |
| Ad iframes / overlays     | R4b/R3.5 block + L7b hole-frame injection                    | DOM sweeper (mobile + desktop periodic) |
| Tracking beacons          | R5/R6/R4 block at network layer                              | JS fetch/XHR interception               |
| Fake downloads            | R7 `isDownloadUrl`                                           | JS download-link blocking               |
| Service-worker abuse      | Session `cache:false` + clearStorageData on close            | JS SW unregister/block                  |
| Code injection            | JS `eval`/`Function` size-gated blocking                     | R4 on fetched payloads                  |
| WebView detection         | Clean desktop-Chrome UA (desktop), CF-bypass script (mobile) | Fingerprint spoofing in guard bundle    |
| Anti-hotlink CDN gating   | `Referrer-Policy: origin` (L3) — _not_ `no-referrer`         | Provider partition UA                   |
| Home-page escape          | L4 path-level `isHomeEscape` + reload-once-then-error        | Mobile Kotlin port of the same guard    |
| Rotating ad orchestrators | R3.5 profile allowlist + R4b substring trie (rotation-proof) | Always-block R5/R6                      |
| Cross-provider tracking   | Isolated partition, `cache:false`, storage wiped on close    | Per-session trust, no cookie sharing    |
