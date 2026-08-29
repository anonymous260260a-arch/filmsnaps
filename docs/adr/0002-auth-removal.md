# ADR 0002 — Remove auth scaffolding from the web app

**Status:** Accepted (2026-08-09)
**Decision:** Remove the entire web auth layer — no authentication anywhere in
FilmSnaps. **Applies to:** `apps/web`.

---

## Context

The web app shipped with an auth scaffolding that was **never wired up**:

- `AuthProvider` was a no-op context: `user` always `null`, every action
  (`signIn`, `signUp`, `signOut`, `resetPassword`, `sendMagicLink`,
  `resendVerificationEmail`) was a stub returning `{}`.
- `/auth` and `/reset-password` pages rendered a static "Auth is currently
  disabled" message and a link home.
- Header/Sidebar showed account menus that could never populate (always the
  logged-out state).

There was **no backend** (no Firebase/Supabase/DB) behind it. It was dead UI
over a dead provider.

## What was removed

| Path                                        | What                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `components/AuthProvider.tsx`               | The no-op context + `useAuth` hook.                                             |
| `app/auth/layout.tsx` + `app/auth/page.tsx` | "Sign in" page.                                                                 |
| `app/reset-password/page.tsx`               | "Password reset" page.                                                          |
| `app/layout.tsx`                            | `<AuthProvider>` wrapper removed.                                               |
| `components/Header.tsx`                     | Desktop + mobile auth menus (Sign In / account dropdown) removed.               |
| `components/desktop/Sidebar.tsx`            | Footer account row removed.                                                     |
| `components/desktop/GlobalTopBar.tsx`       | `/auth` breadcrumb entry removed.                                               |
| `app/saved/page.tsx`                        | "Sign in to save permanently" guest-notice link removed (saves are local-only). |
| `app/robots.ts`                             | `/auth`, `/auth/callback`, `/reset-password` dropped from disallow.             |

## Why remove rather than finish

- No backend exists or is planned in the repo. Completing auth would mean
  adding a whole identity stack for a feature nothing depends on.
- The UI actively misled users ("Sign in to save permanently") when saves were
  already local-only and there was no account system.
- Watchlist and watch-history are **local-only** (localStorage / AsyncStorage) —
  they never required an account and don't after this change.

## Consequences

- The app is fully anonymous: no login, no sessions, no auth API routes
  (there were none — the empty `api/logout`/`api/session` dirs were already
  gone before this ADR).
- User data (watchlist, history) lives entirely on-device.
- If real authentication is ever wanted, it should be designed as a new feature
  with a backend from day one — not resurrected from this scaffolding.

## Related docs

- `docs/architecture.md` — web app overview.
