# ADR 0001 — Dormant web proxy stack

**Status:** Accepted (2026-08-09)
**Decision:** Keep the server-side player proxy stack intact but **dormant**.
**Applies to:** `apps/web` (proxy lib + proxy API routes)

---

## Context

The web app originally routed provider embeds through a server-side proxy to
strip ads/trackers and bypass Cloudflare JS challenges at the network layer.
That proxy stack is still present but is **not reachable** because no provider
is registered in the proxy allowlist.

## What is in scope (all in `apps/web`)

| Path | Lines | Purpose |
| --- | --- | --- |
| `lib/movieProviders/protection.ts` | ~940 | Runtime protection script generation + HTML/CSS rewriting. |
| `lib/movieProviders/tlsFetch.ts` | ~450 | TLS-fingerprinting HTTP client (`fetch` with browser-like TLS/JA3). |
| `lib/movieProviders/flareSolverr.ts` | ~270 | Headless-browser Cloudflare challenge solver (Docker service, `FLARESOLVERR_URL`). |
| `lib/movieProviders/cloudflareDetect.ts` | ~145 | Detect whether a response is a Cloudflare challenge page. |
| `lib/movieProviders/cspBuilder.ts` | ~160 | CSP header builder for proxied pages. |
| `app/api/player/[provider]/route.ts` | — | Proxy entry: fetches embed page, runs filter engine, injects protection. |
| `app/api/player/[provider]/[...path]/route.ts` | — | Asset proxy (rewrites resource URLs through the filter engine). |
| `app/api/player/[provider]/asset/route.ts` | — | Single-asset proxy variant. |
| `app/api/[provider]/[...asset]/route.ts` | — | Generic asset proxy fallback. |
| `app/api/player/falix/route.ts` | — | Falix-specific player route. |

**Total: ~2,000 lines of dormant-but-intact code.**

## Why it is dormant

The gate is a single constant in
[`apps/web/app/watch/[...id]/WatchClient.tsx`](../../apps/web/app/watch/[id]/WatchClient.tsx):

```ts
// No providers currently use the server-side proxy.
// Proxy code (protection.ts, tlsFetch, FlareSolverr) is preserved for future use.
const PROXIED_PROVIDERS = new Set<string>([]);
```

Every proxy route is only reachable when a provider id is in `PROXIED_PROVIDERS`
(and even then, only through the embed URL builder in `WatchClient`). With an
empty set, `buildEmbedUrl` always returns the provider's direct embed URL
(`provider.baseUrl + embedPath`) and the `/api/player/*` routes are never
requested.

## Why we keep it (not delete)

- It is a **complete, working capability** for defeating Cloudflare challenges
  and network-level ad/tracker stripping — a meaningful future fallback if a
  provider changes its embedding model or the native per-platform layers
  (web iframe + desktop webview + mobile native webview) become insufficient.
- Providers are remote third parties; the embed model can change at any time.
- It is **dead-safe**: the empty `PROXIED_PROVIDERS` set is a hard gate, so the
  code cannot run accidentally.
- Deleting would remove ~2,000 lines that are cheap to keep and expensive to
  rewrite from scratch.

## How to re-enable (the escape hatch)

1. Set `FLARESOLVERR_URL` if you want the headless-browser challenge solver
   (optional; without it the proxy falls back to the iPad-UA trick or a 302
   redirect for Cloudflare-protected pages).
2. Add the provider id(s) to `PROXIED_PROVIDERS` in `WatchClient.tsx`.
3. Ensure the provider is registered in `packages/shared/src/providers/registry.ts`
   and has a `blocklist.json` entry (see `docs/security.md`).

## Alternatives considered

- **Delete** — rejected: loses a working capability; code is dormant-safe.
- **Move to a plugin/package** — not worth it while dormant; would create churn
  without a consumer.
- **Rewrite against the native layers** — no consumer; premature.

## Related docs

- `docs/architecture.md` — web app data flow (direct-embed path is the live one).
- `docs/security.md` — the per-platform security layers this stack would
  augment; note that the **web player proxy is separate from** the desktop L2–L8
  cascade.
