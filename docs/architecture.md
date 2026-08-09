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
│   ├── adblock-config/       @filmsnaps/adblock-config — blocklist.json schema + validation
│   └── filter-compiler/      @filmsnaps/filter-compiler — adblocker engine + mobile pattern export
├── blocklist.json            Single source of truth for provider + blocking rules
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
- **Dormant proxy stack:** `lib/movieProviders/{protection,tlsFetch,flareSolverr,cloudflareDetect,cspBuilder}.ts`
  + `/api/player/*` routes are kept but unreachable (`PROXIED_PROVIDERS` is an
  empty set) — see [ADR 0001](adr/0001-dormant-proxy-stack.md).

### `apps/desktop` — Electron desktop app

- **Stack:** Electron 43 + a Next.js **standalone** build of the web app
  (`BUILD_FOR_DESKTOP=true` → `.next/standalone`) spawned as a local server.
- **Role:** the web UI with a native, hardened provider player inside a
  `<webview>` on an isolated `persist:filmsnaps-provider` partition.
- **Security:** see [docs/security.md](security.md) — R0–R8 cascade, L2–L8 layers.
- **Key dirs:** `src/main.ts` (main process), `src/preload/`, `src/security/`
  (rule cascade, navigation guard, provider security, filter engine),
  `scripts/` (build-provider-preload.mjs, build-web.mjs).
- **Packaging:** `electron-builder`; `apps/desktop/release/` output.

### `apps/mobile` — React Native / Expo app

- **Stack:** Expo SDK 55, React Native 0.83, TypeScript.
- **Role:** the phone app — discovery, downloads (SQLite-backed), watch
  history, and a native hardened player via the `PlayerWebView` Expo module.
- **Native modules:** `modules/player-webview/` (Android `AdblockEngine.kt`,
  `PlayerWebViewOverlayView.kt`; iOS `PlayerWebView.swift`).
- **Downloads:** `lib/download/` — manager + SQLite store + native downloader.
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

| Subpath | Contents |
| --- | --- |
| `.` | Barrel: guard script builder, providers, types, utils. |
| `/security` | `playerGuard.ts` (15-layer guard), `scriptlets.ts` (uBO scriptlets), `navigation-home.ts` (home-escape guard). |
| `/providers` | Provider registry (`registry.ts`) — single source of truth. |
| `/types` | Shared TypeScript types (movie, provider). |
| `/api` | TMDB API helpers. |
| `/state` | `useWatchHistory` + storage layer (watchlist state is per-app: web `apps/web/hooks/useWatchlist.ts`, mobile `apps/mobile/lib/bookmarks.ts`). |
| `/theme` | Design tokens. |
| `/utils` | `cn`, image, video helpers. |
| `/constants` | TMDB constants. |

Built with `pnpm --filter @filmsnaps/shared build` (postinstall hook). A
postbuild step (`packages/shared/scripts/fix-dist-imports.mjs`) normalizes ESM
imports for consumers.

### `packages/adblock-config` — `@filmsnaps/adblock-config`

Schema + validator for `blocklist.json`. Provides `loadBlocklistConfig` and a
`validate-cli` for CI. Desktop has a CJS replica of the loader
(`apps/desktop/src/security/provider-config.ts`) because Electron main is CJS
and never imports `@filmsnaps/*` at runtime.

### `packages/filter-compiler` — `@filmsnaps/filter-compiler`

Turns adblock lists + `blocklist.json` into deployable artifacts:

- `compiled-engine.bin` — serialized `@cliqz/adblocker` FiltersEngine (desktop R4).
- `android-adblock-patterns.json` — substring/domain patterns bundled in the APK
  (mobile `AdblockEngine` + desktop R4b).
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
desktop: <webview> on persist:filmsnaps-provider
    │  R0–R8 cascade (network) + L5 preload (in-page) + L4 nav guard
    ▼
provider page loads → token API → .m3u8/.mpd manifest → video segments
    │  session trust (R0) earns on first video response
    ▼
video plays; overlays/popups/trackers blocked by guard bundle + sweepers
```

Mobile follows the same shape with `PlayerWebView` (native
`shouldInterceptRequest` + injected guard). Web uses a sandboxed iframe.

## Builds & CI

Root scripts (`package.json`) drive everything through Turborepo:

| Command | What it runs |
| --- | --- |
| `pnpm dev` | `turbo dev` — all apps in dev mode. |
| `pnpm build` | `turbo build` — all apps/packages. |
| `pnpm lint` | `turbo lint`. |
| `pnpm test` | Vitest (root config) — see `vitest.config.ts`. |
| `pnpm cf:deploy` | Build + deploy web to Cloudflare Pages. |
| `pnpm dist:desktop` | Desktop installer (web standalone + electron-builder). |
| `pnpm compile:filters` / `build:filters` | Regenerate filter artifacts. |

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
