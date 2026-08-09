# Architecture — FilmSnaps Feedback Portal

---

## 1. System Design Overview

The Feedback Portal is a unified bug-reporting and feature-request platform built as a Next.js 16 app that compiles to a Cloudflare Worker via OpenNext Cloudflare.

### Design Goals

- **No user accounts required** — anonymous submission with fair-use protections
- **Abuse-resistant by default** — 14 security layers without CAPTCHA friction
- **Privacy-preserving** — no PII stored, no tracking cookies, no invasive fingerprinting
- **Offline-capable** — drafts save locally, submissions queue when offline
- **Future-proof storage** — `StorageProvider` interface decouples UI from backend

### Two-Mode Architecture

The app operates in two modes:

| Mode | Storage | Purpose | When |
|------|---------|---------|------|
| **Cloudflare D1** (production) | `CloudflareAdapter` | Persistent, server-side, multi-device | Production deploy |
| **localStorage** (legacy/fallback) | `LocalStorageAdapter` | Single-device, no server | Dev, testing, fallback |

Both implement the same `StorageProvider` interface. Swap by changing one import per page.

---

## 2. Visitor Identification

Visitor IDs are the **sole identity mechanism** in the Feedback Portal. There is no authentication, no login, no user database.

### How Visitor IDs Are Generated

- On first visit, `crypto.randomUUID()` generates a UUID v4
- The UUID is stored in `localStorage` under the key `@filmsnaps/feedback/visitor-id`
- On subsequent visits, the stored UUID is reused
- If `localStorage` is cleared, a new UUID is generated

**Code:** `lib/visitor.ts`
```typescript
export function getVisitorId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem("@filmsnaps/feedback/visitor-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("@filmsnaps/feedback/visitor-id", id);
  }
  return id;
}
```

### Why No Authentication

- **Lower friction** — users submit feedback without creating an account
- **Higher volume** — removing auth barriers increases submission rates
- **Privacy** — no email, username, or password to store or leak
- **Sufficient for the use case** — the goal is quality signals, not user management

The trade-off: one user on two devices appears as two visitors. This is acceptable because:
- Duplicate detection catches identical submissions
- Rate limiting prevents abuse per device
- An admin dashboard (future) would still see distinct signals

### Where It's Used

| Context | How Visitor ID Is Used |
|---------|----------------------|
| Creating feedback | Attached to each submission (`visitor_id` column in D1) |
| Voting | Prevents double-voting (`UNIQUE(feedback_id, visitor_id)` in D1) |
| Rate limiting | Counts submissions per visitor UUID |
| Device fingerprinting | Fingerprint is derived from device signals, not the UUID |

### How Voting Works

1. User clicks the upvote button on a roadmap or feedback item
2. The `CloudflareAdapter` sends a POST to `/api/vote` with the `feedbackId` from a `getIdentityHeaders()` call
3. Server checks for an existing vote via `SELECT ... WHERE feedback_id = ? AND visitor_id = ?`
4. If no existing vote, INSERT a new row → vote counted
5. If existing vote, DELETE it → vote toggled off
6. Server returns the updated `voteCount` and `hasUpvoted` status
7. Client updates the UI optimistically

The rate limiter allows 10 votes per hour per visitor to prevent abuse.

---

## 3. Device Fingerprinting

Fingerprinting enables rate limiting and abuse detection without authentication.

### Signals Collected

- Screen width/height
- Color depth (typically 24 or 32)
- Timezone offset (minutes from UTC)
- Browser language
- Platform (e.g., "Win32", "Android", "iPhone")
- Hardware concurrency (CPU core count)

### Signals NOT Collected

- ❌ Canvas fingerprint — too invasive, can be used for cross-site tracking
- ❌ WebGL / GPU — identifies hardware too precisely
- ❌ Battery API — privacy concern
- ❌ Audio context — unique per device
- ❌ Installed fonts — identifies devices
- ❌ Mouse/touch patterns — behavioral biometrics

### How It Works

```typescript
// lib/fingerprint.ts
const signals = [
  screen.width, screen.height,
  new Date().getTimezoneOffset(),
  navigator.language,
  navigator.platform,
  screen.colorDepth,
  navigator.hardwareConcurrency || 0,
].join("|||");

// SHA-256 hash → first 32 hex characters
const fingerprint = await sha256(signals);
```

The fingerprint is a hash — it cannot be reversed into the original signals. Two identical devices in the same timezone with the same language will have the same fingerprint (intentional — grouping is useful for analytics).

---

## 4. Search

Search operates at two levels: client-side Fuse.js for instant UI feedback, and server-side D1 queries for authoritative results.

### Client-Side Search

Used for:
- **Duplicate detection** — when a user types a title, client-side Fuse.js checks all loaded items
- **Instant filtering** — roadmap, changelog, and FAQ pages filter as the user types

```typescript
// lib/search.ts — client-side Fuse.js
const fuse = new Fuse(items, {
  keys: ["title", "description"],
  threshold: 0.4,          // Lower = more exact matches
  distance: 100,
});
const results = fuse.search(query);
```

The threshold of 0.4 means:
- "crash" matches "app crashes on startup" (0.25)
- "crash" does NOT match "slow loading times" (0.85)
- "dark mode" matches "dark theme support" (0.38)

### Duplicate Detection

When a user submits a form title, the system checks for duplicates:

**Client-side (instant):**
1. On blur of the title field, `findDuplicates()` runs client-side via Fuse.js
2. If matches found, show a `DuplicateDialog` — "This looks similar to an existing report..."
3. User can continue anyway or cancel

**Server-side (authoritative):**
1. On POST `/api/feedback`, the server runs word-extraction + LIKE matching
2. Extracts unique words from the input title
3. Queries D1: `SELECT * FROM feedback WHERE title LIKE '%word1%' OR title LIKE '%word2%'`
4. Computes bigram Jaccard similarity for each match:

```
J(A, B) = |bigrams(A) ∩ bigrams(B)| / |bigrams(A) ∪ bigrams(B)|
```

5. Items with similarity > 0.6 (Jaccard < 0.4 on the distance scale) are flagged
6. If the new submission is a near-exact duplicate, it's flagged with `duplicate_of` set

### Server-Side Search

`GET /api/search?q=...&type=all`:
1. Accepts `q` (query) and `type` (bug, feature, roadmap, faq, or all)
2. Runs `LIKE '%query%'` on each domain's relevant fields
3. Returns categorized results with a `totalCount`

### Fuzzy Search

Fuse.js provides fuzzy search with:
- **Tolerance for typos** — "changelog" matches "changelg"
- **Weighted fields** — title matches rank higher than description
- **Threshold control** — 0.4 balances recall vs precision

For the server-side duplicate check, bigram Jaccard distance is used instead (lighter than Fuse.js, works in SQLite).

---

## 5. Spam & Abuse Prevention

14 layers applied in order on every submission:

```
 1. Honeypot           — hidden field bots fill, humans don't
 2. Turnstile          — invisible Cloudflare CAPTCHA
 3. Rate limit (IP)    — 20 requests/hour per hashed IP
 4. Rate limit (visitor) — 10 requests/hour per visitor UUID
 5. Rate limit (fingerprint) — 5 submissions/hour per fingerprint
 6. Content sanitization  — strip HTML, escape entities (XSS prevention)
 7. Spam scoring          — 7-factor weighted score (0.0–1.0)
 8. Auto-rejection        — spam > 0.7 → 422 Unprocessable
 9. Flagging              — spam 0.3–0.7 → flagged for review
10. Min content quality   — title ≥10 chars, body ≥20 chars
11. Repeated chars        — >70% same character → spam
12. ALL CAPS detection    — >50% uppercase → penalized
13. Link counting         — >3 links → spam
14. Keyboard smash        — entropy analysis detects "asdfghjkl"
```

See [security review](docs/feedback-security-review.md) for full details.

---

## 6. Offline Support

### Drafts (auto-save)

- Every form auto-saves to `localStorage` on every keystroke change
- On page reload, the draft is restored automatically
- On successful submission, the draft is cleared
- Draft keys: `@filmsnaps/feedback/draft/bug` and `@filmsnaps/feedback/draft/feature`

### Submission Queue

When the user submits while offline:

1. `CloudflareAdapter` detects `navigator.onLine === false` or `fetch()` fails
2. The submission is serialized into `@filmsnaps/feedback/offline-queue` in `localStorage`
3. A placeholder `BugReport`/`FeatureRequest` is returned with `id: "offline_..."` 
4. The form shows "Saved offline — will submit when connected"
5. On `window.online` event, the queue processes FIFO with automatic retry
6. Max 5 retries per queued item before permanent failure

### Limitations

- **Best-effort**, not guaranteed — if the browser closes before the queue processes, the queued submission survives in `localStorage`
- **No conflict resolution** — submissions are creates, not updates, so conflicts don't occur
- **Single-device queue** — the queue is local to one browser; deploying a new version of the app won't clear it

---

## 7. Mobile Integration

### How the Mobile App Opens the Portal

The FilmSnaps mobile app (React Native / Expo) loads the feedback portal in a full-screen WebView:

```tsx
// apps/mobile/app/feedback.tsx
<WebView
  source={{ uri: feedbackUrl }}
  javaScriptEnabled={true}
  domStorageEnabled={true}
  startInLoadingState={true}
  sharedCookiesEnabled={true}
/>
```

### WebView Configuration

| Setting | Value | Reason |
|---------|-------|--------|
| `javaScriptEnabled` | `true` | Required for form validation, Turnstile, and dynamic UI |
| `domStorageEnabled` | `true` | Required for localStorage (visitor ID, drafts, offline queue) |
| `startInLoadingState` | `true` | Shows loading spinner while the page loads |
| `sharedCookiesEnabled` | `true` | Shares cookies with other WebViews in the app |

### Configuration

The feedback URL is set in the mobile app's configuration:

```json
// apps/mobile/app.json
{
  "expo": {
    "extra": {
      "feedbackUrl": "https://filmsnaps-feedback.your-subdomain.workers.dev"
    }
  }
}
```

### Limitations of Current Mobile Integration

- **No bidirectional communication** — the WebView cannot send events back to the native app
- **No file picking** — screenshot uploads (future feature) would require a custom native bridge
- **No deep linking** — the WebView loads the homepage; specific sections can't be opened directly yet

### Future Improvements

- PostMessage bridge for native feedback (e.g., auto-attach app version, device info)
- Native file picker for screenshot uploads
- Deep linking to specific forms from the app (e.g., "Report Bug" button in settings opens `/report-bug`)

---

## 8. Web Integration

### Routing

The Feedback Portal uses Next.js App Router with standard file-system routing:

```
app/
├── page.tsx              → / (home)
├── report-bug/page.tsx   → /report-bug
├── feature-request/page.tsx → /feature-request
├── roadmap/page.tsx      → /roadmap
├── changelog/page.tsx    → /changelog
├── faq/page.tsx          → /faq
├── api/
│   ├── feedback/route.ts
│   ├── search/route.ts
│   ├── vote/route.ts
│   ├── roadmap/route.ts
│   ├── changelog/route.ts
│   └── faq/route.ts
└── layout.tsx            → Root layout with theme provider, header, footer
```

### Embedding

The Feedback Portal is designed as a standalone app, not an embeddable widget. To embed it in another page:

1. **iframe** — simplest approach, but limited (no shared auth, cookie issues)
2. **Web Component** — wrap the entire app in a custom element (complex)
3. **Redirect** — open `/feedback` in the same tab (recommended; what the mobile app does)

### Navigation

- **Header** — logo, page title, theme toggle
- **Home page** — 5 clickable cards (Report Bug, Request Feature, Roadmap, Changelog, FAQ)
- **Back navigation** — every sub-page has a back button (arrow icon top-left)
- **Deep links** — every page has a unique URL; bookmarkable and shareable
- **404** — Next.js default 404 page for unknown routes

---

## 9. Data Flow Diagram

```
User submits form
        │
        ▼
React Hook Form → Zod validation
        │
        ▼
onSubmit handler
        │
        ▼
CloudflareAdapter.createBug()
        │
        ├── 1. Get identity headers (visitor ID + fingerprint)
        ├── 2. Get Turnstile token (invisible widget)
        ├── 3. Check offline status
        │       ├── Offline → enqueue to localStorage → return placeholder
        │       └── Online → continue
        ├── 4. POST /api/feedback
        │       │
        │       ▼
        │   Server (app/api/feedback/route.ts)
        │       ├── 1. Honeypot check
        │       ├── 2. Turnstile verification (POST to Cloudflare)
        │       ├── 3. Rate limit check (3 tiers)
        │       ├── 4. Sanitize all string fields
        │       ├── 5. Calculate spam score
        │       ├── 6. Duplicate detection (LIKE + Jaccard)
        │       ├── 7. INSERT into D1 feedback table
        │       └── 8. Return created item
        │               │
        │               ▼
        │   Client receives response
        │
        ├── 5. Set last-submit timestamp (cooldown)
        ├── 6. Clear draft from localStorage
        └── 7. Show success toast → show "Submitted" view
```

---

## 10. Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Cloudflare Workers | Edge compute, global distribution |
| **Framework** | Next.js 16 + OpenNext | Full-stack web framework compiled to Worker |
| **Database** | Cloudflare D1 | Serverless SQLite, per-request billing |
| **Anti-bot** | Cloudflare Turnstile | Invisible CAPTCHA-free verification |
| **Forms** | React Hook Form + Zod | Declarative form validation |
| **Styling** | Tailwind CSS + shadcn/ui | Utility-first CSS + accessible primitives |
| **Search** | Fuse.js (client) + LIKE/D1 (server) | Fuzzy search and duplicate detection |
| **Theme** | next-themes | Dark/light/system with localStorage persistence |
| **Notifications** | Sonner | Toast notifications |
| **Deployment** | wrangler CLI | Build, deploy, and manage Cloudflare resources |

---

## 11. Screenshot Architecture (Future)

Screenshots are architecturally planned but **not yet implemented**. The system already has:

1. An optional `screenshots` column in the D1 `feedback` table (`TEXT` — would store JSON array of R2 URLs)
2. An optional `screenshots` field on the `BugReport` TypeScript type (`string[]`)
3. No R2 binding in `wrangler.jsonc` (would need to be added)
4. No upload UI in any form (would need a file picker + preview component)

To enable screenshots later:
- Add a `r2_buckets` binding to `wrangler.jsonc`
- Create `POST /api/upload` — returns a signed R2 URL for client-side upload
- Add a file input + preview component to `BugReportForm.tsx` and `FeatureRequestForm.tsx`
- Update `CloudflareAdapter.createBug()` to upload screenshots before submitting
- The `screenshots` column already exists — no schema migration needed

See [Future Roadmap](docs/feedback-roadmap.md) for implementation details.
