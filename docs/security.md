# Security Architecture

FilmSnaps streams content from third-party streaming providers inside embedded
webviews/iframes. Those providers inject ads, trackers, popups, and malicious
scripts into the player surface. This document is the authoritative reference for
the security stack that keeps the player functional while blocking that behavior.
It reflects the **actual implementation** — every layer named here maps to real
code.

> **Documentation contract:** this file describes what the code does today. If a
> layer's behavior changes, update this document in the same commit.

---

## Threat model

| Threat                       | Example                                        | Consequence if unblocked               |
| ---------------------------- | ---------------------------------------------- | -------------------------------------- |
| **Popup / popunder ads**     | `window.open("https://ads.example")`           | New windows, redirect chains           |
| **Navigation hijack**        | `location.href = "https://ads.example"`        | Player escapes to ad page              |
| **Ad iframes / overlays**    | Injected `<iframe>` / fixed-position div       | Ads covering the video                 |
| **Tracking beacons**         | `fetch`/`XHR` to ad network                    | User fingerprinting                    |
| **Malware / fake downloads** | Auto-triggered `.apk`/`.exe` download          | Drive-by install                       |
| **Code injection**           | `eval()` / `new Function()` of packed payloads | Arbitrary script execution             |
| **Tampered configuration**   | Edited `providers.json` / `filters.txt`        | Attacker-chosen blocking and providers |
| **Tampered update**          | Replaced installer on the delivery path        | Arbitrary code on the user's machine   |

**Adversary model:** the third-party provider page is _untrusted content_. It may
run scripts we did not author, on domains we did not choose. Everything it
requests is treated as potentially hostile until proven otherwise.

---

## The core principle

> **Block at the network layer first. Let the page load normally; intercept
> hostile requests.**

The load-bearing layer runs **before any page JavaScript executes**, in the
WebView2 request pipeline. Cosmetic rules and scriptlets are defense-in-depth for
what the network layer cannot see (same-origin ads), not the primary mechanism.

---

## Desktop (`apps/desktop-tauri`)

### Network filtering

`src-tauri/src/adblock/hook.rs` attaches to the provider webview after it is
created and registers `AddWebResourceRequestedFilter("*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)`.
Every request is checked against the `adblock` engine built from `filters.txt`
plus the provider host rules; blocked requests are answered with a **403 before
they leave the process**, so no page script can observe or bypass the decision.

If the hook cannot be attached the app logs
`[adblock] network filtering unavailable: <reason>` and keeps running without
network blocking. That is a visible failure, not a silent one.

### Cosmetic rules and scriptlets

`src-tauri/src/adblock/inpage.rs` builds an initialization script from the same
engine and injects it into the provider webview, so `##selector` rules and
host-scoped cosmetic CSS are in place at document-start. `cosmetic.rs` turns the
engine's resources into CSS text and JS string literals; nothing is interpolated
unescaped.

### Privilege isolation

- The `electronAPI` bridge is injected **only** into the main webview
  (`src-tauri/src/bridge.rs`).
- `capabilities/default.json` grants permissions to the `main` window and webview
  only. The provider webview has no capability, no IPC surface and no access to
  any command.
- `withGlobalTauri` is `false`, so no Tauri API is exposed on any page's `window`
  beyond the bridge.
- There is no Node.js runtime in the renderer; file and network work happens in
  Rust behind explicit commands.

### Configuration integrity

`src-tauri/src/config.rs` verifies `providers.json` against `providers.json.sig`
with Ed25519 at startup:

- Signature present and valid → config loads.
- Signature present and invalid → `ConfigError::BadSignature`, the app refuses to
  load a tampered config.
- No public key in the bundle → loads with
  `[config] no Ed25519 public key found — providers.json is NOT signature-verified`
  printed to stderr, which is visible in a terminal but easy to miss. The public
  key is bundled, so a packaged build should never take this path.

### Update integrity

Updates are signed with the minisign key whose public half is pinned in
`tauri.conf.json` (`plugins.updater.pubkey`). An artifact that does not verify is
rejected; the failure appears as `[updater] download failed: <reason>`. Updates
are fetched over HTTPS from a fixed GitHub release tag.

### Proxied API requests

`api_fetch` in `src-tauri/src/commands.rs` proxies Worker calls that the page
cannot make directly because of CORS:

- Only `http://` and `https://` URLs are accepted.
- `origin`, `referer`, `host` and `content-length` headers are stripped so the
  upstream applies neither a second CORS check nor a spoofed host.
- Responses to `/api/player/direct` are filtered for expired presigned links
  (`src-tauri/src/expiry.rs`) before the page sees them.

### Known gaps

These are real and deliberate, not oversights:

| Gap                                                | Consequence                                                                  | Why it is acceptable for now                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| No CSP (`"csp": null` in `tauri.conf.json`)        | An XSS in the bundled UI would not be mitigated by a policy                  | The UI is a first-party static export with no user-authored content; the provider page never loads the app's scripts |
| `api_fetch` accepts any host                       | The proxy can reach any host the app can                                     | It is driven only by first-party code; adding a host allowlist is the next hardening step                            |
| No session trust or R0–R8 cascade                  | There is no allow/deny cascade beyond the filter engine; no CDP verification | The Electron app's cascade was removed with it. Network blocking plus cosmetic rules is the shipped model            |
| Provider webview shares the app's WebView2 profile | Cookies and storage span providers                                           | Simpler than a partition; the provider page has no IPC capability either way                                         |

### Network-facing user agent

Requests from the app identify themselves as
`FilmSnaps/<version>` (or a desktop-Chrome UA for provider page loads) so the
Worker and providers do not see a browser string that misrepresents the client.

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
`buildAllScriptsWithScriptlets()` from `@filmsnaps/shared` (15-layer guard + uBO
scriptlets + provider cosmetic CSS) and injects it through the native module at
`document-start`. A DOM sweeper (`MutationObserver` + periodic interval) removes
overlay ads and re-applies protection to frames created after load.

### Mobile rule layers (in the overlay view)

Mirrored in Kotlin, keyed to the same `providers.json`:

- **Rule 5 / profile allowlist** — any page-facing `script`/`iframe`/`image`
  whose host is not in the provider's `providerProfiles` is blocked
  (rotation-proof). Provider profiles are per-embed-domain allowlists keyed by
  the provider's `embedDomains`.
- **Session trust (v5)** — MIME-type-first trust acquisition (`Content-Type` is
  `video/*`, `application/dash+xml`, `application/vnd.apple.mpegurl`, etc.) with a
  15-minute sliding window (`trustTTLMs`, default 900000ms). Pausing playback does
  not expire trust.
- **`shouldInterceptRequest` filtering** — every resource request is matched
  against the native `AdblockEngine` (allowlist → blocklist → Aho-Corasick →
  allow).
- **NavGuard server-redirect fix** — `allowServerRedirects` flag on redirect-mesh
  providers (vidsrc→viduki.net, videasy→videasy.to) lets the provider's initial
  301/302/307/308 redirect pass during the bootstrap window instead of `ERR_FAILED`.
- **API synthetic interception** — `apiIntercepts` rules (e.g. screenscape
  `/api/ads/cycles`) short-circuit ad-orchestrator APIs with synthetic responses.
- **Cosmetic rules** — `cosmeticRules` from `providers.json` injected as static CSS
  at HTML-bytes level, plus a periodic DOM sweeper for React-created elements.
- **Navigation gating** — top-level navigations are vetted; `intent://` deep links
  always blocked.
- **disable-devtool neutralization** — providers ship a `disable-devtool` script
  that detects tampering and redirects to its 404 page; each detector is
  neutralized by name.
- **Home-page escape guard** — the path-level `isHomeEscape` logic from
  `packages/shared/src/security/navigation-home.ts`.

---

## Web security

The web app (`apps/web`) is a Next.js (App Router) app. Because a browser iframe
is a sandboxed guest, web-layer protection is necessarily lighter than native:

- **`next.config` / Netlify headers** — `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `X-DNS-Prefetch-Control`, `Permissions-Policy` (see
  `netlify.toml`).
- **Provider iframe CSP** — the watch page (`apps/web/app/watch/WatchClient.tsx`)
  mounts provider embeds in a sandboxed cross-origin iframe whose `csp=` attribute
  comes from `lib/movieProviders/cspBuilder.ts` (`buildIframeCSP`), enforcing
  `worker-src 'none'`, restricted `connect-src`, and `object-src 'none'` in the
  browser.
- **Watch page** — `apps/web/app/watch/WatchClient.tsx` mounts provider embeds in
  a `<DesktopSecureWebview>` / sandboxed iframe with the shared protection script.

The web app is primarily a **discovery/UI layer**; the hardened player experience
lives in the desktop and mobile apps.

---

## Configuration: `providers.json` + `filters.txt` v5

### `providers.json` (repo root, schema v5)

- Ed25519-signed (`providers.json.sig`) — public key committed to the repo,
  private key in `.keys/` (gitignored).
- Per-provider logic that uBO syntax cannot express: `embedDomains` /
  `cdnDomains`, `enabled`, `allowServerRedirects`, `blockHomePaths`,
  `apiIntercepts`, `cosmeticRules`, `adblockDisabled`.
- **Anime providers** (e.g. **MegaPlay**) are `animeOnly` — their embed URLs are
  keyed by **MAL/AniList IDs**, not TMDB. They are excluded from movie/TV pickers
  and selected only in anime sessions. MegaPlay relies on a referer-presence gate
  on its 410 path, so the player keeps the provider base URL as the referrer and
  falls back to the alternate ID space on a 410.
- V5 schema fields: `version`, `providers[]`, `providerProfiles`,
  `navigationGuard`, `rules.videoDetection`, `rules.alwaysBlock`,
  `allowedCdnHosts`, `providerRootHosts`.

### `filters.txt` (repo root)

- Standard **uBO/EasyList** syntax.
- **Exact/suffix matching** only (`@@||domain^` — never substring).
- Compiled by `@filmsnaps/filter-compiler` into `android-adblock-patterns.json`
  for the mobile engine. The desktop app parses `filters.txt` directly in Rust.

---

## Verifying a build

Checks that do not need a provider page:

1. Launch from a terminal and confirm the config loaded without a
   `NOT signature-verified` line.
2. Confirm `[adblock] network filtering unavailable` does **not** appear; if it
   does, network blocking is off and cosmetic rules are the only protection.
3. Confirm the provider webview cannot call IPC: `src-tauri/capabilities/default.json`
   lists only the `main` window and webview.

---

## Threat matrix

| Threat                  | Desktop mitigation                                                   | Mobile mitigation                   |
| ----------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| Popup / popunder ads    | `window.open` neutralised in the provider page                       | Navigation gating + guard bundle    |
| Navigation hijack       | Provider webview has no IPC; navigation goes where the page sends it | Kotlin nav gating + `isHomeEscape`  |
| Ad iframes / overlays   | Cosmetic CSS at document-start                                       | DOM sweeper + cosmetic CSS          |
| Tracking beacons        | `WebResourceRequested` 403 at the network layer                      | `shouldInterceptRequest` engine     |
| Fake downloads          | Not fetched — the provider page cannot reach the app                 | Download-URL blocking               |
| Code injection          | Provider page has no capability or bridge access                     | Guard bundle + scriptlets           |
| Tampered configuration  | Ed25519 signature over `providers.json`                              | Ed25519-verified OTA loader         |
| Tampered update         | minisign public key pinned in `tauri.conf.json`                      | Platform app signing                |
| Cross-provider tracking | Shared WebView2 profile (known gap)                                  | Single provider surface per session |
