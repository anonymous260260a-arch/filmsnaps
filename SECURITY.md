# Security

FilmSnaps loads content from third-party streaming providers inside embedded
webviews/iframes. The security stack blocks ads, trackers, popups, and
malicious scripts while keeping the player functional.

## The full reference

**Read [docs/security.md](docs/security.md)** for the authoritative, code-mapped
walkthrough of every security layer. This file is a summary pointer.

## Summary

### Threat model

The provider page is **untrusted content**. It may run scripts we did not
author on domains we did not choose. Every request is treated as hostile until
proven otherwise.

### Core principle

Block at the **network/navigation layer** before page JavaScript runs, and make
coverage **timing-independent** — every page is protected by construction,
across reloads, cross-site navigations, and process swaps.

### Desktop (`apps/desktop`)

- **R0–R8 rule cascade** (`security/rule-cascade.ts`) — every provider request
  passes through it at the Chromium network layer. Always-block (R5/R6) wins
  over any trust/allowlist; session trust (R0) is path-scoped and earned only
  by serving video.
- **L2–L8 layers** — network filter (L2), CSP headers (L3) + MIME-type trust,
  main-process nav/popup/redirect guard (L4) + `allowServerRedirects`, session-level
  preload (L5, the load-bearing in-page protection), cosmetic filter (L6),
  CDP `Fetch` HTML injection (L8, replaces disabled `session.protocol.handle` that
  dropped renderer headers → Cloudflare 403), fail-closed frame sweep (L7b),
  and CDP `Page.addScriptToEvaluateOnNewDocument`.
- **WebContentsView hybrid** (Phase 3): main-owned singleton view, renderer
  reserves black rect, all overlays driven by `overlayActive`.
- **Signed OTA config v5** — `providers.json` + `filters.txt`, Ed25519-signed,
  ring-buffer rollback (3 configs), 3×-failure watchdog → local `heal-events.log`.
- **Structural warnings** — `enableWidevine`, MutationObserver bookkeeping,
  pop-under detection at startup.
- **Visibility hardening** — `overlayActive` state in `PlayerProvider` →
  `DesktopSecureWebview` `setVisible()` — server dropdown, CPU warning, error
  overlays hide native view.

### Mobile (`apps/mobile`)

- Native `PlayerWebView` module: `shouldInterceptRequest` filtering
  (`AdblockEngine.kt`), navigation gating, DOM sweeper, disable-devtool
  neutralization, home-escape guard.
- Shared guard bundle (15 layers + uBO scriptlets) injected at document-start.

### Web (`apps/web`)

- Standard security headers (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`).
- The hardened player experience lives in desktop/mobile; the web app is
  primarily a discovery/UI layer.

### Configuration

`providers.json` + `filters.txt` v5 (repo root) are the single source of truth
for providers and blocking rules, Ed25519-signed for OTA.

- **`providers.json`**: schema v5, Ed25519-signed (`providers.json.sig`), per-provider
  logic (`embedDomains`, `cdnDomains`, `enabled`, `allowServerRedirects`,
  `blockHomePaths`, `apiIntercepts`, `cosmeticRules`, `adblockDisabled`).
- **`filters.txt`**: standard uBO/EasyList syntax, exact/suffix matching only
  (`@@||domain^` — never substring), compiled into `compiled-engine.bin` (desktop R4)
  and `android-adblock-patterns.json` (mobile R4b/R5b).
- Backward-compatible: `blocklist.json` still read when `providers.json` absent (v4 fallback).
- OTA: fetch on launch + every 2h, signature verified before apply, ring-buffer
  rollback (3 configs), 3×-failure watchdog → local `heal-events.log`.

After editing `providers.json` + `filters.txt`, run:

- `pnpm build:filters` — regenerate compiled engine artifacts
- `pnpm sign:providers` — sign providers.json

## Reporting a vulnerability

This is a private project. If you discover a security issue, open an issue or
PR describing the problem rather than disclosing it publicly.

## No-warranty note

FilmSnaps blocks ads and trackers. The provider pages it embeds are third-party
content; security guarantees apply to FilmSnaps' own layers, not to the
providers' servers or the video streams themselves.
