# `@filmsnaps/desktop` — Desktop App

Electron app for Windows/macOS/Linux. Wraps the Next.js web app as a local
standalone server and provides a **hardened native player**: provider embeds
load in a **`WebContentsView` (hybrid)** on an isolated session partition with
the full R0–R8 rule cascade and L2–L8 security layers.

## Stack

- **Electron 43** main process (`src/main.ts`).
- **Next.js standalone build** of `@filmsnaps/web` (`BUILD_FOR_DESKTOP=true` →
  `.next/standalone`) spawned as a local server on a free localhost port.
- **electron-builder** for installers; **electron-updater** for auto-updates
  from GitHub Releases.
- **`@ghostery/adblocker`** FiltersEngine (adblock-rs WASM core, compiled by
  `@filmsnaps/filter-compiler`) for network-level ad blocking.

## Layout

```
src/
  main.ts                     Main process: window, IPC, WebContentsView lifecycle, L4/L7/L7b/L8 attach
  preload.ts                  Main window preload (context bridge + player:* IPC)
  preload/
    provider-preload.ts       Session-level provider preload (L5/L6) — PRIMARY in-page protection
  security/
    rule-cascade.ts           R0–R8 blocking decision-maker
    session-trust.ts          Path-scoped session trust (R0) + MIME-based trust + 15-min TTL
    request-filter.ts         webRequest filter, CSP headers (L3), provider session lifecycle, onHeadersReceived MIME trust
    navigation-guard.ts       L4 nav/popup/redirect guard + home-escape + allowServerRedirects
    provider-security.ts      L7 CDP verification + L7b fail-closed frame sweep + Page.addScriptToEvaluateOnNewDocument
    html-injector.ts          L8 CDP-Fetch HTML injection (doc_start, preserves headers, fail-closed)
    cosmetic-filter.ts        Engine-derived cosmetic CSS/scriptlets (L6)
    filter-engine.ts          @ghostery/adblocker singleton
    provider-config.ts        providers.json v5 loader + OTA config (CJS replica)
    ota-config.ts             OTA fetch + ring-buffer rollback + 3×-failure watchdog + heal-events.log
    blocklist.ts              Legacy flat blocklist fallback (R7)
    url-substring-filter.ts   Mobile-parity substring trie (R4b)
    structural-warnings.ts    Startup structural checks (Widevine, MutationObserver, pop-under)
scripts/
  build-web.mjs               Builds the web standalone bundle
  build-provider-preload.mjs  Bakes the shared guard bundle into provider-preload.js
```

## Run

```bash
# Dev (starts web dev server + Electron)
pnpm dev

# Typecheck
pnpm typecheck

# Test (security suites)
pnpm test
```

## Build

```bash
# Build + package installer (no publish)
pnpm dist

# Build + publish to GitHub Releases
GH_TOKEN=ghp_... pnpm dist:publish

# Unpacked directory only (faster iteration)
pnpm pack
```

Output goes to `apps/desktop/release/`:

- **Windows:** `FilmSnaps-Setup-<version>.exe` (NSIS)
- **macOS:** `FilmSnaps-<version>-<arch>.dmg`
- **Linux:** `FilmSnaps-<version>.AppImage`

Production builds bundle: the web standalone build (`extraResources`), the
compiled filter engine, `providers.json`, `filters.txt`, `providers.json.sig`, and Ed25519 public key.

## Security

This app is where the strongest defenses live. Read the full walkthrough in
[docs/security.md](../../docs/security.md) — specifically:

- **R0–R8 rule cascade** (`security/rule-cascade.ts`) — every provider request
  passes through it at the Chromium network layer, before any page JS runs.
- **L5 session preload** (`session.registerPreloadScript({ type: 'frame' })`) — the load-bearing in-page protection, delivered at
  document-start in every frame, surviving cross-site navigation.
- **L4 navigation guard** — popups, cross-host navigation, redirects, and
  home-page escapes blocked in the main process. **`allowServerRedirects`** for redirect-mesh providers.
- **L8 CDP-Fetch HTML injection** — rewrites every HTML response at `document_start` via CDP `Fetch` domain,
  preserves renderer headers (no Cloudflare 403), fail-closed 403 on injection failure.
- **Session trust (R0)** — MIME-type sniffing on `onHeadersReceived`, 15-min sliding TTL, path-scoped.
- **OTA config v5** — `providers.json` + `filters.txt` Ed25519-signed, ring-buffer rollback (3 configs),
  3×-failure watchdog, local `heal-events.log`.
- **Structural warnings** — `enableWidevine`, MutationObserver bookkeeping, pop-under detection at startup.

### Audit diagnostics

Run the app with `FILMSNAPS_AUDIT=1` (allow-side request log) or
`FILMSNAPS_AUDITNET=1` (CDP network header samples) to trace exactly what the
security stack allowed/blocked.

## WebContentsView Hybrid (Phase 3)

- Main owns a **single `WebContentsView`** (lazily created on first `player:open`, reused for app lifetime).
- Renderer reserves a black rect (`DesktopSecureWebview.tsx`); `ResizeObserver` → IPC `player:set-bounds`.
- Native view sits **above** the rect; React overlays (server dropdown, CPU warning, error) drive `player:set-visible=false` via `overlayActive`.
- Provider stays **main frame** → `will-navigate`/`will-redirect`/`did-fail-load` work unchanged.
- Fullscreen: `toggleFullscreen` → IPC `player:setFullscreen` → `mainWindow.setFullScreen()` + `providerViewFitToContent()`.
- Security stack (`navigation-guard`, `provider-security`, `provider-preload`) attaches to `view.webContents` — view-agnostic.

## Auto-updates

`electron-updater` checks GitHub Releases on launch, downloads updates in the
background, and prompts to restart. Publishing a new version:

1. Bump `version` in `package.json`.
2. `pnpm dist:publish` (builds web standalone + packages + uploads).
3. Tag and push (`git tag vX.Y.Z && git push origin vX.Y.Z`).
