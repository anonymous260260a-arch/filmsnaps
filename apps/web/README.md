# `@filmsnaps/web` — Web App

Next.js 16 (App Router) web app for FilmSnaps. Primary content-discovery
surface: trending lists, fuzzy search, watchlist, watch history, and watch
pages with sandboxed provider embeds.

## Stack

- **Framework:** Next.js 16 (App Router), TypeScript.
- **Styling:** Tailwind CSS + shadcn-style `components/ui`.
- **Search:** Fuse.js (fuzzy title matching).
- **Deploys:** Cloudflare Pages (OpenNext, `cf:build`/`cf:deploy`) and Netlify
  (`netlify.toml`, `.github/workflows/netlify.yml`).

## Layout

```
app/
  api/                    API routes (tmdb, player proxy, blocklist, stream, video-extract)
  download/               Download landing page
  exp/                    Experimental pages (showbox/watch)
  history/  saved/  search/  movie/[id]/  tv/[id]/  person/[id]/
  watch/[...id]/          Watch page
  legal/  privacy/  how-it-works/  versions/
components/
  ui/                     Button, input, dialog, etc.
  player/                 DesktopSecureWebview, etc.
  watch/                  Watch page components
lib/
  tmdb.ts                 TMDB client (client-safe)
  tmdb.server.ts          TMDB client (server-only, reads TMDB_API_KEY)
  movieProviders/         Provider proxy stack (dormant) + protection engine
  providers.js  moviebox.ts  showbox.ts  streamingMkvParser.ts
```

## Environment

| Variable | Where used |
| --- | --- |
| `TMDB_API_KEY` | Server-only: `lib/tmdb.server.ts`, `app/api/tmdb/[...tmdb]/route.ts`. |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL for links/SEO. |
| `BLOCKLIST_CONFIG_URL` | Optional: host your own `blocklist.json` on a CDN. |

Copy `.env.example` (repo root) to `apps/web/.env.local` and fill in
`TMDB_API_KEY`. The key is **server-only** — never expose it client-side.

## Run

```bash
# From repo root
pnpm dev:web          # http://localhost:3000

# Or from this dir
pnpm install          # uses the workspace
pnpm dev
```

## Build / deploy

```bash
pnpm build            # standard Next.js build
pnpm cf:build         # OpenNext build for Cloudflare Workers
pnpm cf:deploy        # wrangler deploy
```

## Auth

The web app is **fully anonymous** — there is no sign-in, no accounts, and no
auth code. Watchlist and watch-history are stored locally on-device
(localStorage). The old no-op `AuthProvider`, `/auth`, and `/reset-password`
scaffolding was removed (see [ADR 0002](../../docs/adr/0002-auth-removal.md)).

## Note on the provider proxy

`lib/movieProviders/` contains a proxy stack (TLS fetch, flare-solverr,
Cloudflare detection, protection engine) and `/api/player/[provider]`,
`/api/[provider]/[...asset]` routes. These are **dormant**: the
`PROXIED_PROVIDERS` set is empty, so none of the proxy routes are reachable in
normal operation. The protection engine (`protection.ts`) is active and used by
the desktop/mobile players via the shared guard; the proxy paths are preserved
for future use. See [ADR 0001](../../docs/adr/0001-dormant-proxy-stack.md) and
[docs/security.md](../../docs/security.md).
