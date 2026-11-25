# Architecture

How the FilmSnaps monorepo fits together: the four apps, the shared packages,
the data flow for content discovery and playback, and how builds/deploys work.

> **Documentation contract:** this describes the repository as it exists. If the
> structure changes, update this file in the same commit.

---

## Repository layout

```
filmsnaps/
├── apps/
│   ├── web/                  @filmsnaps/web   — Next.js web app (discovery + watch UI)
│   ├── desktop-tauri/        @filmsnaps/desktop-tauri — Windows desktop app (Tauri + in-process libmpv)
│   └── mobile/               @filmsnaps/mobile — React Native / Expo app (Android + iOS)
├── packages/
│   ├── shared/               @filmsnaps/shared — shared UI logic, security bundles, state, providers
│   ├── adblock-config/       @filmsnaps/adblock-config — providers.json + filters.txt v5 schema + validation
│   └── filter-compiler/      @filmsnaps/filter-compiler — @ghostery/adblocker engine + mobile pattern export
├── providers.json             v5 config (providers) — single source of truth, Ed25519-signed
├── providers.json.sig         Ed25519 signature over providers.json
├── filters.txt                v5 config (uBO/EasyList rules) — compiled at build time
├── blocklist.json            Legacy v4 fallback (backward compat)
├── pnpm-workspace.yaml       Workspace definition (apps/* + packages/*)
└── turbo.json                Turborepo pipeline config
```

## Apps

### `apps/web` — Next.js web app

- **Framework:** Next.js 16 (App Router), TypeScript, Tailwind CSS.
- **Role:** the primary content-discovery surface — trending lists, search,
  watchlists, watch-history, legal/DMCA pages.
- **Player:** mounts provider embeds in sandboxed iframes; the hardened player
  lives in the desktop/mobile apps.
- **Deploys:** Cloudflare Pages (OpenNext) via `.github/workflows/cloudflare.yml`
  and Netlify via `.github/workflows/netlify.yml` + `netlify.toml`.
- **Key dirs:** `app/` (routes + API routes), `components/`, `lib/`
  (TMDB client, `movieProviders/`), `hooks/`.
- **Auth:** none. The web app is fully anonymous (watchlist/history stored
  locally). The old `AuthProvider` + `/auth` + `/reset-password` scaffolding was
  removed (see [ADR 0002](adr/0002-auth-removal.md)).
- **Provider embeds:** no server-side proxy. Provider players load in sandboxed
  cross-origin iframes with a parent-enforced CSP from
  `lib/movieProviders/cspBuilder.ts` (`buildIframeCSP`). The desktop/mobile apps
  enforce the equivalent protection natively.

### `apps/desktop-tauri` — desktop app (Windows)

- **Stack:** Tauri v2 (WebView2) + the Next.js static export + in-process libmpv
  loaded at runtime.
- **Role:** the desktop product. Installs as "FilmSnaps"
  (`com.filmsnaps.desktop`) and ships signed updates from the `desktop` GitHub
  release.
- **Security:** network filtering in the WebView2 request pipeline, cosmetic
  rules at document-start, Ed25519-signed config, minisign-signed updates. See
  [security.md](security.md) and [desktop.md](desktop.md).
- **Key dirs:** `src-tauri/src/player/` (libmpv + native surface),
  `src-tauri/src/adblock/` (network hook, cosmetic, in-page),
  `src-tauri/src/downloads.rs`, `src-tauri/src/config.rs` (signed config).

### `apps/mobile` — React Native / Expo app

- **Stack:** Expo SDK 55, React Native 0.83, TypeScript.
- **Role:** the phone app — discovery, downloads (SQLite-backed), watch
  history, and a native hardened player via the `PlayerWebView` Expo module.
- **Modes:** a global **Hard Mode Split** (`apps/mobile/lib/settings.tsx`) drives
  the whole app between `movie_tv` (TMDB movies & TV) and `anime` (MAL/AniList-keyed).
  Anime mode surfaces titles via AniList search (`apps/mobile/lib/anime/search.ts`),
  resolves each to its MAL/AniList ID (`apps/mobile/lib/anime/resolve.ts`, backed by
  the OTA-bundled `apps/mobile/lib/anime/anime-map.json`), and routes playback to
  **MegaPlay**. Server selection is **per-title**, so a movie inside anime mode (or
  anime inside movie/TV mode) still opens with the correct provider set.
- **Native modules:** `modules/player-webview/` (Android `AdblockEngine.kt`,
  `PlayerWebViewOverlayView.kt`; iOS `PlayerWebView.swift`).
- **Downloads:** `lib/download/` — manager + SQLite store + native downloader.
  On Android 10+ completed files publish to the system **MediaStore `Downloads`/
  `Filmsnaps`** collection (no permission) so they show in the system Downloads
  app and survive uninstall; an `OfflineFileProvider` bridge feeds them back to
  the in-app `expo-video` player. Older Android keeps app-private files.
- **Builds:** EAS (`apps/mobile/eas.json`), `.github/workflows/mobile.yml`.

## Packages

### `packages/shared` — `@filmsnaps/shared`

Shared logic consumed by all apps. Exposes subpath exports:

| Subpath      | Contents                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`          | Barrel: guard script builder, providers, types, utils.                                                                                                                                   |
| `/security`  | `playerGuard.ts` (15-layer guard), `scriptlets.ts` (uBO scriptlets), `navigation-home.ts` (home-escape guard).                                                                           |
| `/providers` | Provider registry (`registry.ts`) — single source of truth, including the Hard Mode Split (`getProvidersForMode`, `getNonAnimeProviders`, `filterAnimeProviders`, `ANIME_PROVIDER_IDS`). |
| `/types`     | Shared TypeScript types (movie, provider).                                                                                                                                               |
| `/api`       | TMDB API helpers.                                                                                                                                                                        |
| `/state`     | `useWatchHistory` + storage layer (watchlist state is per-app: web `apps/web/hooks/useWatchlist.ts`, mobile `apps/mobile/lib/bookmarks.ts`).                                             |
| `/theme`     | Design tokens.                                                                                                                                                                           |
| `/utils`     | `cn`, image, video helpers.                                                                                                                                                              |
| `/constants` | TMDB constants.                                                                                                                                                                          |

Built with `pnpm --filter @filmsnaps/shared build` (postinstall hook). A
postbuild step (`packages/shared/scripts/fix-dist-imports.mjs`) normalizes ESM
imports for consumers.

### `packages/adblock-config` — `@filmsnaps/adblock-config`

Schema + validator for v5 `providers.json` + `filters.txt`. Provides `loadBlocklistConfig` and a
`validate-cli` for CI. The desktop app reads the same files through a Rust
loader (`apps/desktop-tauri/src-tauri/src/config.rs`) that must stay in sync with
the schema here.

### `packages/filter-compiler` — `@filmsnaps/filter-compiler`

Turns `filters.txt` + uBO filter lists into deployable artifacts:

- `compiled-engine.bin` — serialized `@ghostery/adblocker` FiltersEngine (built
  for the removed Electron engine; the desktop app now parses `filters.txt`
  directly in Rust).
- `android-adblock-patterns.json` — Aho-Corasick trie for mobile `AdblockEngine`.
- `minimal-guard` — a stripped-down guard variant.

## Data flow: content discovery

```
apps/web / apps/mobile
    │
    ├── lib/tmdb.ts (web)  /  lib/api.ts (mobile)   ← TMDB API client
    │         └── TMDB_API_KEY (server-side only; .dev.vars / env)
    │
    ├── trending / search / discover pages
    │         └── @filmsnaps/shared (getImageUrl, providers, types)
    │
    └── watch page
            └── provider embed URL built from @filmsnaps/shared/providers
```

## Data flow: playback (hardened player)

```
watch page
    │  embed URL (provider.com/embed/movie/{id})
    ▼
desktop: provider webview (no IPC capability)
    │  WebResourceRequested 403 (network) + cosmetic CSS at document-start
    ▼
provider page loads → token API → .m3u8/.mpd manifest → video segments
    │  libmpv plays them in a native child surface under our own OSC
    ▼
video plays; blocked requests never leave the process and overlays stay hidden
```

Mobile follows the same shape with `PlayerWebView` (native
`shouldInterceptRequest` + injected guard + Ed25519-verified OTA config).
Web uses a sandboxed iframe.

## Builds & CI

Root scripts (`package.json`) drive everything through Turborepo:

| Command                                  | What it runs                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`                               | `turbo dev` — all apps in dev mode.                                          |
| `pnpm build`                             | `turbo build` — all apps/packages.                                           |
| `pnpm lint`                              | `turbo lint`.                                                                |
| `pnpm test`                              | Vitest (root config) — see `vitest.config.ts`.                               |
| `pnpm cf:deploy`                         | Build + deploy web to Cloudflare Pages.                                      |
| `pnpm build:desktop`                     | Desktop installer (web static export + Tauri bundle; needs the signing key). |
| `pnpm compile:filters` / `build:filters` | Regenerate filter artifacts.                                                 |

GitHub Actions (`.github/workflows/`): `ci.yml` (lint + typecheck + test),
`cloudflare.yml` (web → Cloudflare Pages), `netlify.yml` (web → Netlify),
`mobile.yml` (EAS builds), `release.yml` (web release on `v*` tags),
`desktop.yml` (desktop Rust tests on Windows).

## Tests

Vitest is configured at the root (`vitest.config.ts`). Current suites:

- `packages/shared/src/providers/registry.test.ts`
- `packages/shared/src/security/navigation-home.test.ts`
- `packages/shared/src/security/playerGuard.test.ts`

Run all: `pnpm test`. The desktop app's Rust tests run with
`pnpm test:desktop`.
