# Contributing to FilmSnaps

Thanks for helping out! This guide covers how to set up the repo, develop, add
a provider, and ship changes across web, desktop, and mobile.

## Table of contents

1. [Repository overview](#repository-overview)
2. [Setting up](#setting-up)
3. [Development workflow](#development-workflow)
4. [Project structure](#project-structure)
5. [Adding a new provider](#adding-a-new-provider)
6. [Editing `providers.json` + `filters.txt` (v5)](#editing-providersjson--filterstxt-v5)
7. [Testing](#testing)
8. [Code style](#code-style)
9. [Common pitfalls](#common-pitfalls)

---

## Repository overview

FilmSnaps is a pnpm + Turborepo monorepo. Read
[docs/architecture.md](docs/architecture.md) for the full picture, and
[docs/security.md](docs/security.md) before touching anything security-related.

| Directory                  | Package                      | What it is                                               |
| -------------------------- | ---------------------------- | -------------------------------------------------------- |
| `apps/web`                 | `@filmsnaps/web`             | Next.js web app (discovery + watch UI).                  |
| `apps/desktop`             | `@filmsnaps/desktop`         | Electron app wrapping the web app + hardened player.     |
| `apps/mobile`              | `@filmsnaps/mobile`          | Expo / React Native app.                                 |
| `apps/feedback`            | `@filmsnaps/feedback`        | Feedback portal (Cloudflare Workers + D1).               |
| `packages/shared`          | `@filmsnaps/shared`          | Shared guards, provider registry, types, state.          |
| `packages/adblock-config`  | `@filmsnaps/adblock-config`  | v5 `providers.json` + `filters.txt` schema + validation. |
| `packages/filter-compiler` | `@filmsnaps/filter-compiler` | `@ghostery/adblocker` engine + mobile pattern export.    |

---

## Setting up

**Prerequisites:** Node ≥ 18, pnpm 10 (`corepack enable`).

```bash
pnpm install        # installs all workspaces; builds @filmsnaps/shared via postinstall
```

If you change a filter/blocklist config, regenerate the adblock artifacts:

```bash
pnpm build:filters  # recompiles compiled-engine.bin + android-adblock-patterns.json
```

---

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

Desktop builds bundle a Next.js **static export** and a compiled filter
engine — see `apps/desktop/README.md`.

### Feedback

```bash
cd apps/feedback && pnpm dev   # http://localhost:3001
```

---

## Project structure

```
apps/
  web/                 Next.js app — app/ (routes + API), components/, lib/
  desktop/             Electron — src/main.ts, src/preload/, src/security/
  mobile/              Expo — app/ (routes), components/, lib/, modules/player-webview/
  feedback/            Next.js + Workers + D1
packages/
  shared/              shared logic (security bundles, providers, state)
  adblock-config/      providers.json + filters.txt v5 schema + validation
  filter-compiler/     @ghostery/adblocker engine + mobile pattern export
providers.json          v5 config (providers) — single source of truth, Ed25519-signed
providers.json.sig      Ed25519 signature over providers.json
filters.txt             v5 config (uBO/EasyList rules)
blocklist.json          legacy v4 fallback (backward compat)
```

---

## Adding a new provider

### Step 1 — Register in `@filmsnaps/shared`

**File:** `packages/shared/src/providers/registry.ts`

```ts
{
  id: 'myprovider',                    // unique ID, used in URLs & code
  name: 'MyProvider',                  // internal name
  displayName: 'Server XX',            // shown in UI (mask the real name)
  baseUrl: 'https://example.com',      // embed base
  mediaTypes: ['movie_tv'],            // ['movie_tv'] (default) or add 'anime'; providers without it default to movie/TV
  animeOnly: false,                    // true for MAL/AniList-keyed anime-only sources (excluded from movie/TV pickers)
  embed: {
    movie: (id: string) => `/embed/movie/${id}`,
    tv: (id, season, episode) => `/embed/tv/${id}/${season}/${episode}`,
  }
}
```

> **Anime providers** are keyed by MAL/AniList IDs, not TMDB. Mark them
> `animeOnly: true` (and `mediaTypes: ['anime']`) so they're excluded from
> movie/TV server pickers and selected only in anime sessions via
> `filterAnimeProviders` / `getProvidersForMode('anime')`. If an anime source
> should also carry regular movie/TV (hybrid), set `mediaTypes: ['movie_tv', 'anime']`
> (e.g. nxsha, screenscape) and add it to `ANIME_PROVIDER_IDS` if it should appear
> in anime sessions.

### Step 2 — Add its domains to `providers.json` (v5)

**File:** `providers.json` (repo root, schema v5)

```json
{
  "version": 5,
  "providers": [
    {
      "id": "myprovider",
      "embedDomains": ["example.com", "www.example.com"],
      "cdnDomains": ["cdn.example.com"],
      "enabled": true,
      "allowServerRedirects": false,
      "blockHomePaths": ["/go-home"],
      "apiIntercepts": [],
      "cosmeticRules": [],
      "adblockDisabled": false
    }
  ],
  "providerProfiles": {
    "example.com": {
      "scripts": ["https://example.com/script.js"],
      "iframes": ["https://cdn.example.com/frame.html"],
      "images": ["https://example.com/image.png"]
    }
  },
  "navigationGuard": {
    "universalBlockPaths": ["/"]
  },
  "rules": {
    "videoDetection": {
      "extensions": [".mp4", ".m3u8", ".ts"],
      "pathPatterns": ["seg-", "init-", "chunk-"],
      "enableSessionTrust": true,
      "trustTTLMs": 900000
    },
    "alwaysBlock": {
      "domains": [],
      "pathPatterns": []
    }
  }
}
```

### Step 3 — Add `filters.txt` entries (optional, for ad blocking)

**File:** `filters.txt` (repo root)

Standard uBO/EasyList syntax. Example rules:

```
@@||example.com^              # allowlist the embed domain
||google-analytics.com^$3p   # block 3rd-party trackers
##.ad-banner                  # cosmetic rule
```

### Step 4 — Regenerate compiler artifacts

```bash
pnpm build:filters  # rebuilds compiled-engine.bin + android-adblock-patterns.json
```

### Step 5 — Test on each platform

- **Web** — iframe mounts the embed; check the video plays without 404s.
- **Desktop** — full R0–R8 cascade + L5 preload. Verify with
  `FILMSNAPS_AUDIT=1` (see `docs/security.md` → Audit & diagnostics).
- **Mobile** — native `PlayerWebView` + `shouldInterceptRequest`. Verify no ads,
  popups, or fullscreen issues.

### Step 6 — Sign the config (for OTA)

Run the signing step to generate `providers.json.sig`:

```bash
pnpm sign:providers  # Ed25519-signs providers.json; .key in .keys/ (gitignored), .pub committed
```

### Providers needing custom handling

If the provider doesn't work with the standard pipeline (Cloudflare challenge,
custom auth), document **why** in the code, add provider-specific handling in
the mobile `VideoWebView.tsx` / `PlayerWebViewOverlayView.kt` and the desktop
preload, then test on all platforms. Do **not** weaken shared guards to make a
provider work — prefer per-provider allowlist entries.

---

## Editing `providers.json` + `filters.txt` (v5)

> The v5 config lives in `providers.json` (app logic) + `filters.txt` (uBO
> syntax), both Ed25519-signed (`providers.json.sig`). A legacy `blocklist.json`
> (v4) is kept for backward compatibility.

**Workflow:**

1. Edit `providers.json` (add/update provider entries, allowlists, nav-guard,
   apiIntercepts, cosmetics, `allowServerRedirects`).
2. Edit `filters.txt` (uBO/EasyList rules — exact/suffix matching only, e.g.
   `@@||cloudfront.net^`, `||doubleclick.net^$3p`, `##.ad-banner`).
3. Run `pnpm build:filters` — regenerates `compiled-engine.bin` (desktop) and
   `android-adblock-patterns.json` (mobile).
4. Run `pnpm sign:providers` — Ed25519-signs `providers.json` → `providers.json.sig`.
5. Commit all four files. OTA clients will pull and verify the updated config.

**Safety rules:**

- Never put a real video-CDN host in `rules.alwaysBlock` (R5) unless you're
  sure it never serves content.
- `allowedCdnHosts` is a **global allowlist** — adding a domain lets it bypass
  the cascade on every provider.
- `blockHomePaths` are per-provider deny-lists — append new home-page shapes as
  discovered.
- `allowServerRedirects: true` is only for redirect-mesh providers (vidsrc→viduki.net,
  videasy→videasy.to). Enabling it on a non-redirect provider could let an ad
  redirect through.

---

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

---

## Code style

- TypeScript, Prettier-formatted (`pnpm format`).
- Server-only secrets (e.g. `TMDB_API_KEY`) never referenced from client
  components.
- Security code carries a header comment explaining **why** a layer exists and
  how it fails. Match that style.
- ESM/CJS boundary: desktop main is CommonJS and never imports `@filmsnaps/*`
  at runtime — reproduce shared logic there with a comment pointing at the
  canonical source (see `provider-config.ts`, `navigation-guard.ts`).

---

## Common pitfalls

- **Forgetting `pnpm build:filters`** after editing `providers.json` or
  `filters.txt` — the desktop engine and mobile patterns go stale.
- **Forgetting `pnpm sign:providers`** after editing `providers.json` — OTA
  clients will reject the unsigned config and keep the last-known-good version.
- **Adding a provider to only one platform.** Registration lives in
  `@filmsnaps/shared`; each app consumes the same registry.
- **Weakening guards.** If a provider breaks, investigate the allowlist /
  per-provider config first — never disable a shared layer.
- **`.env` / `.dev.vars`** — never commit secrets. `TMDB_API_KEY` was
  historically committed in `.dev.vars`; if you see it anywhere, untrack it and
  rotate the key.
- **No server-side provider proxy.** Provider players load via sandboxed
  cross-origin iframes with a parent-enforced CSP (`buildIframeCSP`); there is
  no server-side proxy route. Don't reintroduce one without an ADR-style note.
