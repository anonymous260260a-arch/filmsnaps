-- 008_feedback_prompt.sql
--
-- In-app rating prompt outcomes. Separate from `feedback` on purpose: a refusal
-- is not a message and must never land in the inbox. Only the aggregate counts
-- are used (rated vs refused), and `thread` follows the same anonymous
-- per-install UUID as the feedback rows.
--
-- Apply: npx wrangler d1 execute filmsnaps-telemetry --remote --file migrations/008_feedback_prompt.sql

CREATE TABLE IF NOT EXISTS feedback_prompt (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  day     TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('rated', 'declined')),
  thread  TEXT,
  ts      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_prompt_ts ON feedback_prompt (ts);
