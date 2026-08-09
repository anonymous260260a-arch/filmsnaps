# FilmSnaps

> Discover, search, and watch movies and TV shows — across **Web**, **Desktop
> (Windows/macOS/Linux)**, and **Mobile (Android/iOS)**.

FilmSnaps is a cross-platform streaming-discovery ecosystem powered by the
TMDB API. Browse trending content, search with fuzzy matching, build a
watchlist, track watch history, and stream through provider players that are
hardened against ads, trackers, and popups on every platform.

This repository is a **pnpm + Turborepo monorepo**: a Next.js web app, an
Electron desktop app that wraps the web app with a native hardened player, an
Expo/React Native mobile app, and a feedback portal.

---

## Apps

| App | Package | Stack | Description |
| --- | --- | --- | --- |
| [Web](apps/web/README.md) | `@filmsnaps/web` | Next.js 16 (App Router) + Tailwind | Discovery UI, watch pages, API routes |
| [Desktop](apps/desktop/README.md) | `@filmsnaps/desktop` | Electron 43 + Next.js standalone | Web UI + native hardened player |
| [Mobile](apps/mobile/README.md) | `@filmsnaps/mobile` | Expo SDK 55 / React Native 0.83 | Phone app with downloads + native player |
| [Feedback](apps/feedback/README.md) | `@filmsnaps/feedback` | Next.js 16 + Cloudflare Workers/D1 | Public feedback portal |

## Packages

| Package | Description |
| --- | --- |
| `@filmsnaps/shared` | Shared guard scripts, provider registry, types, state, design tokens. |
| `@filmsnaps/adblock-config` | `blocklist.json` schema + validation. |
| `@filmsnaps/filter-compiler` | Adblocker engine + mobile pattern export artifacts. |

---

## Documentation

- **[Security Architecture](docs/security.md)** — the full security stack: R0–R8
  rule cascade and L2–L8 desktop layers, mobile native protection, and the
  `blocklist.json` configuration.
- **[Architecture](docs/architecture.md)** — repository layout, data flow,
  builds, and CI.
- **[Contributing](CONTRIBUTING.md)** — how to set up, develop, add a provider,
  and ship changes.

---

## Quick start

### Prerequisites

- **Node.js** ≥ 18
- **pnpm 10** (`corepack enable` or install directly)
- A **TMDB API key** ([free](https://www.themoviedb.org/settings/api))

### Install & run

```bash
# 1. Install dependencies (builds @filmsnaps/shared via postinstall)
pnpm install

# 2. Configure the TMDB API key
cp .env.example apps/web/.env.local   # or set TMDB_API_KEY in your shell / .dev.vars
#   TMDB_API_KEY=your_key

# 3. Run everything (all apps in dev mode)
pnpm dev

# Or run one app:
pnpm dev:web       # http://localhost:3000
pnpm dev:mobile    # Expo dev server
pnpm dev:desktop   # Electron (starts the Next.js dev server + app)
```

See each app's README for platform-specific setup (native modules, signing,
build profiles).

---

## Common commands

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build all apps/packages (Turborepo). |
| `pnpm lint` | Lint everything. |
| `pnpm test` | Run the Vitest suites (shared + desktop security). |
| `pnpm typecheck:desktop` | Typecheck the desktop app. |
| `pnpm format` | Prettier across the repo. |
| `pnpm build:filters` | Regenerate adblocker/filter artifacts from `blocklist.json`. |
| `pnpm cf:deploy` | Deploy the web app to Cloudflare Pages. |
| `pnpm dist:desktop` | Build the desktop installer. |

---

## Feature highlights

- **Smart search** — fuzzy title matching (Fuse.js) with hybrid ranking:
  fuzzy relevance + popularity + vote score.
- **Watchlist & history** — save titles, cross-session persistence,
  continue-watching. Stored locally on-device (no account required — the app is
  fully anonymous).
- **Multi-provider player** — provider registry in `@filmsnaps/shared`; each
  platform mounts embeds with native security layers (see
  [docs/security.md](docs/security.md)).
- **Mobile downloads** — SQLite-backed episode/movie downloads with a native
  downloader.
- **Feedback portal** — account-free bug reports, feature requests, roadmap,
  changelog, FAQ.

---

## Releases

- Web: Cloudflare Pages + Netlify (`.github/workflows/`).
- Desktop: `electron-builder` → GitHub Releases (`.github/workflows/release.yml`).
- Mobile: EAS build profiles (`apps/mobile/eas.json`,
  `.github/workflows/mobile.yml`).

---

## License

No license file is currently present in this repository. Contact the maintainers
before reusing any part of it.
