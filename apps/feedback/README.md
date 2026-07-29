# FilmSnaps Feedback Portal

A production-ready feedback and issue reporting platform. Users can report bugs, request features, browse the roadmap, view the changelog, and search FAQs — all without creating an account.

**Backend:** Cloudflare D1 (SQLite-compatible) via Cloudflare Workers (OpenNext).
**Client:** Next.js 16 (App Router) — server-rendered, mobile-first, Works without JavaScript for read-only content.

---

## Architecture

```
Browser (Next.js App Router)
        │
        ├── StorageProvider (lib/storage.ts — interface)
        │       └── CloudflareAdapter (lib/cloudflare-adapter.ts)
        │               └── fetch() → /api/* (same-origin)
        │
        ├── Turnstile (invisible CAPTCHA-free bot detection)
        ├── Drafts (localStorage — auto-save on form input)
        └── Offline queue (localStorage — queued submissions auto-retry on reconnect)

  Next.js API Routes (app/api/*)
        │
        ├── POST /api/feedback   — create bug/feature (14-layer abuse pipeline)
        ├── GET  /api/feedback   — list with filters + pagination
        ├── GET  /api/search     — multi-domain server-side search
        ├── POST /api/vote       — upvote / remove upvote
        ├── GET  /api/vote       — check vote status
        ├── GET  /api/roadmap    — roadmap with upvote counts
        ├── GET  /api/changelog  — release history
        └── GET  /api/faq        — categorized FAQ

  Cloudflare D1 (feedback-db)
        ├── feedback         — bugs + feature requests
        ├── votes            — per-visitor upvotes
        ├── roadmap          — planned/in-progress/completed items
        ├── changelog        — versioned release notes
        ├── changelog_changes — individual change entries
        ├── faq_categories   — FAQ category groupings
        ├── faq_items        — question/answer pairs
        └── rate_limits      — IP/visitor/fingerprint rate counters
```

---

## Quick Start

```bash
# Install dependencies (from monorepo root)
pnpm install

# Start development server
cd apps/feedback
pnpm dev
```

Open [http://localhost:3001](http://localhost:3001).

---

## Tech Stack

| Tech                          | Purpose                                                |
| ----------------------------- | ------------------------------------------------------ |
| **Next.js 16** (App Router)   | Framework — deploys to Cloudflare Workers via OpenNext |
| **Cloudflare D1**             | SQLite-compatible serverless database                  |
| **Cloudflare Turnstile**      | Invisible CAPTCHA-free bot detection                   |
| **TypeScript**                | Type safety                                            |
| **Tailwind CSS** + shadcn/ui  | Styling and component primitives                       |
| **React Hook Form** + **Zod** | Form validation and schema enforcement                 |
| **Sonner**                    | Toast notifications                                    |
| **next-themes**               | Dark/Light/System theme                                |

---

## StorageProvider Interface

All persistence goes through the `StorageProvider` interface (`lib/storage.ts`). The interface defines 12 methods:

```
getBugs()                    getFeatureRequests()
createBug()                  createFeatureRequest()
updateBugStatus()            updateFeatureRequestStatus()
upvote()                     removeUpvote()
hasUpvoted()                 getRoadmap()
getChangelog()               getFaq()
```

The current implementation is `CloudflareAdapter`. To switch backends, implement the interface and swap the adapter — no UI changes needed.

---

## Pages

| Route              | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `/`                | Home — 5 cards linking to each section                          |
| `/report-bug`      | Bug report form with severity, device info, duplicate detection |
| `/feature-request` | Feature request form with business value, duplicate detection   |
| `/roadmap`         | 3-column board (Planned / In Progress / Completed) with upvotes |
| `/changelog`       | Vertical timeline of releases                                   |
| `/faq`             | Searchable accordion FAQ with categories                        |

---

## API Endpoints

All endpoints are same-origin (`/api/*`). See [docs/feedback-api-docs.md](docs/feedback-api-docs.md) for full reference.

| Method | Path             | Purpose                                    |
| ------ | ---------------- | ------------------------------------------ |
| POST   | `/api/feedback`  | Create bug report or feature request       |
| GET    | `/api/feedback`  | List feedback with filters and pagination  |
| GET    | `/api/search`    | Search across bugs, features, roadmap, FAQ |
| POST   | `/api/vote`      | Upvote or remove upvote                    |
| GET    | `/api/vote`      | Check if visitor has upvoted an item       |
| GET    | `/api/roadmap`   | List roadmap items with upvote counts      |
| GET    | `/api/changelog` | List changelog entries with changes        |
| GET    | `/api/faq`       | List FAQ categories with items             |

---

## Building for Production

```bash
cd apps/feedback

pnpm build              # Standard Next.js build
pnpm cf:build           # Build for Cloudflare Workers
pnpm cf:deploy          # Deploy to Cloudflare Workers
```

See [docs/feedback-setup-guide.md](docs/feedback-setup-guide.md) for complete setup instructions.

---

## Documentation

All documentation is in the [docs/](docs/) directory:

| Document                                               | Contents                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| [Architecture](docs/feedback-architecture.md)          | System design, visitor identity, search, voting, mobile/web integration |
| [Setup Guide](docs/feedback-setup-guide.md)            | Complete from-scratch deployment guide                                  |
| [API Reference](docs/feedback-api-docs.md)             | All REST endpoints with request/response examples                       |
| [Database Schema](docs/feedback-d1-database-schema.md) | D1 SQL schema, indexes, seed data                                       |
| [Operations Guide](docs/feedback-operations.md)        | Monitoring, admin tasks, backups, troubleshooting                       |
| [Security Review](docs/feedback-security-review.md)    | Threat model, abuse prevention, privacy, limitations                    |
| [Future Roadmap](docs/feedback-roadmap.md)             | Planned features and how to add them                                    |
| [Readiness Report](docs/feedback-readiness-report.md)  | Production readiness assessment                                         |

---

## Mobile Integration

The feedback portal loads inside the mobile app via `react-native-webview`. The settings page has a "Feedback" link pointing at the deployed URL. See [docs/feedback-architecture.md](docs/feedback-architecture.md) for details.

---

## License

Private — FilmSnaps internal project.
