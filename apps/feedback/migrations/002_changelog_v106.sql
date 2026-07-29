-- ============================================================
-- FilmSnaps Feedback Portal — v1.0.6 Changelog Entry
-- Migration 002: Add v1.0.6 changelog entry
-- ============================================================

INSERT OR IGNORE INTO changelog (version, release_date) VALUES ('1.0.6', '2026-07-29');

INSERT OR IGNORE INTO changelog_changes (version, change_type, description) VALUES
  ('1.0.6', 'feature', 'Feedback portal with Cloudflare D1 production database'),
  ('1.0.6', 'security', '14-layer abuse prevention: Turnstile, rate limiting, spam scoring, XSS sanitization, honeypot'),
  ('1.0.6', 'feature', 'Cloudflare Workers deployment via OpenNext'),
  ('1.0.6', 'feature', 'Offline queue with auto-retry on reconnect'),
  ('1.0.6', 'improvement', 'Download engine fixes: live byte tracking for accurate pause/resume'),
  ('1.0.6', 'feature', 'How Content Works transparency page covering ad blocking technology'),
  ('1.0.6', 'improvement', 'Theme color token migration across all mobile screens'),
  ('1.0.6', 'security', 'IP privacy hashing with server-side secret');
