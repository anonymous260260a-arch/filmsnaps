-- 009_feedback_reply_vote.sql
--
-- The sender can mark a team reply helpful or not. One vote per submission,
-- NULL until they vote. Nothing identifying is stored.
--
-- Apply: npx wrangler d1 execute filmsnaps-telemetry --remote --file migrations/009_feedback_reply_vote.sql

ALTER TABLE feedback
  ADD COLUMN reply_vote TEXT CHECK (reply_vote IN ('like', 'dislike'));
