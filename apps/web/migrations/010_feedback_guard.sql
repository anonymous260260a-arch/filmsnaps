-- 010_feedback_guard.sql
--
-- Durable, global abuse protection for the feedback endpoints. A Worker
-- isolate's memory is not shared, so limits kept in a Map are approximate;
-- these tables make them real. Nothing here stores an IP, user agent or device
-- id — the keys are the random per-install thread token the app already holds.
--
-- Apply: npx wrangler d1 execute filmsnaps-telemetry --remote --file migrations/010_feedback_guard.sql

-- Per-thread duplicate-text detection (scoped, so two users reporting the same
-- crash never collide). Hash is of the sender's own message, stored with it and
-- deleted with it.
ALTER TABLE feedback ADD COLUMN content_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(ts);
CREATE INDEX IF NOT EXISTS idx_feedback_thread_hash ON feedback(thread, content_hash);

-- One-time submission challenges. Random value + expiry only; swept on write.
CREATE TABLE IF NOT EXISTS feedback_challenge (
  nonce      TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_challenge_exp ON feedback_challenge(expires_at);

-- Strike counter per thread. Escalates to a temporary mute and self-expires.
CREATE TABLE IF NOT EXISTS feedback_strike (
  thread       TEXT PRIMARY KEY,
  strikes      INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  muted_until  INTEGER NOT NULL DEFAULT 0
);
