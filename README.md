# FilmSnaps

Discover, search, and watch movies and TV shows on the web, on Windows, and on
Android/iOS.

FilmSnaps is a pnpm + Turborepo monorepo with three apps and the packages they
share. Provider pages are untrusted, so each platform blocks ads and trackers
before they reach the player — see [the security reference](docs/security.md).

## Install

Requires Node.js 18 or newer, pnpm 10 (`corepack enable`), and a
[TMDB API key](https://www.themoviedb.org/settings/api).

```bash
pnpm install
cp .env.example apps/web/.env.local   # then set TMDB_API_KEY
```

## Quick start

```bash
pnpm dev          # every app in dev mode
pnpm dev:web      # web app at http://localhost:3000
pnpm dev:mobile   # Expo dev server
pnpm dev:desktop  # Windows app; build apps/web/out first
```

The desktop app serves the web app's static export, not a dev server. See
[the desktop guide](docs/desktop.md) for the export and libmpv steps.

## Common commands

| Command              | Purpose                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| `pnpm build`         | Build every app and package.                                                   |
| `pnpm test`          | Vitest suites for the shared packages.                                         |
| `pnpm test:desktop`  | Rust tests for the desktop app.                                                |
| `pnpm lint`          | Lint every app.                                                                |
| `pnpm build:filters` | Rebuild the adblock artifacts after editing `providers.json` or `filters.txt`. |
| `pnpm build:desktop` | Build the Windows installer (needs the updater signing key).                   |

## Where things are

| App               | Path                 | Stack                       |
| ----------------- | -------------------- | --------------------------- |
| Web               | `apps/web`           | Next.js 16                  |
| Desktop (Windows) | `apps/desktop-tauri` | Tauri 2 + in-process libmpv |
| Mobile            | `apps/mobile`        | Expo / React Native         |

Packages live in `packages/`. The repository layout, data flow and CI are in
[docs/architecture.md](docs/architecture.md).

## Releases

- Web: Cloudflare Pages and Netlify, from `.github/workflows/`.
- Desktop: built, signed and uploaded by hand to the `desktop` GitHub release —
  see [the desktop guide](docs/desktop.md).
- Mobile: EAS build profiles in `apps/mobile/eas.json`.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and
[SECURITY.md](SECURITY.md) to report a vulnerability privately.

This project is licensed under the [GNU General Public License v3.0](LICENSE).
