# `@filmsnaps/desktop` — Desktop App

Electron app for Windows/macOS/Linux. Wraps the Next.js web app as a local
standalone server and provides a **hardened native player**: provider embeds
load in a `<webview>` on an isolated session partition with the full R0–R8
rule cascade and L2–L8 security layers.

## Stack

- **Electron 43** main process (`src/main.ts`).
- **Next.js standalone build** of `@filmsnaps/web` (`BUILD_FOR_DESKTOP=true` →
  `.next/standalone`) spawned as a local server on a free localhost port.
- **electron-builder** for installers; **electron-updater** for auto-updates
  from GitHub Releases.
- **`@cliqz/adblocker`** FiltersEngine (compiled by `@filmsnaps/filter-compiler`)
  for network-level ad blocking.

## Layout

```
src/
  main.ts                     Main process: window, IPC, webview lockdown, L4/L7/L7b attach
  preload.ts                  Main window preload (context bridge)
  preload/
    provider-preload.ts       Session-level provider preload (L5/L6) — PRIMARY in-page protection
  security/
    rule-cascade.ts           R0–R8 blocking decision-maker
    session-trust.ts          Path-scoped session trust (R0) + video detection
    request-filter.ts         webRequest filter, CSP headers (L3), provider session lifecycle
    navigation-guard.ts       L4 nav/popup/redirect guard + home-escape guard
    provider-security.ts      L7 CDP verification + L7b fail-closed frame sweep
    html-injector.ts          L8 network HTML injection — currently DISABLED
    cosmetic-filter.ts        Engine-derived cosmetic CSS/scriptlets (L6)
    filter-engine.ts          @cliqz/adblocker singleton
    provider-config.ts        blocklist.json loader (CJS replica of @filmsnaps/adblock-config)
    blocklist.ts              Legacy flat blocklist fallback (R7)
    url-substring-filter.ts   Mobile-parity substring trie (R4b)
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
compiled filter engine, and `blocklist.json`.

## Security

This app is where the strongest defenses live. Read the full walkthrough in
[docs/security.md](../../docs/security.md) — specifically:

- **R0–R8 rule cascade** (`security/rule-cascade.ts`) — every provider request
  passes through it at the Chromium network layer, before any page JS runs.
- **L5 session preload** — the load-bearing in-page protection, delivered at
  document-start in every frame, surviving cross-site navigation.
- **L4 navigation guard** — popups, cross-host navigation, redirects, and
  home-page escapes blocked in the main process.
- **L8 is disabled** — `html-injector.ts` protocol interception is a V8
  diagnostic; re-arming is one line, but see the file for why it's off.

### Audit diagnostics

Run the app with `FILMSNAPS_AUDIT=1` (allow-side request log) or
`FILMSNAPS_AUDITNET=1` (CDP network header samples) to trace exactly what the
security stack allowed/blocked.

## Auto-updates

`electron-updater` checks GitHub Releases on launch, downloads updates in the
background, and prompts to restart. Publishing a new version:

1. Bump `version` in `package.json`.
2. `pnpm dist:publish` (builds web standalone + packages + uploads).
3. Tag and push (`git tag vX.Y.Z && git push origin vX.Y.Z`).
