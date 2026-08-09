# Feedback Portal API Documentation

The Feedback Portal exposes RESTful API endpoints through Next.js App Router API routes (`app/api/`). All endpoints are same-origin — served from the same Cloudflare Worker as the Next.js app.

**Base URL:** `https://{app-domain}/api`

---

## Standard Headers

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `x-visitor-id` | On mutation | UUID v4, stored in client `localStorage` under `@filmsnaps/feedback/visitor-id` |
| `x-fingerprint` | On mutation | SHA-256 hash of privacy-conscious device signals |
| `turnstile-token` | On mutation (prod) | Cloudflare Turnstile widget token |

### Response Headers

All responses include:

```
Content-Type: application/json
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

## Endpoints

### POST /api/feedback

Create a new bug report or feature request.

**Request body:**

For bug reports (`type: "bug"`):
```json
{
  "type": "bug",
  "title": "App crashes when opening search",
  "description": "The app crashes consistently...",
  "expectedBehavior": "Search should open smoothly",
  "actualBehavior": "App freezes for 2s then crashes",
  "stepsToReproduce": "1. Open app\n2. Tap search bar\n3. Type 'inception'",
  "severity": "critical",
  "deviceInfo": "Mozilla/5.0...",
  "appVersion": "1.0.5",
  "platform": "Mobile",
  "currentPage": "/search"
}
```

For feature requests (`type: "feature"`):
```json
{
  "type": "feature",
  "title": "Add watchlist notifications",
  "description": "Notify users when movies release...",
  "problem": "I keep missing new releases",
  "suggestedSolution": "Push notification 24h before release",
  "alternativeSolutions": "In-app badge instead",
  "businessValue": "Increases user retention"
}
```

**Submisson pipeline (in order):**

1. Honeypot check — hidden `website` field silently marks as spam if filled
2. Turnstile token verification — 429 if invalid
3. Three-tier rate limiting (IP → visitor → fingerprint) — 429 if exceeded
4. Content sanitization — HTML tags stripped, entities escaped
5. Spam score calculation — weighted 7-factor (honeypot, content quality, link count, keyboard smash, etc.)
6. Duplicate detection — LIKE-based word overlap + bigram Jaccard similarity
7. INSERT into D1 `feedback` table

**Response** `201 Created`:
```json
{
  "feedback": {
    "id": "bug_1712345678_a1b2c3d4",
    "type": "bug",
    "title": "App crashes when opening search",
    "status": "open",
    "spamScore": 0.0,
    "createdAt": "2025-04-05T12:00:00.000Z"
  }
}
```

**Error responses:**

| Status | Reason |
|--------|--------|
| 400 | Missing required fields |
| 429 | Rate limited or invalid Turnstile |
| 422 | Spam score too high (auto-rejected) |

---

### GET /api/feedback

List feedback items with optional filters.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | — | Filter: `bug` or `feature` |
| `status` | string | — | Filter by status: `open`, `planned`, `in-progress`, `completed`, `declined` |
| `search` | string | — | Full-text search on title and description |
| `page` | integer | 1 | Page number (1-indexed) |
| `limit` | integer | 20 | Items per page (max 100) |

**Response** `200 OK`:
```json
{
  "items": [
    {
      "id": "bug_1712345678_a1b2c3d4",
      "type": "bug",
      "title": "App crashes when opening search",
      "description": "The app crashes...",
      "status": "open",
      "severity": "critical",
      "expectedBehavior": "...",
      "actualBehavior": "...",
      "stepsToReproduce": "...",
      "deviceInfo": "Mozilla/5.0...",
      "appVersion": "1.0.5",
      "platform": "Mobile",
      "currentPage": "/search",
      "createdAt": "2025-04-05T12:00:00.000Z",
      "updatedAt": "2025-04-05T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

---

### GET /api/search

Search across feedback, roadmap, and FAQ.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | — | Search query (required) |
| `type` | string | `all` | Scope: `bug`, `feature`, `roadmap`, `faq`, or `all` |

**Response** `200 OK`:
```json
{
  "results": {
    "bugs": [...],
    "features": [...],
    "roadmap": [...],
    "faq": [...]
  },
  "totalCount": 8
}
```

Server-side search uses SQL `LIKE` matching on title/description fields, with categorized results grouped by domain.

---

### POST /api/vote

Upvote or remove an upvote on a feedback/roadmap item.

**Request body:**
```json
{
  "feedbackId": "bug_1712345678_a1b2c3d4",
  "action": "upvote"
}
```

Actions: `upvote` | `removeUpvote`

**Response** `200 OK`:
```json
{
  "action": "upvote",
  "feedbackId": "bug_1712345678_a1b2c3d4",
  "voteCount": 5,
  "hasUpvoted": true
}
```

---

### GET /api/vote

Check if a visitor has upvoted a specific item.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `feedbackId` | string | The item ID |
| `visitorId` | string | Visitor UUID |

**Response** `200 OK`:
```json
{
  "hasUpvoted": true,
  "voteCount": 5,
  "feedbackId": "bug_1712345678_a1b2c3d4"
}
```

---

### GET /api/roadmap

List all roadmap items, sorted by status priority (in-progress → planned → completed) then by progress descending.

**Response** `200 OK`:
```json
{
  "items": [
    {
      "id": "rm_1",
      "title": "Download Manager",
      "description": "Background download support...",
      "status": "in-progress",
      "progress": 65,
      "estimatedRelease": "Q2 2025",
      "upvotes": 12,
      "relatedFeedbackId": null
    }
  ]
}
```

Upvote counts are derived from a `LEFT JOIN` on the `votes` table.

---

### GET /api/changelog

List all changelog entries with their individual changes.

**Response** `200 OK`:
```json
{
  "items": [
    {
      "version": "1.0.5",
      "releaseDate": "2025-03-15",
      "changes": [
        { "type": "feature", "description": "Added download manager" },
        { "type": "fix", "description": "Fixed crash on search" },
        { "type": "improvement", "description": "Reduced memory usage" }
      ]
    }
  ]
}
```

Ordered by `release_date DESC`. Each changelog entry fetches its child rows from `changelog_changes`.

---

### GET /api/faq

List all FAQ categories with their items.

**Response** `200 OK`:
```json
{
  "items": [
    {
      "id": "general",
      "name": "General",
      "items": [
        { "question": "What is FilmSnaps?", "answer": "FilmSnaps is..." },
        { "question": "Is FilmSnaps free?", "answer": "FilmSnaps is..." }
      ]
    }
  ]
}
```

Categories ordered by insertion, items ordered by `id ASC`.

---

## Error Format

All error responses follow this structure:

```json
{
  "error": "Human-readable error message",
  "status": 429
}
```

---

## Rate Limiting

Three independent tiers checked on mutation endpoints:

| Tier | Limit | Window | Error |
|------|-------|--------|-------|
| Per IP (SHA-256 hashed) | 20 requests | 60 minutes | `429 rate_limit_exceeded` |
| Per visitor UUID | 10 requests | 60 minutes | `429 rate_limit_exceeded` |
| Per fingerprint | 5 submissions | 60 minutes | `429 rate_limit_exceeded` |

Retry-After header is included in rate limit responses.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-04-05 | Initial API release — all endpoints operational |
