-- 007_feedback_reply.sql
--
-- Turns the feedback inbox into a two-way channel:
--   rating  INTEGER 1..5     app rating collected by the in-app prompt (no store)
--   thread  TEXT             random per-install UUID minted on-device — the only
--                            key the app presents to read its own replies. Not
--                            derived from hardware/OS/IP/account.
--   reply / replied_ts       the admin's answer, shown back inside the app.
--   type    + 'rating'       a rating may arrive with no message at all.
--
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt. 006 is
-- repeated (IF NOT EXISTS) so this file also works on a database that has not
-- applied 006 yet; the copy then simply moves zero rows.
--
-- Apply: npx wrangler d1 execute filmsnaps-telemetry --remote --file migrations/007_feedback_reply.sql

CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('bug', 'idea', 'question')),
  message     TEXT NOT NULL,
  email       TEXT,
  client      TEXT,
  app_version TEXT,
  status      TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'read', 'done', 'spam')),
  flagged     INTEGER NOT NULL DEFAULT 0,
  ts          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('bug', 'idea', 'question', 'rating')),
  message     TEXT NOT NULL DEFAULT '',
  rating      INTEGER CHECK(rating IS NULL OR (rating BETWEEN 1 AND 5)),
  email       TEXT,
  client      TEXT,
  app_version TEXT,
  thread      TEXT,
  status      TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'read', 'done', 'spam')),
  flagged     INTEGER NOT NULL DEFAULT 0,
  reply       TEXT,
  replied_ts  INTEGER,
  ts          INTEGER NOT NULL
);

INSERT INTO feedback_v2 (id, day, type, message, email, client, app_version, status, flagged, ts)
SELECT id, day, type, message, email, client, app_version, status, flagged, ts
FROM feedback;

DROP TABLE feedback;
ALTER TABLE feedback_v2 RENAME TO feedback;

CREATE INDEX IF NOT EXISTS idx_feedback_status_ts ON feedback (status, ts);
CREATE INDEX IF NOT EXISTS idx_feedback_thread_ts ON feedback (thread, ts);
