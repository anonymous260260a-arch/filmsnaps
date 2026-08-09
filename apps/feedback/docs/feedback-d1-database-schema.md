# D1 Database Schema — FilmSnaps Feedback

This document describes the Cloudflare D1 (SQLite) database schema used by the FilmSnaps Feedback Portal.

- **Database name:** `feedback-db`
- **Driver:** Cloudflare D1 (SQLite-compatible)
- **Binding:** `FEEDBACK_DB` (exposed via `process.env.FEEDBACK_DB` in OpenNext Cloudflare Workers)

---

## Table: `feedback`

Stores both bug reports and feature requests as a unified content type, differentiated by the `type` column.

```sql
CREATE TABLE feedback (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL,                    -- 'bug' | 'feature'
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open',     -- 'open'|'planned'|'in-progress'|'completed'|'declined'
  severity              TEXT,                             -- 'critical'|'high'|'medium'|'low' (bugs only)
  expected_behavior     TEXT,                             -- bug-specific
  actual_behavior       TEXT,                             -- bug-specific
  steps_to_reproduce    TEXT,                             -- bug-specific
  device_info           TEXT,                             -- optional browser/device info
  app_version           TEXT,                             -- optional app version
  platform              TEXT,                             -- optional platform string
  current_page          TEXT,                             -- optional URL where issue occurred
  problem               TEXT,                             -- feature-specific: problem statement
  suggested_solution    TEXT,                             -- feature-specific: proposed solution
  alternative_solutions TEXT,                             -- feature-specific: alternatives considered
  business_value        TEXT,                             -- feature-specific: value justification
  screenshots           TEXT,                             -- reserved for future use (JSON array of R2 URLs)
  visitor_id            TEXT,                             -- UUID from client localStorage
  fingerprint           TEXT,                             -- privacy-conscious device fingerprint hash
  ip_hash               TEXT,                             -- SHA-256(ip + server_secret)[:16]
  spam_score            REAL DEFAULT 0.0,                 -- 0.0 (clean) to 1.0 (spam)
  duplicate_of          TEXT,                             -- FK to feedback.id if marked as duplicate
  honeypot_caught       INTEGER DEFAULT 0,                -- 1 if honeypot field was filled by bot
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_feedback_type     ON feedback(type);
CREATE INDEX idx_feedback_status   ON feedback(status);
CREATE INDEX idx_feedback_created  ON feedback(created_at);
CREATE INDEX idx_feedback_visitor  ON feedback(visitor_id);
CREATE INDEX idx_feedback_duplicate ON feedback(duplicate_of);
CREATE INDEX idx_feedback_search   ON feedback(title, description);
```

### Column Details

| Column | Type | Always Set | Notes |
|--------|------|------------|-------|
| `id` | TEXT | Yes | Format: `bug_{ts}_{rand8}` or `feat_{ts}_{rand8}` |
| `type` | TEXT | Yes | Discriminator between bug and feature request |
| `title` | TEXT | Yes | Sanitized, min 10 chars on create |
| `description` | TEXT | Yes | Sanitized, min 20 chars on create |
| `status` | TEXT | Yes | Default `open` for new submissions |
| `severity` | TEXT | No | Only set when `type = 'bug'` |
| `visitor_id` | TEXT | Yes | UUID v4 generated client-side |
| `fingerprint` | TEXT | Yes | SHA-256 hash of device signals |
| `ip_hash` | TEXT | Yes | One-way hash — raw IP never stored |
| `spam_score` | REAL | Yes | Computed on submission |
| `honeypot_caught` | INTEGER | Yes | Anti-bot indicator |
| `created_at` | TEXT | Yes | UTC ISO 8601 |

---

## Table: `votes`

Tracks upvotes on feedback and roadmap items. Enforces one vote per visitor per item.

```sql
CREATE TABLE votes (
  id          TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL,
  visitor_id  TEXT NOT NULL,
  type        TEXT NOT NULL,               -- 'upvote' | 'downvote' (currently only upvote)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(feedback_id, visitor_id)
);

CREATE INDEX idx_votes_feedback ON votes(feedback_id);
CREATE INDEX idx_votes_visitor  ON votes(visitor_id);
```

### Key Constraint

`UNIQUE(feedback_id, visitor_id)` — a visitor may only vote once per item. Re-voting toggles (DELETE then INSERT).

---

## Table: `roadmap`

Public roadmap items visible to all users.

```sql
CREATE TABLE roadmap (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'planned',  -- 'planned' | 'in-progress' | 'completed'
  progress            INTEGER NOT NULL DEFAULT 0,       -- 0–100 percentage
  estimated_release   TEXT,                              -- e.g. "Q2 2025"
  related_feedback_id TEXT,                              -- FK to feedback.id
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Seed data: 6 roadmap items covering planned, in-progress, and completed statuses.

---

## Table: `changelog` + `changelog_changes`

Versioned release notes.

```sql
CREATE TABLE changelog (
  version      TEXT PRIMARY KEY,         -- e.g. "1.0.5"
  release_date TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE changelog_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     TEXT NOT NULL REFERENCES changelog(version),
  change_type TEXT NOT NULL,             -- 'feature' | 'fix' | 'improvement' | 'security'
  description TEXT NOT NULL
);

CREATE INDEX idx_changelog_version ON changelog_changes(version);
```

Seed data: 5 changelog versions with 15 individual change entries total.

---

## Table: `faq_categories` + `faq_items`

Categorized FAQ content.

```sql
CREATE TABLE faq_categories (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE faq_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id TEXT NOT NULL REFERENCES faq_categories(id),
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL
);

CREATE INDEX idx_faq_category ON faq_items(category_id);
```

Seed data: 5 categories with 15 items total.

---

## Table: `rate_limits`

Atomic rate limiting counters using `INSERT ... ON CONFLICT`.

```sql
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,        -- 'ip:{hash}' | 'visitor:{id}' | 'fp:{hash}'
  counter      INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,           -- ISO timestamp of current window start
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Rate Limit Tiers

| Scope | Key Prefix | Window | Limit |
|-------|-----------|--------|-------|
| IP (hashed) | `ip:` | 60 min | 20 requests |
| Visitor UUID | `visitor:` | 60 min | 10 requests |
| Fingerprint | `fp:` | 60 min | 5 submissions |

The `checkRateLimit` function atomically increments the counter for the current window. If the window has expired, the counter resets to 1.

---

## Seed Data

The initial migration (`migrations/001_initial.sql`) seeds:

- **Roadmap** — 6 items across all 3 statuses (planned, in-progress, completed)
- **Changelog** — 5 versions with 15 changes covering features, fixes, improvements, and security
- **FAQ** — 5 categories (General, Account & Privacy, Features & Usage, Troubleshooting, Content & Availability) with 15 items total
