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
  over any trust/allowlist; session trust (R0) is path-scoped and earned only by
  serving video.
- **L2–L8 layers** — network filter (L2), CSP headers (L3), main-process nav/
  popup/redirect guard (L4), session-level preload (L5, the load-bearing in-page
  protection), cosmetic filter (L6), CDP verification (L7, stethoscope only),
  fail-closed frame sweep (L7b), and network HTML injection (L8, **disabled** —
  see the doc).
- **Isolated provider partition** with a clean desktop-Chrome UA, no cache,
  storage wiped on close.

### Mobile (`apps/mobile`)

- Native `PlayerWebView` module: `shouldInterceptRequest` filtering
  (`AdblockEngine.kt`), navigation gating, DOM sweeper, disable-devtool
  neutralization, home-escape guard.
- Shared guard bundle (15 layers + uBO scriptlets) injected at document-start.

### Web (`apps/web`)

- Standard security headers (`netlify.toml` / Next.js).
- The hardened player experience lives in desktop/mobile; the web app is
  primarily a discovery/UI layer.

## Configuration

`blocklist.json` (repo root) is the single source of truth for providers and
blocking rules. After editing it, run `pnpm build:filters` to regenerate the
compiled adblock engine and mobile pattern artifacts.

## Reporting a vulnerability

This is a private project. If you discover a security issue, open an issue or
PR describing the problem rather than disclosing it publicly.

## No-warranty note

FilmSnaps blocks ads and trackers. The provider pages it embeds are third-party
content; security guarantees apply to FilmSnaps' own layers, not to the
providers' servers or the video streams themselves.
