# Contributing to FilmSnaps

Thanks for helping out! This guide covers how to set up the repo, develop, add
a provider, and ship changes across web, desktop, and mobile.

## Table of contents

1. [Repository overview](#repository-overview)
2. [Setting up](#setting-up)
3. [Development workflow](#development-workflow)
4. [Project structure](#project-structure)
5. [Adding a new provider](#adding-a-new-provider)
6. [Editing `blocklist.json`](#editing-blocklistjson)
7. [Testing](#testing)
8. [Code style](#code-style)
9. [Common pitfalls](#common-pitfalls)

---

## Repository overview

FilmSnaps is a pnpm + Turborepo monorepo. Read
[docs/architecture.md](docs/architecture.md) for the full picture, and
[docs/security.md](docs/security.md) before touching anything security-related.

| Directory | Package | What it is |
| --- | --- | --- |
| `apps/web` | `@filmsnaps/web` | Next.js web app (discovery + watch UI). |
| `apps/desktop` | `@filmsnaps/desktop` | Electron app wrapping the web app + hardened player. |
| `apps/mobile` | `@filmsnaps/mobile` | Expo / React Native app. |
| `apps/feedback` | `@filmsnaps/feedback` | Feedback portal (Cloudflare Workers + D1). |
| `packages/shared` | `@filmsnaps/shared` | Shared guards, provider registry, types, state. |
| `packages/adblock-config` | `@filmsnaps/adblock-config` | `blocklist.json` schema + validation. |
| `packages/filter-compiler` | `@filmsnaps/filter-compiler` | Adblock engine + mobile pattern artifacts. |

## Setting up

**Prerequisites:** Node ≥ 18, pnpm 10 (`corepack enable`).

```bash
pnpm install        # installs all workspaces; builds @filmsnaps/shared via postinstall
```

If you change a filter/blocklist config, regenerate the adblock artifacts:

```bash
pnpm build:filters  # recompiles compiled-engine.bin + android-adblock-patterns.json
```

## Development workflow

### Web

```bash
pnpm dev:web        # http://localhost:3000
```

Env: `TMDB_API_KEY` (server-only, see `apps/web/README.md`).

### Mobile

```bash
pnpm dev:mobile     # Expo dev server
```

Uses the native `player-webview` module and `with-filmsnaps-downloader` plugin —
native changes need a full native rebuild (`pnpm android` / `pnpm ios`).

### Desktop

```bash
pnpm dev:desktop    # starts web dev server + Electron
```

Desktop builds bundle a Next.js **standalone** build and a compiled filter
engine — see `apps/desktop/README.md`.

### Feedback

```bash
cd apps/feedback && pnpm dev   # http://localhost:3001
```

## Project structure

```
apps/
  web/                 Next.js app — app/ (routes + API), components/, lib/
  desktop/             Electron — src/main.ts, src/preload/, src/security/
  mobile/              Expo — app/ (routes), components/, lib/, modules/player-webview/
  feedback/            Next.js + Workers + D1
packages/
  shared/              shared logic (security bundles, providers, state)
  adblock-config/      blocklist.json schema + validation
  filter-compiler/     engine + pattern export
blocklist.json         provider + blocking rules (single source of truth)
```

## Adding a new provider

Providers are **only** registered in the shared package — there is no separate
web/mobile provider list. See `apps/desktop/README.md` and
`apps/mobile/README.md` for per-platform notes.

### Step 1 — Register in `@filmsnaps/shared`

**File:** `packages/shared/src/providers/registry.ts`

```ts
{
  id: 'myprovider',                    // unique ID, used in URLs & code
  name: 'MyProvider',                  // internal name
  displayName: 'Server XX',            // shown in UI (mask the real name)
  baseUrl: 'https://example.com',      // embed base
  embed: {
    movie: (id: string) => `/embed/movie/${id}`,
    tv: (id, season, episode) => `/embed/tv/${id}/${season}/${episode}`,
  },
}
```

### Step 2 — Add its domains to `blocklist.json`

Add a `providers[]` entry with `embedDomains` and `cdnDomains`, and any
`blockHomePaths` for its error-UI "Go Home" links. Run `pnpm build:filters`.

### Step 3 — Test on each platform

- **Web** — iframe mounts the embed; check the video plays without 404s.
- **Desktop** — full R0–R8 cascade + L5 preload. Verify with
  `FILMSNAPS_AUDIT=1` (see `docs/security.md` → Audit & diagnostics).
- **Mobile** — native `PlayerWebView` + `shouldInterceptRequest`. Verify no ads,
  popups, or fullscreen issues.

### Providers needing custom handling

If the provider doesn't work with the standard pipeline (Cloudflare challenge,
custom auth), document **why** in the code, add provider-specific handling in
the mobile `VideoWebView.tsx` / `PlayerWebViewOverlayView.kt` and the desktop
preload, then test on all platforms. Do **not** weaken shared guards to make a
provider work — prefer per-provider allowlist entries.

## Editing `blocklist.json`

`blocklist.json` is the single source of truth (v4 schema). See
[docs/security.md](docs/security.md) → Configuration for the sections. After
editing, run `pnpm build:filters` so the compiled engine and mobile patterns
regenerate.

**Safety rules:**

- Never put a real video-CDN host in `rules.alwaysBlock` (R5) unless you're
  sure it never serves content.
- `allowedCdnHosts` is a **global allowlist** — adding a domain lets it bypass
  the cascade on every provider.
- `blockHomePaths` are per-provider deny-lists — append new home-page shapes as
  discovered.

## Testing

```bash
pnpm test           # Vitest suites (shared + desktop security)
pnpm lint           # Turbo lint across all apps
pnpm typecheck:desktop   # desktop tsc --noEmit (other apps: cd <app> && pnpm typecheck)
```

Current suites:

- `packages/shared/src/providers/registry.test.ts`
- `packages/shared/src/security/navigation-home.test.ts`
- `packages/shared/src/security/playerGuard.test.ts`
- `apps/desktop/src/security/blocklist.test.ts`

If you change the R0–R8 cascade or the navigation guard, add/extend tests in
these files.

## Code style

- TypeScript, Prettier-formatted (`pnpm format`).
- Server-only secrets (e.g. `TMDB_API_KEY`) never referenced from client
  components.
- Security code carries a header comment explaining **why** a layer exists and
  how it fails. Match that style.
- ESM/CJS boundary: desktop main is CommonJS and never imports `@filmsnaps/*`
  at runtime — reproduce shared logic there with a comment pointing at the
  canonical source (see `provider-config.ts`, `navigation-guard.ts`).

## Common pitfalls

- **Forgetting `pnpm build:filters`** after editing `blocklist.json` — the
  desktop engine and mobile patterns go stale.
- **Adding a provider to only one platform.** Registration lives in
  `@filmsnaps/shared`; each app consumes the same registry.
- **Weakening guards.** If a provider breaks, investigate the allowlist /
  per-provider config first — never disable a shared layer.
- **`.env` / `.dev.vars`** — never commit secrets. `TMDB_API_KEY` was
  historically committed in `.dev.vars`; if you see it anywhere, untrack it and
  rotate the key.
- **Dormant code.** Some infra is intentionally dormant (the web proxy stack,
  `PROXIED_PROVIDERS = new Set([])`). Don't delete it without an ADR-style note.
