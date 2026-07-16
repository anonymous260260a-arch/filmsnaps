# FilmSnaps Codebase Context

## Overview

FilmSnaps is a cross-platform streaming app for movies and TV shows. It uses embedded third-party video player iframes (providers) to stream content. The tech stack is a monorepo with a Next.js web app, an Expo React Native mobile app, and a Tauri desktop app.

**Repository:** Cross-platform streaming ecosystem — web (Next.js), mobile (Expo), desktop (Tauri)

---

## Monorepo Structure (pnpm workspaces + Turborepo)

```
filmsnaps/
├── apps/
│   ├── mobile/          # Expo React Native app (Android + iOS)
│   ├── web/             # Next.js web app (also deployed on Cloudflare)
│   └── desktop/         # Tauri desktop app
├── packages/
│   └── shared/          # @filmsnaps/shared — shared types, providers, utils, API clients
├── tooling/             # Shared build/lint config
├── docs/                # Internal docs, expert analyses, troubleshooting (gitignored)
├── package.json         # Root — pnpm workspace + turbo config
├── turbo.json
├── pnpm-workspace.yaml
└── MEMORY.md            # ← this file
```

---

## Mobile App (`apps/mobile/`)

### Stack
- **Framework:** Expo SDK 55 (managed workflow with config plugins)
- **Navigation:** expo-router (file-based routing)
- **State:** TanStack React Query + React Context
- **Storage:** AsyncStorage (watch history, bookmarks)
- **Native Modules:** Custom `player-webview` module for Android WebView overlay

### Route Structure

| Path | File | Purpose |
|------|------|---------|
| `/` | `app/(tabs)/_layout.tsx` | Tab navigator layout |
| `/` | `app/(tabs)/index.tsx` | Home screen (carousels, trending) |
| `/search` | `app/(tabs)/search.tsx` | Search media |
| `/saved` | `app/(tabs)/saved.tsx` | Bookmarked/watchlist |
| `/history` | `app/(tabs)/history.tsx` | Watch history |
| `/movie/[id]` | `app/movie/[id].tsx` | Movie detail page |
| `/tv/[id]` | `app/tv/[id].tsx` | TV show detail + episode picker |
| `/watch/[...id]` | `app/watch/[...id].tsx` | Video player (WebView with provider iframe) |
| `/download` | `app/download/` | Downloads |
| `/download2` | `app/download2/` | Alternate downloads |

### Key Components (`components/`)

| File | Purpose |
|------|---------|
| `VideoWebView.tsx` | **Core player** — WebView wrapping provider iframes, handles progress tracking, bridge communication, ad blocking, provider switching |
| `Hero.tsx` | Hero banner on home screen |
| `MediaCard.tsx` | Movie/TV show card for carousels |
| `MediaCarousel.tsx` | Horizontal scrolling carousel |
| `ProgressiveImage.tsx` | Lazy-loading image with blur placeholder |
| `FilmGrain.tsx` | Film grain overlay effect |
| `UpdateOverlay.tsx` | OTA update notification overlay |

### Native Module (`modules/player-webview/`)

Custom Expo module providing a WebView overlay wrapper for Android:

| File | Purpose |
|------|---------|
| `PlayerWebView.tsx` | React Native component wrapping the native overlay view |
| `PlayerWebviewModule.ts` | Expo module TypeScript bindings (clearAllState) |
| `PlayerWebViewOverlayView.kt` | **Core native logic** — WebView setup, shouldInterceptRequest HTML injection (bridge script into cross-origin iframes), ad blocking, browser profile configs, DNS caching, UA spoofing |
| `PlayerwebviewModule.kt` | Expo module Kotlin entry point |

Key capabilities via the native overlay:
- Bridge script injection into cross-origin child iframes via `shouldInterceptRequest`
- DNS caching for provider domains
- User-Agent spoofing (strips `; wv` WebView marker)
- Popup blocking (`onCreateWindow` returns false)
- Ad domain blocking at native level
- Provider-specific browser profile configs (nxsha, peachify, screenscape, nhdapi, chillflix, etc.)

### Library Files (`lib/`)

| File | Purpose |
|------|---------|
| `api.ts` | TMDB API client + custom async storage cache layer |
| `watchHistory.ts` | Watch history CRUD (AsyncStorage), progress tracking, resume-point logic |
| `tvUtils.ts` | TV episode helpers (getNextEpisode, season rollover) |
| `bookmarks.ts` | Bookmark CRUD (AsyncStorage) |
| `queryCache.ts` | Custom TanStack Query persistence wrapper |
| `typography.ts` | Font style definitions |
| `useDebounce.ts` | Debounce hook |
| `useTMDB.ts` | TMDB data React Query hooks |
| `useUpdateCheck.ts` | OTA update check hook |

---

## Shared Package (`packages/shared/`)

### Structure

```
packages/shared/src/
├── api/             # TMDB API client (fetch)
├── constants/       # App constants, TMDB config
├── providers/       # Provider registry (nxsha, peachify, screenscape, nhdapi, etc.)
│   ├── registry.ts  # PROVIDERS array + utilities
│   └── index.ts
├── types/           # TypeScript types (ProviderDefinition, Movie, TV, etc.)
│   ├── provider.ts
│   ├── movie.ts
│   └── index.ts
└── utils/           # Shared utilities
    ├── cn.ts        # clsx + tailwind-merge
    ├── image.ts     # TMDB image URL builder
    ├── video.ts     # Video helpers
    └── index.ts
```

### Provider System (`providers/registry.ts`)

17 defined providers, 9 currently enabled:
- **Server 1** (nxsha) — Multi language, fast
- **Server 2** (peachify) — Multi audio
- **Server 3** (screenscape) — Multi language, fast
- **Server 4** (nhdapi) — Hindi, fast (newest addition)
- **Server 5** (multiembed) — **disabled**
- **Server 6** (vidking)
- **Server 14** (vidnest)
- **Server 18** (chillflix) — Slow
- **Server 19** (toustream)
- **StreamGuide** (streamguide)

Each provider has: `id`, `name`, `displayName`, `baseUrl`, `embed` (url builders for movie/tv), optional `enabled`, `order`.

---

## Watch History System

- **Storage:** AsyncStorage under `@filmsnaps/watch-history` key
- **Key format:** `movie:123` (movies) or `tv:123:season:1:episode:3` (TV)
- **Bridge:** Progress is communicated from the provider's video player iframe → parent WebView → React Native via `postMessage`
- **Throttle:** Saves every 5% progress change OR every 15 seconds of wall clock time OR on unmount (if `currentTime > 5`)
- **Cross-origin iframe bridge:** Injected via `shouldInterceptRequest` in the native WebView overlay (not `addDocumentStartJavaScript` — that silently fails for cross-origin iframes on MediaTek Helio G35 / Android 14)

---

## Ad Blocking Strategy

Multi-layered approach:
1. **Native level** (`PlayerWebViewOverlayView.kt`): `shouldInterceptRequest` blocks requests to ad domains, `onCreateWindow` returns false to block popups
2. **Injected JavaScript** (`VideoWebView.tsx`): `window.open` sealed with `Object.defineProperty`, `showModalDialog`/`showModelessDialog` blocked, capture-phase click handler prevents `a[target="_blank"]`
3. **Network level** (`loadUrl` with headers): UA spoofing (strips `; wv`), Referer header set to provider base URL
4. **Provider-specific profiles:** Browser profile configs per provider domain

---

## Key Architecture Decisions

- **Cross-origin iframe bridge:** Uses `shouldInterceptRequest` HTML injection instead of `addDocumentStartJavaScript` (which silently fails on low-end Android devices with cross-origin iframes)
- **Provider switching:** Uses React `key` prop remount (not source prop change) for reliable WebView navigation
- **History persistence:** AsyncStorage-based (no backend), saved on progress threshold + periodic timer + unmount
- **No backend:** All content comes from third-party provider iframes; no own streaming infrastructure
- **Web ≠ Mobile:** The web app uses a server-side iframe proxy with uBlock-inspired filter engine; the mobile app uses a native WebView with direct iframe embedding

---

## Current Work — Cinematic Void Redesign

Phase 1 (shared package foundation) is complete. The shared package now has:
- **Design tokens** at `packages/shared/src/theme/tokens.ts` — colors, typography, glassmorphism, spacing
- **Storage layer** at `packages/shared/src/state/` — StorageAdapter interface + localStorage/AsyncStorage adapters + unified hooks for watchlist and watch history
- **Security script** at `packages/shared/src/security/playerGuard.ts` — pure function returning 15-layer popup/ad-blocking JS
- **Health checks** at `packages/shared/src/providers/health.ts` — provider health checking and ranking
- **Verified:** `pnpm --filter @filmsnaps/shared build` compiles cleanly

Next: Phase 2 — Web redesign (CSS variable migration, Playfair Display font, WatchClient decomposition, feature parity)

---

## Build & Run Commands

```bash
# Root (install dependencies)
pnpm install
pnpm postinstall           # builds @filmsnaps/shared

# Mobile
cd apps/mobile
npx expo start             # development server
npx expo run:android       # build + run on Android device
npx expo run:android --no-build-cache  # clean build

# Web
pnpm dev:web
pnpm build:web
pnpm cf:deploy             # deploy to Cloudflare

# Desktop
pnpm dev:desktop
pnpm build:desktop
pnpm dist:desktop          # package for distribution
```
