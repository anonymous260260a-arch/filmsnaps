# Contributing

## Set up

Requires Node.js 18 or newer and pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example apps/web/.env.local   # then set TMDB_API_KEY
```

`pnpm install` builds `@filmsnaps/shared` through the postinstall hook.

## Run

| Command            | Runs                             |
| ------------------ | -------------------------------- |
| `pnpm dev:web`     | Web app at http://localhost:3000 |
| `pnpm dev:mobile`  | Expo dev server                  |
| `pnpm dev:desktop` | Windows desktop app              |

The desktop app serves the web app's static export, so build that export first.
[The desktop guide](docs/desktop.md) has the exact commands, the libmpv setup and
the signing key.

Native mobile changes need a full rebuild (`pnpm android`, `pnpm ios`).

## Test and lint

```bash
pnpm test              # Vitest: shared packages
pnpm test:desktop      # Rust: desktop app
pnpm lint              # Turbo lint
pnpm typecheck:desktop # cargo check
pnpm format            # Prettier
```

Add a test when you change the provider registry, the navigation guard, the guard
bundle, or the desktop adblock and player logic.

## Branches, commits and pull requests

1. Branch from `main`, one logical change per branch.
2. Write imperative commit subjects under about 72 characters; explain why in the
   body when it is not obvious.
3. Run the tests and lint for the apps you touched.
4. Open the pull request against `main` and describe what changed and why. Link
   the issue it fixes.

Review looks at behaviour, not only style: does the change hold for an empty
list, a slow network, a cancelled request, and a second provider?

## Add a provider

1. Register it in `packages/shared/src/providers/registry.ts`:

   ```ts
   {
     id: 'myprovider',
     name: 'MyProvider',
     displayName: 'Server XX',
     baseUrl: 'https://example.com',
     mediaTypes: ['movie_tv'],
     embed: {
       movie: (id: string) => `/embed/movie/${id}`,
       tv: (id, season, episode) => `/embed/tv/${id}/${season}/${episode}`,
     },
   }
   ```

   Anime providers are keyed by MAL/AniList IDs instead of TMDB. Set
   `animeOnly: true` and `mediaTypes: ['anime']` so they appear only in anime
   sessions.

2. Add its domains to `providers.json`: `embedDomains`, `cdnDomains`, and a
   `providerProfiles` entry listing the scripts, frames and images it may load.
3. Add `filters.txt` rules if the provider needs allowlists or blocks.
4. Run `pnpm build:filters` and `pnpm sign:providers`.
5. Play a title on web, desktop and mobile. On desktop, confirm stderr does not
   print `[adblock] network filtering unavailable`.

Never weaken a shared guard to make one provider work. Add a per-provider entry
in `providers.json` instead.

## Edit `providers.json` and `filters.txt`

`providers.json` is Ed25519-signed; `providers.json.sig` must match it.

1. Edit the files.
2. `pnpm build:filters` — regenerates the mobile patterns. The desktop app reads
   both files directly.
3. `pnpm sign:providers`.
4. Commit the config and its signature together.

Rules that prevent outages:

- Never put a real video CDN in `rules.alwaysBlock`.
- `allowedCdnHosts` is global: every entry bypasses filtering on every provider.
- `allowServerRedirects` is only for redirect-mesh providers (vidsrc→viduki.net,
  videasy→videasy.to).

## Code conventions

- TypeScript formatted with Prettier.
- Never reference a server-only secret such as `TMDB_API_KEY` from a client
  component.
- Security code opens with a comment explaining why the layer exists and how it
  fails.
- The desktop app is Rust plus the static export. Logic it re-implements lives in
  `src-tauri/src/` with a comment pointing at the canonical TypeScript source.
- Never commit `.env` or `.dev.vars`. If a key leaks, rotate it.

## Report a bug

Open an issue with the app and its version, what you expected, what happened, and
the steps to reproduce. For security problems follow [SECURITY.md](SECURITY.md)
instead of opening a public issue.

## Documentation

Update the doc covering what you changed: [docs/desktop.md](docs/desktop.md) for
the desktop app, [docs/security.md](docs/security.md) for a security layer,
[docs/architecture.md](docs/architecture.md) for structure. If a doc becomes
wrong, fix or delete it in the same change.
