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
- **Desktop player bridge:** `DesktopSecureWebview.tsx` (IPC to Electron `WebContentsView`).

## Layout

```
app/
  api/                    API routes (tmdb, player, stream, anime, blocklist)
  download/               Download landing page
  history/  saved/  search/  movie/[id]/  tv/[id]/  person/[id]/
  watch/[...id]/          Watch page (DesktopSecureWebview + React overlays)
  legal/  privacy/  how-it-works/  versions/
components/
  ui/                     Button, input, dialog, etc.
  player/                 DesktopSecureWebview, PlayerProvider, ServerPickerSheet, VideoZone
  watch/                  Watch page components (ServerDropdown, etc.)
lib/
  tmdb.ts                 TMDB client (client-safe)
  tmdb.server.ts          TMDB client (server-only, reads TMDB_API_KEY)
  anime/                  Anime support: AniList search, MAL/AniList ID resolution
                          (OTA-bundled `anime-map.json`), threaded into watch pages
  movieProviders/         CSP builder for cross-origin provider iframes
  providers.js  streamingMkvParser.ts
app/api/anime/           Anime resolution/search API routes (MAL/AniList IDs)
```

## Environment

| Variable               | Where used                                                            |
| ---------------------- | --------------------------------------------------------------------- |
| `TMDB_API_KEY`         | Server-only: `lib/tmdb.server.ts`, `app/api/tmdb/[...tmdb]/route.ts`. |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL for links/SEO.                                     |
| `BLOCKLIST_CONFIG_URL` | Optional: host your own `providers.json` + `filters.txt` on a CDN.    |

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

## Desktop Player Integration

The web app renders the **React player UI** (VideoZone, ServerDropdown, PlayerControlOverlay).
In Electron desktop, the provider embed loads in a native `WebContentsView` (not iframe):

- `DesktopSecureWebview.tsx` reserves a rect and syncs bounds via `player:set-bounds` IPC
- React overlays (server dropdown, CPU warning, error) drive `overlayActive` → `player:set-visible=false`
- Fullscreen: `PlayerProvider.toggleFullscreen` → IPC `player:setFullscreen` → window-level fullscreen
- All security layers run in Electron main process on the native view

See [Desktop README](../desktop/README.md#webcontentsview-hybrid-phase-3) for architecture.

## Provider embed security

Provider video players load in sandboxed cross-origin iframes. `lib/movieProviders/cspBuilder.ts`
exposes `buildIframeCSP`, which emits the `csp=` attribute enforced by the
parent page on the iframe — blocking crypto miners (`worker-src 'none'`),
tracking beacons (restricted `connect-src`), and plugin-based ads
(`object-src 'none'`) without any server-side proxy. The desktop/mobile
players enforce the equivalent protection via the shared native guard.
