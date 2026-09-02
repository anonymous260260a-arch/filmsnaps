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
│   ├── desktop/              @filmsnaps/desktop — Electron wrapper (watch UI + hardened player)
│   ├── mobile/               @filmsnaps/mobile — React Native / Expo app (Android + iOS)
│   └── feedback/             @filmsnaps/feedback — Next.js feedback portal (Cloudflare Workers + D1)
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

### `apps/desktop` — Electron desktop app

- **Stack:** Electron 43 + a Next.js **static export** of the web app
  (`BUILD_FOR_DESKTOP=true` → `out/`) served via `app://` protocol (no Node.js server).
- **Role:** the web UI with a native, hardened provider player inside a
  `WebContentsView` on an isolated `persist:filmsnaps-provider` partition.
- **Security:** see [docs/security.md](security.md) — R0–R8 cascade, L2–L8 layers,
  Ed25519-verified OTA config, `@ghostery/adblocker` engine.
- **Key dirs:** `src/main.ts` (main process), `src/preload/`, `src/security/`
  (rule cascade, navigation guard, provider security, filter engine),
  `scripts/` (build-provider-preload.mjs, build-web.mjs).
- **Packaging:** `electron-builder`; `apps/desktop/release/` output.

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

### `apps/feedback` — Feedback portal

- **Stack:** Next.js 16 + Cloudflare Workers (OpenNext) + Cloudflare D1.
- **Role:** public bug reports, feature requests, roadmap, changelog, FAQ —
  account-free, Turnstile-protected, offline queue.
- **Docs:** its own `apps/feedback/docs/` tree (linked from its README).
- **Deploys:** Cloudflare Workers via `apps/feedback` wrangler config.

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
`validate-cli` for CI. Desktop has a CJS replica of the loader
(`apps/desktop/src/security/provider-config.ts`) because Electron main is CJS
and never imports `@filmsnaps/*` at runtime.

### `packages/filter-compiler` — `@filmsnaps/filter-compiler`

Turns `filters.txt` + uBO filter lists into deployable artifacts:

- `compiled-engine.bin` — serialized `@ghostery/adblocker` FiltersEngine (desktop R4).
- `android-adblock-patterns.json` — Aho-Corasick trie for mobile `AdblockEngine` (R4b/R5b) + desktop R5b fallback.
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
desktop: WebContentsView on persist:filmsnaps-provider
    │  R0–R8 cascade (network) + L5 preload (in-page) + L4 nav guard
    │  L8 addScriptToEvaluateOnNewDocument (HTML-bytes injection)
    ▼
provider page loads → token API → .m3u8/.mpd manifest → video segments
    │  session trust (R0) earns on first video response (MIME-based, 15-min TTL)
    ▼
video plays; overlays/popups/trackers blocked by guard bundle + sweepers
```

Mobile follows the same shape with `PlayerWebView` (native
`shouldInterceptRequest` + injected guard + Ed25519-verified OTA config).
Web uses a sandboxed iframe.

## Builds & CI

Root scripts (`package.json`) drive everything through Turborepo:

| Command                                  | What it runs                                              |
| ---------------------------------------- | --------------------------------------------------------- |
| `pnpm dev`                               | `turbo dev` — all apps in dev mode.                       |
| `pnpm build`                             | `turbo build` — all apps/packages.                        |
| `pnpm lint`                              | `turbo lint`.                                             |
| `pnpm test`                              | Vitest (root config) — see `vitest.config.ts`.            |
| `pnpm cf:deploy`                         | Build + deploy web to Cloudflare Pages.                   |
| `pnpm dist:desktop`                      | Desktop installer (web static export + electron-builder). |
| `pnpm compile:filters` / `build:filters` | Regenerate filter artifacts.                              |

GitHub Actions (`.github/workflows/`): `ci.yml` (lint + typecheck + test),
`cloudflare.yml` (web → Cloudflare Pages), `netlify.yml` (web → Netlify),
`mobile.yml` (EAS builds), `release.yml` (desktop release).

## Tests

Vitest is configured at the root (`vitest.config.ts`). Current suites:

- `packages/shared/src/providers/registry.test.ts`
- `packages/shared/src/security/navigation-home.test.ts`
- `packages/shared/src/security/playerGuard.test.ts`
- `apps/desktop/src/security/blocklist.test.ts`

Run all: `pnpm test`.
