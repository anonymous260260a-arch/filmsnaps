-- 006_feedback.sql
--
-- Native in-app feedback (replaces the retired apps/feedback portal).
-- Deliberately minimal: no IP, no fingerprint, no visitor id, no attachments.
-- Abusive submissions are auto-FLAGGED (never blocked) and only the admin
-- ever sees them; 'spam' status keeps them out of the default list.

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

CREATE INDEX IF NOT EXISTS idx_feedback_status_ts ON feedback (status, ts);
