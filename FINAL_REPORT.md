# FilmSnaps — Final Cleanup & Audit Report

**Date:** 2026-08-09
**Scope:** Phases 1–8 of the repository audit, cleanup, and documentation
mandate. This is the wrap-up: what changed, what's verified, what remains.

---

## 1. What this repo is

FilmSnaps is a cross-platform streaming-discovery ecosystem (TMDB-powered) as a
**pnpm + Turborepo monorepo**:

| App | Package | Stack | Version |
| --- | --- | --- | --- |
| Web | `@filmsnaps/web` | Next.js 16 (App Router) + Tailwind | 0.1.1 |
| Desktop | `@filmsnaps/desktop` | Electron 43 + Next.js standalone | 1.0.4 |
| Mobile | `@filmsnaps/mobile` | Expo SDK 55 / React Native 0.83 | 0.1.0 |
| Feedback | `@filmsnaps/feedback` | Next.js 16 + Cloudflare Workers/D1 | 0.1.0 |
| Shared | `@filmsnaps/shared` | guards, providers, types, state | 0.1.0 |
| adblock-config | `@filmsnaps/adblock-config` | blocklist.json schema | 0.1.0 |
| filter-compiler | `@filmsnaps/filter-compiler` | adblock engine + mobile patterns | 0.1.0 |

Full architecture: [docs/architecture.md](docs/architecture.md).

## 2. Cleanup executed (Tiers A–C)

### Tier A — dead files removed (24)
Web dead components/libs/routes, mobile dead screens/components, desktop
`inject-preload-css.js`, feedback `local-storage.ts`. Two files were caught by
live-import verification and **restored** (`offline-queue.ts`, `search.ts`), and
a dangling `./common` re-export was fixed.

### Tier B — dead UI + dependencies removed
- 34 dead `components/ui/*` components (14 verified-live kept).
- 39 dependencies removed across web (32), mobile (5), feedback (2), incl. 16
  dead Radix packages. `vaul`/`drawer` kept (verified used).

### Tier C — functional fix
Removed the two 404 download buttons (`/download/nxsha/...`, `/download/falix/...`)
from `MovieClient.tsx` / `TVClient.tsx`.

### Docs / artifacts cleanup (Phase 8a)
- 28 root consultation docs, 8 mobile download docs, all old `docs/*.md`,
  debug artifacts (HTML captures, `check_*.mjs`, `test_*.mjs`, `*.html`),
  tool configs (`.mimocode/`, `.poolside/`, `.qwen/`, `research/`), stale root
  `app.json`/`eas.json`, and misc scratch files.
- **Nested dev docs removed:** `apps/mobile/docs/`, `apps/web/docs/`
  (consultation artifacts surfaced once the `docs/` gitignore rule was dropped).
- **`providers.md`** (URL/command scratch) removed.
- **Secret handling:** `.dev.vars` with a real `TMDB_API_KEY` was removed from
  tracking (kept on disk, gitignored). ⚠️ The key remains in git **history** —
  see §5.

### Documentation (Phase 8b)
- Rewrote `README.md` (accurate stack/versions — the old one claimed Flutter,
  Next 15, Supabase/Firebase, and a phantom "resource watchdog").
- Rewrote `CONTRIBUTING.md` (real layout, provider workflow, blocklist safety).
- Rewrote `SECURITY.md` → summary + pointer.
- Created `docs/` (now tracked):
  - `docs/security.md` — **the detailed security-layers doc** you asked for:
    threat model, R0–R8 cascade, L2–L8 desktop layers, mobile native
    protection, `blocklist.json`, audit diagnostics, threat matrix.
  - `docs/architecture.md`, `docs/packages.md`, `docs/README.md`.
- New app READMEs: `apps/web/`, `apps/desktop/`, `apps/mobile/`.
- Tracked `apps/feedback/docs/` (8 genuine, previously-gitignored docs).
- `.env.example` cleaned of phantom Firebase/Supabase vars.

## 3. Validation (Phase 7)

- **Typecheck:** web/desktop/feedback/shared clean. **Mobile: 33 PRE-EXISTING
  errors** in `lib/download/*` + theme tokens — none in files touched by this
  cleanup (verified by origin).
- **Tests:** 90/90 passing (registry 20, navigation-home 12, playerGuard 31,
  desktop blocklist 27).
- **Build:** web build passed (exit 0). `pnpm install` left to the user (lockfile
  will regenerate).

## 4. Current git state

- **162 files staged**, all deletions verified + docs staged.
- Only `pnpm-lock.yaml` unstaged (regenerates on the user's `pnpm install`).
- `.audit/` (the phase reports + analysis scratch) left untracked — it's the
  working record of this audit; delete or archive as you prefer. The three
  phase reports are mirrored in `cleanup-report.md`.

## 5. Remaining issues & recommendations

### 🔴 High priority
1. **Rotate `TMDB_API_KEY`.** A real key was committed in `.dev.vars` and is
   now in git history. It's untracked and on-disk only, but the key must be
   treated as compromised → generate a new one and update `.env.local`.
2. **Mobile typecheck is red** (33 pre-existing errors in `lib/download/*` +
   theme tokens). These predate this cleanup, but they block a clean CI
   typecheck for mobile. Worth a dedicated fix pass.

### 🟡 Medium
3. **Version drift:** desktop `package.json` is 1.0.4 while the latest repo tag
   is v1.1.4 (tags are project-wide). Decide whether desktop should track the
   same version line.
4. **`setupAutoRetry()`** in `apps/feedback/lib/offline-queue.ts` is never
   called — remove it or wire it up.
5. **5 root dev docs still tracked** (`Download_FUTURE.md`,
   `EXPERIMENTAL_PROVIDER_SANDBOX.md`, `HEVC_PLAYBACK_DOC.md`,
   `RELEASE_NOTES_v1.0.4.md`, `WATCH_PAGE_UX_DESIGN_REFERENCE.md`). Historical
   dev artifacts — archive into `docs/` or delete, your call.

### 🟢 Tier D — awaiting your review
Per your instruction, **Tier D is untouched.** Items:
- **D1** dormant web proxy stack (`PROXIED_PROVIDERS = Set([])`, ~2k lines) —
  recommended keep + document.
- **D2** `video-extract` + `/api/stream` cluster — powers the mobile
  experimental provider path; keep.
- **D3** auth scaffolding — leave code, remove UI affordances (pages already say
  "disabled").
- **D4** mobile experimental sandbox — keep (active prototype).
- **D5** shared zero-consumer exports + watchlist two-source-of-truth — de-dup
  in a follow-up.
- **D6** debug artifacts — archived/deleted already (done in 8a).
- **D7** tool configs + legacy deploy — `.agents/` kept, others removed.

## 6. What's left to do on your side

1. **Run `pnpm install`** (regenerates `pnpm-lock.yaml`) — then it can be staged.
2. **Review the staged changes** (`git status`, `git diff --cached`) and commit
   when ready. I have **not committed** anything.
3. **Review Tier D** — tell me which items to act on.
4. **Rotate the TMDB key.**
